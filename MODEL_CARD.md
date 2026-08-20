# Model card

## Summary

The bundled TensorFlow.js model maps streaming speech features to one of 12
mouth-shape classes (visemes 0-11). Viseme 0 is also used as the neutral/silent
mouth. Inference runs locally in a browser worker.

## Inputs and outputs

- Input audio: mono PCM, resampled internally to 44.1 kHz.
- Analysis: 1024-sample windows, 441-sample hops, 13 MFCC values plus log
  energy, with centered first derivatives.
- Model input: 28 normalized features per prediction.
- Model output: 12 class scores. The package emits the selected viseme,
  confidence, audio-context timestamp, signal level, and speaking state.

The centered derivative uses two future feature frames. Consumers should
therefore expect a small amount of algorithmic look-ahead in addition to model
loading and inference time.

## Provenance and license

The model was trained and authored by Greg Fodor for the Webspace lip-sync
implementation. It is offered in this separate distribution under Apache-2.0.
The weight shard is 398,412 bytes. The extraction script preserves the original
TensorFlow.js topology and weights and adds license metadata to the manifest.

## Intended use and limitations

The model is intended for responsive visual animation from speech, not speech
recognition, speaker identification, biometric analysis, or accessibility
transcription. Accuracy can vary by voice, language, microphone, noise level,
and browser audio processing. The class IDs are animation categories, not a
phonetic transcript.
