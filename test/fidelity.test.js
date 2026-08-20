// Copyright 2026 Greg Fodor
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";

import Meyda from "meyda";

import {
  ANALYSIS_CONDITIONING,
  createAnalysisConditioner
} from "../src/core/analysis-conditioning.js";
import { encodePcm16Wav } from "../example/wav.js";

test("keeps the legacy Web Audio input conditioning", () => {
  const gainCalls = [];
  const gainNode = {
    gain: {
      setValueAtTime(value, time) {
        gainCalls.push([value, time]);
      }
    },
    connect(node) {
      this.connectedTo = node;
    }
  };
  const compressorNode = {
    threshold: {},
    knee: {},
    ratio: {},
    attack: {},
    release: {}
  };
  const context = {
    currentTime: 12.5,
    createGain: () => gainNode,
    createDynamicsCompressor: () => compressorNode
  };

  const conditioner = createAnalysisConditioner(context);
  assert.deepEqual(gainCalls, [[ANALYSIS_CONDITIONING.gain, 12.5]]);
  assert.equal(gainNode.connectedTo, compressorNode);
  for (const property of ["threshold", "knee", "ratio", "attack", "release"]) {
    assert.equal(compressorNode[property].value, ANALYSIS_CONDITIONING[property]);
  }
  assert.equal(conditioner.input, gainNode);
  assert.equal(conditioner.output, compressorNode);
});

test("matches the legacy Meyda MFCC and energy regression vector", () => {
  Meyda.sampleRate = 44100;
  Meyda.bufferSize = 1024;
  Meyda.hopSize = 441;
  Meyda.melBands = 26;
  Meyda.numberOfMFCCCoefficients = 13;
  Meyda.windowingFunction = "hanning";

  const signal = Float32Array.from(
    { length: 1024 },
    (_, i) =>
      0.2 * Math.sin((2 * Math.PI * 220 * i) / 44100) +
      0.08 * Math.sin((2 * Math.PI * 880 * i) / 44100)
  );
  const extracted = Meyda.extract(["mfcc", "energy"], signal);
  const expectedMfcc = [
    53.837672515460405,
    47.0921595580362,
    29.942042741469134,
    10.040427779733388,
    -4.344263628704414,
    -8.501283208714304,
    -3.4580968540420125,
    4.9323258759974244,
    9.40963146012237,
    5.314083233269576,
    -6.979729069430276,
    -22.432696460010597,
    -34.177760342172064
  ];

  assert.equal(extracted.mfcc.length, expectedMfcc.length);
  expectedMfcc.forEach((expected, index) =>
    assert.ok(Math.abs(extracted.mfcc[index] - expected) < 1e-10, `MFCC ${index} changed`)
  );
  assert.ok(Math.abs(extracted.energy - 8.900059796411297) < 1e-10);
});

test("encodes captured samples as a mono 16-bit WAV", () => {
  const wav = encodePcm16Wav([new Float32Array([-1, -0.5]), new Float32Array([0, 0.5, 1])], 48000);
  const view = new DataView(wav);
  const ascii = (offset, length) =>
    String.fromCharCode(...new Uint8Array(wav, offset, length));

  assert.equal(ascii(0, 4), "RIFF");
  assert.equal(ascii(8, 4), "WAVE");
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 48000);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 10);
  assert.deepEqual(
    Array.from({ length: 5 }, (_, index) => view.getInt16(44 + index * 2, true)),
    [-32768, -16384, 0, 16383, 32767]
  );
});
