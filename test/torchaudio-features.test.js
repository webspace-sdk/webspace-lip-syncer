// Copyright 2026 Greg Fodor
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";

import { buildNormalizedFeatures } from "../src/core/features.js";
import { TorchaudioFeatureStream } from "../src/core/torchaudio-features.js";

// Generated with the project's original PyTorch 1.6 / torchaudio 0.6
// environment and the exact transform in LipSync1.ipynb. These are frames
// 2-5; streaming deliberately omits the notebook's circular boundary deltas.
const EXPECTED = [
  [-0.009122001007199287, 0.018950441852211952, 0.7452030777931213, 0.2430591732263565, 0.029840176925063133, -0.3389444053173065, -0.6805497407913208, -0.29504039883613586, 1.7663321495056152, 2.987182140350342, 2.264780044555664, -3.4184279441833496, -5.008475303649902, 0.37188783288002014, -0.6417394280433655, -0.5535432696342468, 2.021998643875122, 2.6652748584747314, 0.3006961941719055, -1.8681573867797852, -4.606553554534912, -2.472057819366455, 5.040585041046143, 9.986351013183594, 5.723874092102051, -9.824079513549805, -9.111567497253418, 0.004277748987078667],
  [-0.009065342135727406, 0.01904599741101265, 0.7446038126945496, 0.2418510913848877, 0.03024175763130188, -0.33697816729545593, -0.6792120933532715, -0.299414724111557, 1.7611396312713623, 2.98949933052063, 2.275502920150757, -3.414839744567871, -5.021632671356201, 0.3719687759876251, -0.209042489528656, -0.21570010483264923, 0.7386645674705505, 1.1886911392211914, 0.21366752684116364, -0.8431392908096313, -1.9700396060943604, -1.240617275238037, 1.7829198837280273, 3.891209602355957, 2.1777305603027344, -3.645578145980835, -2.9877631664276123, -0.004379225894808769],
  [-0.010419758968055248, 0.015822967514395714, 0.7528224587440491, 0.2708231806755066, 0.05064089223742485, -0.3512898087501526, -0.7390247583389282, -0.35166680812835693, 1.7891957759857178, 3.084826707839966, 2.367891788482666, -3.4198861122131348, -5.123935222625732, 0.37298470735549927, -0.0045604100450873375, -0.00962285976856947, 0.010489815846085548, 0.05920125171542168, 0.06173801049590111, -0.022148780524730682, -0.1094110831618309, -0.11778150498867035, 0.00791247934103012, 0.1518060863018036, 0.17207151651382446, 0.02099297195672989, -0.15573827922344208, 0.002754471730440855],
  [-0.008501325733959675, 0.020364250987768173, 0.7411247491836548, 0.23010952770709991, 0.022503694519400597, -0.330669105052948, -0.655351459980011, -0.2808341681957245, 1.7468196153640747, 2.950167655944824, 2.241863965988159, -3.4064345359802246, -4.979834079742432, 0.37125372886657715, 0.0004487871774472296, 0.0005989719065837562, -0.002125605707988143, -0.005634875036776066, 0.001792126684449613, 0.012903479859232903, 0.00606834189966321, -0.012454811483621597, -0.01606513187289238, 0.0052530341781675816, 0.023270124569535255, 0.007806107867509127, -0.023710783571004868, -0.0002009332674788311]
];

function signal() {
  return Float32Array.from(
    { length: 4800 },
    (_, index) =>
      0.2 * Math.sin((2 * Math.PI * 220 * index) / 48000) +
      0.08 * Math.cos((2 * Math.PI * 880 * index) / 48000) +
      ((index % 17) - 8) * 1e-4
  );
}

function extractWithChunks(chunkSize) {
  const stream = new TorchaudioFeatureStream();
  const raw = [];
  const normalized = [];
  const frameSamples = [];
  const input = signal();
  for (let offset = 0; offset < input.length; offset += chunkSize) {
    stream.push(input.slice(offset, offset + chunkSize), (features, frameSample) => {
      raw.push(features);
      if (raw.length >= 5) {
        normalized.push(buildNormalizedFeatures(raw.slice(-5)));
        frameSamples.push(frameSample - 960);
      }
    });
  }
  return { normalized, frameSamples };
}

test("matches the historical torchaudio feature transform", () => {
  const { normalized, frameSamples } = extractWithChunks(137);
  assert.deepEqual(frameSamples, [960, 1440, 1920, 2400]);
  assert.equal(normalized.length, EXPECTED.length);
  for (let frame = 0; frame < EXPECTED.length; frame += 1) {
    for (let feature = 0; feature < 28; feature += 1) {
      const difference = Math.abs(normalized[frame][feature] - EXPECTED[frame][feature]);
      assert.ok(difference < 2e-4, `frame ${frame}, feature ${feature}: ${difference}`);
    }
  }
});

test("feature extraction is invariant to PCM chunk boundaries", () => {
  const whole = extractWithChunks(4800);
  const chunked = extractWithChunks(113);
  assert.deepEqual(chunked.frameSamples, whole.frameSamples);
  assert.deepEqual(chunked.normalized, whole.normalized);
});
