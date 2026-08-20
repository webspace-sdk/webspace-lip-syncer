# Licensing and provenance

This repository is a separate Apache-2.0 distribution. No file in this
repository is licensed under MPL-2.0.

## First-party material

Greg Fodor is the author and copyright holder of the first-party source,
trained model, and viseme artwork in this distribution and offers them here
under Apache-2.0. The implementation was factored at a behavioral seam rather
than by copying the surrounding Webspace audio system or networking code.

The provenance review covered the complete public Git history, rather than the
shallow checkout alone:

- The legacy lip-sync worker, Web Audio worklet glue, model embedding, and the
  exact lip-sync call sites in the audio system trace to Greg Fodor.
- The general audio-system and acoustic-echo-cancellation code had other
  authors and was deliberately not copied.
- The legacy RNNoise/VAD and embedded toolchain output were not copied. The
  standalone package uses an original energy gate and also accepts an external
  speaking-state override.
- The viseme SVGs trace to Greg Fodor through their complete rename history.
  Visemes 0-11 originate in commit `aa9d598350d248cac4315ec39d941dd4119b2c11`
  ("Add avatar svg elements"). Viseme 12 is an empty/missing-mouth asset and is
  not included in the example.
- The extracted TensorFlow.js model is byte-for-byte the weight payload from
  the legacy worker. Its manifest records Greg Fodor and Apache-2.0 metadata.

This record establishes repository authorship evidence. It does not itself
resolve any separate employment, assignment, or work-for-hire agreement. The
Apache release relies on Greg Fodor's representation that no such agreement
transferred ownership of the listed first-party material.

## Third-party material

Runtime dependencies are permissively licensed. The build derives
`THIRD_PARTY_NOTICES.txt` from the packages actually present in the generated
bundles and fails if it encounters an unknown or non-permissive license.

The principal runtime components are TensorFlow.js (Apache-2.0 and MIT), Meyda
(MIT), and their permissively licensed transitive dependencies. Build and demo
tools are not incorporated into the runtime bundles.

## Release check

Before publishing, run:

```sh
npm run check
```

That command tests the extraction, builds the distributable files, regenerates
third-party notices, and inspects the npm package contents.
