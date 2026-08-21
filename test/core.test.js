// Copyright 2026 Greg Fodor
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";

import { MODEL_LABEL_DELAY_SECONDS } from "../src/core/constants.js";
import { buildNormalizedFeatures } from "../src/core/features.js";
import { resetStatefulLayers } from "../src/core/reset-model-state.js";
import { softmaxProbability } from "../src/core/scores.js";
import { StreamingSincResampler } from "../src/core/streaming-resampler.js";
import { targetTimestamp } from "../src/core/timing.js";
import { VisemeSmoother } from "../src/core/viseme-smoother.js";

function concatenate(parts) {
  const output = new Float32Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

test("resamples independently of input chunk boundaries", () => {
  const input = Float32Array.from(
    { length: 44100 },
    (_, index) => Math.sin((2 * Math.PI * 997 * index) / 44100)
  );
  const whole = new StreamingSincResampler(44100, 48000).process(input);
  const chunkedResampler = new StreamingSincResampler(44100, 48000);
  const parts = [];
  for (let offset = 0; offset < input.length; offset += 137) {
    parts.push(chunkedResampler.process(input.slice(offset, offset + 137)));
  }
  const chunked = concatenate(parts);
  assert.deepEqual(chunked, whole);
  assert.ok(whole.length >= 47970 && whole.length <= 48000, `unexpected output length ${whole.length}`);
});

test("band-limited resampling suppresses frequencies above the output Nyquist limit", () => {
  const rmsAfterResampling = frequency => {
    const input = Float32Array.from(
      { length: 9600 },
      (_, index) => Math.sin((2 * Math.PI * frequency * index) / 96000)
    );
    const output = new StreamingSincResampler(96000, 48000).process(input);
    let sumSquares = 0;
    for (let i = 200; i < output.length; i += 1) sumSquares += output[i] * output[i];
    return Math.sqrt(sumSquares / (output.length - 200));
  };

  assert.ok(rmsAfterResampling(10000) > 0.65);
  assert.ok(rmsAfterResampling(30000) < 0.001);
});

test("builds the 28 model features from five frames", () => {
  const frames = Array.from({ length: 5 }, (_, frame) =>
    Float32Array.from({ length: 14 }, (_, feature) => frame * 0.25 + feature)
  );
  const features = buildNormalizedFeatures(frames);
  assert.equal(features.length, 28);
  assert.ok(features.every(Number.isFinite));
});

test("matches the training normalization and centered-derivative regression vector", () => {
  const frames = Array.from({ length: 5 }, (_, frame) =>
    Float32Array.from(
      { length: 14 },
      (_, feature) => Math.sin((frame + 1) * (feature + 1) * 0.17) + frame * 0.1
    )
  );
  const expected = new Float32Array([
    0.07822609692811966,
    -0.1554194837808609,
    0.1431225687265396,
    -0.18213096261024475,
    0.07652989029884338,
    -0.08874095231294632,
    0.08044426143169403,
    -0.17709048092365265,
    0.04381438344717026,
    -0.18358439207077026,
    -0.01765267737209797,
    0.25150012969970703,
    0.13990557193756104,
    0.19749104976654053,
    0.03324636444449425,
    0.09858020395040512,
    0.06964713335037231,
    -0.19357584416866302,
    -0.7856636047363281,
    -1.3052327632904053,
    -1.1492661237716675,
    -0.6370786428451538,
    0.23384729027748108,
    0.9110572338104248,
    1.1320382356643677,
    0.8506985902786255,
    0.3779269754886627,
    0.09208221733570099
  ]);

  assert.deepEqual(buildNormalizedFeatures(frames), expected);
});

test("reports softmax confidence while preserving the trained target offset", () => {
  const logits = new Float32Array([1, 2, 3]);
  const expected = Math.exp(3) / (Math.exp(1) + Math.exp(2) + Math.exp(3));
  assert.ok(Math.abs(softmaxProbability(logits, 2) - expected) < 1e-12);
  assert.equal(MODEL_LABEL_DELAY_SECONDS, 0.06);
  assert.ok(Math.abs(targetTimestamp(5, 0.02) - 4.92) < 1e-12);
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
