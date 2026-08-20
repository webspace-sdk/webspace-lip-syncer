# Webspace Lip Syncer

A standalone browser lip-sync engine that converts streaming mono PCM audio
into timestamped viseme frames. It has no dependency on Webspace Engine,
WebRTC, insertable streams, or networked-aframe.

The package is Apache-2.0. Bundled third-party components are permissively
licensed and listed in `THIRD_PARTY_NOTICES.txt`. See `PROVENANCE.md` for the
authorship and relicensing review.

## Try the record/playback example

```sh
npm install
npm run dev
```

The dev command builds the package and serves `/example/` at the URL printed in
the terminal. Grant microphone access, record a short sample, then play it back. The example records PCM
from the same AudioWorklet sample clock used for inference, so playback audio
and viseme timestamps share an exact origin rather than relying on
`MediaRecorder` container timing. It animates the included mouth SVGs during
both live recording and playback. The SVGs use a vertical correction for their
original sphere-texture presentation; adjust `scaleY(0.72)` in
`example/style.css` if a different avatar surface needs another correction.

Microphone access requires localhost or HTTPS in current browsers.

## Web Audio API

```js
import { WebAudioLipSyncer } from "webspace-lip-syncer";

const context = new AudioContext();
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
const source = context.createMediaStreamSource(stream);
const lipSyncer = await WebAudioLipSyncer.create(context, { sourceNode: source });

lipSyncer.addEventListener("viseme", event => {
  const { viseme, timestamp, confidence, speaking, levelDb, changed } = event.detail;
  // Apply `viseme` to an avatar or serialize the frame for transport.
});

// Later:
lipSyncer.destroy();
stream.getTracks().forEach(track => track.stop());
```

`WebAudioLipSyncer` captures audio through an `AudioWorkletNode`, transfers
chunks directly to an inference worker over a `MessagePort`, and keeps the
capture branch silent. It does not alter or own the source node's other audio
connections. By default it also reproduces the model's original analysis
conditioning: 3x gain followed by a Web Audio compressor with a -12 dB
threshold, 0 dB knee, 20:1 ratio, 5 ms attack, and 50 ms release. Pass
`conditionAudio: false` only if the source has already been conditioned.

`createPcmTap()` returns a `MessagePort` carrying the exact conditioned PCM
chunks sent to inference (`{ type: "audio", samples, timestamp }`). Call
`detachPcmTap()` to flush the final partial chunk and receive a `stopped`
message. The example uses this tap to make its synchronized WAV recording.

## Raw PCM API

Use `PcmLipSyncer` when an application already has PCM samples:

```js
import { PcmLipSyncer } from "webspace-lip-syncer";

const lipSyncer = await PcmLipSyncer.create({ inputSampleRate: 48000 });
lipSyncer.addEventListener("viseme", event => console.log(event.detail));

// Push continuous mono samples. `timestamp` is the time of the first sample.
lipSyncer.push(float32Samples, timestampSeconds);
```

The current implementation treats successive pushes as one continuous stream;
call `reset()` after a seek or discontinuity. `setSpeaking(true | false)` can
override energy-based silence detection, and `setSpeaking(null)` restores the
internal detector. The model was calibrated against the conditioning described
above; raw-PCM integrations should apply equivalent input conditioning before
calling `push()`.

If a bundler does not preserve package-relative assets, pass explicit
`modelUrl`, `workerUrl`, `workletUrl`, and `wasmBaseUrl` options. Keeping those
URLs configurable is what lets the inference core work with ordinary static
hosting as well as application-specific asset pipelines.

## Viseme event

Each `viseme` event contains:

```ts
interface VisemeFrame {
  viseme: number;       // 0-11; 0 is neutral during silence
  timestamp: number;    // seconds on the input/audio-context timeline
  effectiveTimestamp: number; // transition onset, corrected for smoothing
  confidence: number;   // winning model score
  speaking: boolean;
  levelDb: number;
  changed: boolean;     // true when the smoothed output changes
}
```

## Architecture

The reusable seam is deliberately below application transport:

```text
AudioNode or Float32 PCM
        |
AudioWorklet capture (Web Audio adapter only)
        |
PCM worker: resample -> MFCC/energy -> model -> smoothing
        |
timestamped VisemeFrame events
        |
application-owned avatar, WebRTC metadata, recording, etc.
```

The package owns only PCM-to-viseme inference. Third parties can choose how to
render or transport the resulting events without importing any Webspace Engine
audio graph or networking code. RNNoise VAD, acoustic echo cancellation,
WebRTC metadata packing, and insertable-stream handling remain outside this
package boundary.

## Build and verification

```sh
npm test
npm run build
npm run check
```

The build bundles the worker dependencies, copies the TensorFlow.js WASM
backends, and generates notices from the dependency inputs actually included in
the bundles.
