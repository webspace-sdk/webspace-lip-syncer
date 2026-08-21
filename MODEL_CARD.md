# Model card

## Summary

The bundled TensorFlow.js model maps streaming speech features to one of 12
mouth-shape classes (visemes 0-11). Viseme 0 is also used as the neutral/silent
mouth. Inference runs locally in a browser worker.

## Inputs and outputs

- Input audio: mono PCM, resampled internally to 48 kHz when necessary.
- Analysis: torchaudio-0.6-compatible 1200-sample windows, 480-sample hops,
  13 log-mel MFCC values plus independently calculated log energy, with
  centered first derivatives.
- Model input: 28 normalized features per prediction.
- Model output: 12 class logits. The package emits the selected viseme,
  softmax confidence, raw winning logit, audio-context timestamp, signal
  level, and speaking state.

The centered derivative uses two future feature frames. Training also shifted
targets by six 10 ms frames, so `effectiveTimestamp` is 60 ms earlier than the
acoustic feature time before any smoothing correction. Consumers should expect
feature look-ahead and buffering latency in addition to model inference time.

## Provenance and license

The model was trained and authored by Greg Fodor for the Webspace lip-sync
implementation. It is offered in this separate distribution under Apache-2.0.
The weight shard is 398,412 bytes. The extraction script preserves the original
TensorFlow.js topology and weights and adds license metadata to the manifest.

## Intended use and limitations

The model is intended for responsive visual animation from speech, not speech
recognition, speaker identification, biometric analysis, or accessibility
transcription. Accuracy can vary by voice, language, microphone, noise level,
optional legacy conditioning, and browser audio processing. The built-in energy
gate is a fallback; a production VAD can drive `setSpeaking`. The class IDs are
animation categories, not a phonetic transcript.
