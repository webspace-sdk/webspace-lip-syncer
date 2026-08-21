# Lip Sync Fidelity Fix Plan

## Objective

Make the browser/WASM inference path reproduce the acoustic features and temporal semantics used to train the bundled `full-250-wds` model. The acceptance standard is numerical parity against the original cached PyTorch feature tensors, followed by model-decision parity within the documented uint8 quantization tolerance.

## Provenance baseline

- The browser asset is a quantized TensorFlow.js export, not an ONNX file.
- Its source checkpoint is `D:\ai\lipsync\models\full-250-wds.pth`.
- The model is a one-layer, 300-hidden-unit LSTM with 28 inputs and 12 output logits.
- The historical float TensorFlow.js export reproduces the PyTorch class sequence exactly on the saved conversion fixture.
- The separate `C:\Users\gfodor\face-agent-server\lip-sync.onnx` contains the same checkpoint tensors bit-for-bit after the standard ONNX LSTM gate reorder.
- The exact training epoch and its 300-unit notebook configuration were not committed. The architecture, weights, preprocessing, and target offset are nevertheless recoverable from the checkpoint, cached features, and training notebook.

## Confirmed fidelity defects

### P0: acoustic feature extraction

The model was trained with torchaudio 0.6 features:

- 48,000 Hz mono PCM;
- 1,200-sample FFT/window and 480-sample hop;
- periodic Hann window;
- centered STFT frames with reflect padding;
- power spectrum and 26 HTK-style mel filters;
- `log(mel_energy + 1e-6)`;
- orthonormal DCT-II producing 13 MFCC coefficients;
- a separate, unwindowed forward 1,200-sample energy window using `log(sum_squares + 0.001)`;
- 14 centered deltas calculated from two past and two future frames;
- normalization using `(feature - mean) / (variance + 0.001)`.

The current Meyda path instead uses 44.1 kHz, a 1,024-sample symmetric Hann window, `log1p` mel energies, an unnormalized DCT, windowed energy, different framing, an MFCC-0 sign inversion, and normalization without the `0.001` denominator offset. It also contains an older mean/variance set rather than the tensors that reproduce the cached features used to train this checkpoint.

Measured on five original WAV/cache pairs, the current path changes 39.22% of raw model decisions and reduces non-neutral target accuracy from 53.35% to 29.96% on that diagnostic subset. A Meyda version change is not responsible: the historical fork and current package produce identical outputs.

### P0: model timing semantics

Training rolls targets by six 10 ms frames. A prediction at acoustic feature time `t` therefore represents the target at `t - 60 ms`. Event timing must expose this trained offset in addition to any smoothing correction.

The centered delta requires two future feature frames. This look-ahead affects when a result becomes available but must not silently change the timestamp of the feature/target it describes.

### P1: input resampling

Inputs not already at 48 kHz must be resampled to 48 kHz. The current linear 48-to-44.1 kHz resampler is not band-limited and can alias frequencies above the lower Nyquist limit. Replace it with a streaming windowed-sinc resampler whose output is invariant to input chunk boundaries.

### P1: output score semantics

The current `confidence` value is the winning raw logit. Emit a softmax probability as `confidence` and retain the winning raw value separately as `logit` for diagnostics and backward investigation.

### P1: silence and state handling

- Stateful browser inference matches training better than the stateless 2024 ONNX service and must be retained.
- Reset recurrent state at explicit stream discontinuities and after sustained silence.
- The built-in energy gate is heuristic. Keep the external speaking/VAD override and document it as the preferred production path.

### P2: capture conditioning

The legacy 3x gain/compressor graph and browser microphone AEC/noise suppression are not present in the training notebook. Preserve the conditioner for compatibility in this change, but keep it optional and document the potential domain shift. Evaluate it independently with representative microphone recordings before changing its default.

### P2: quantization

The uint8 TensorFlow.js model changes approximately 1.8% of decisions versus the float export on the five-clip diagnostic set. Keep the quantized model for this pass because preprocessing dominates the observed error. Reconsider float weights only after exact-feature quality and performance have been measured in target browsers.

## Implementation sequence

1. Add a torchaudio-compatible feature extractor with precomputed Hann, mel, DCT, and FFT data.
2. Change the model clock to 48 kHz, 1,200 samples, and 480-sample hops.
3. Compute centered, reflect-padded MFCC frames and independent forward energy frames with matching timestamps.
4. Restore the normalization tensors that generated the training caches, restore the epsilon, and remove the MFCC-0 workaround by replacing the Meyda path entirely.
5. Replace the linear resampler with a streaming band-limited resampler.
6. Apply the trained 60 ms label offset to `effectiveTimestamp` and expose softmax confidence plus raw logit.
7. Update README, model card, public types, provenance notes, and package notices as needed.
8. Add parity, streaming, model, timing, and API regression tests.

## Acceptance criteria

- A committed deterministic PCM fixture reproduces feature frames generated by the original torchaudio environment within a documented numerical tolerance, and an available original WAV/cache pair passes the same audit.
- Feature output is invariant to PCM chunk boundaries.
- Resampler output is invariant to PCM chunk boundaries and suppresses frequencies above the output Nyquist limit.
- Stateful float TensorFlow.js decisions match PyTorch on the historical conversion sequence.
- Quantized-model differences remain measured and explicitly tolerated rather than hidden by preprocessing drift.
- `effectiveTimestamp` includes both smoothing correction and the trained 60 ms target offset.
- `confidence` is finite and in `[0, 1]`; `logit` preserves the raw winning score.
- `npm run check` passes and the repository contains no generated package archive or unrelated changes.

## Implementation status

Completed in this change:

- Replaced Meyda with a torchaudio-compatible 1,200-point Bluestein FFT, periodic Hann, recovered mel filters, orthonormal DCT, and independent energy calculation.
- Restored the mean/variance tensors that reproduce the training caches and the `0.001` normalization offset.
- Moved the model clock to 48 kHz with 480-sample hops.
- Added a chunk-invariant, band-limited streaming resampler for non-48-kHz inputs.
- Applied the trained 60 ms target offset to `effectiveTimestamp`.
- Changed `confidence` to a softmax probability and added the raw winning `logit`.
- Removed the Meyda dependency, added FFT.js, regenerated notices, and updated public documentation/types.
- Added deterministic torchaudio golden tests, chunk-boundary tests, anti-aliasing tests, timing tests, and confidence tests.

Validation results:

- Five original WAV/cache pairs, 2,017 stable frames: feature MAE `0.00000918`, RMSE `0.00002745`, maximum error `0.00054014`.
- The deployed quantized model produced the same class for all 2,017 JavaScript and cached-training feature frames.
- Diagnostic all-target and non-neutral accuracy returned exactly to the cached-feature baseline (`66.93%` and `53.35%`, respectively).
- Ten seconds of feature extraction took approximately 246 ms in Node on the audit machine (`0.246 ms/frame`).
- `npm run check` passes all tests, build, license, and package-content checks.

## Residual risks

- The exact 300-unit training run configuration and epoch are not recorded in Git.
- Browser input processing and the legacy conditioner may still create a training-domain mismatch.
- Boundary frames in the notebook used circular delta rolls, while a streaming implementation cannot use end-of-file samples at stream start. Golden parity is therefore required for stable interior frames; boundary policy must be explicit.
- Correct preprocessing adds FFT and look-ahead work. Performance must be checked in representative browsers, especially on low-power devices.
