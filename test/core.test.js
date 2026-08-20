// Copyright 2026 Greg Fodor
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";

import { buildNormalizedFeatures } from "../src/core/features.js";
import { resetStatefulLayers } from "../src/core/reset-model-state.js";
import { SlidingWindowBuffer } from "../src/core/sliding-window-buffer.js";
import { StreamingLinearResampler } from "../src/core/streaming-resampler.js";
import { VisemeSmoother } from "../src/core/viseme-smoother.js";

test("resamples a chunked 48 kHz stream to approximately 44.1 kHz", () => {
  const resampler = new StreamingLinearResampler(48000, 44100);
  let outputLength = 0;
  for (let offset = 0; offset < 48000; offset += 512) {
    const length = Math.min(512, 48000 - offset);
    const input = Float32Array.from({ length }, (_, i) => Math.sin(((offset + i) * Math.PI) / 100));
    outputLength += resampler.process(input).length;
  }
  assert.ok(outputLength >= 44098 && outputLength <= 44101, `unexpected output length ${outputLength}`);
});

test("emits overlapping windows at the requested hop", () => {
  const windows = new SlidingWindowBuffer(1024, 441);
  const ends = [];
  windows.push(new Float32Array(700), (_, end) => ends.push(end));
  windows.push(new Float32Array(1300), (_, end) => ends.push(end));
  assert.deepEqual(ends, [1024, 1465, 1906]);
});

test("builds the 28 model features from five frames", () => {
  const frames = Array.from({ length: 5 }, (_, frame) =>
    Float32Array.from({ length: 14 }, (_, feature) => frame * 0.25 + feature)
  );
  const features = buildNormalizedFeatures(frames);
  assert.equal(features.length, 28);
  assert.ok(features.every(Number.isFinite));
});

test("matches the legacy normalization and centered-derivative regression vector", () => {
  const frames = Array.from({ length: 5 }, (_, frame) =>
    Float32Array.from(
      { length: 14 },
      (_, feature) => Math.sin((frame + 1) * (feature + 1) * 0.17) + frame * 0.1
    )
  );
  const expected = new Float32Array([
    0.0754854753613472,
    -0.1562000960111618,
    0.1458899825811386,
    -0.1893281787633896,
    0.07225080579519272,
    -0.07926932722330093,
    0.06880674511194229,
    -0.1811789721250534,
    0.044945597648620605,
    -0.19532065093517303,
    -0.016745541244745255,
    0.24112871289253235,
    0.15188297629356384,
    0.19636884331703186,
    0.03345222398638725,
    0.09923078864812851,
    0.06999269127845764,
    -0.1941204071044922,
    -0.7893556952476501,
    -1.2862962484359741,
    -1.1505120992660522,
    -0.6343850493431091,
    0.2362852245569229,
    0.9143776297569275,
    1.1418719291687012,
    0.8404443264007568,
    0.3818301856517792,
    0.09379890561103821
  ]);

  assert.deepEqual(buildNormalizedFeatures(frames), expected);
});

test("requires agreement before changing visemes", () => {
  const smoother = new VisemeSmoother({ agreementFrames: 3, minimumFrames: 2 });
  smoother.update(0);
  smoother.update(0);
  assert.equal(smoother.update(4).viseme, 0);
  assert.equal(smoother.update(4).viseme, 0);
  const changed = smoother.update(4);
  assert.deepEqual(changed, { viseme: 4, changed: true });
});

test("resets only stateful model layers", () => {
  let statefulResets = 0;
  const model = {
    layers: [
      {
        stateful: true,
        resetStates() {
          statefulResets += 1;
        }
      },
      {
        stateful: false,
        resetStates() {
          throw new Error("non-stateful layer must not be reset");
        }
      }
    ]
  };

  assert.equal(resetStatefulLayers(model), 1);
  assert.equal(statefulResets, 1);
});
