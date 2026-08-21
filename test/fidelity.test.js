// Copyright 2026 Greg Fodor
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";

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
