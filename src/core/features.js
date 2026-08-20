// Copyright 2020-2026 Greg Fodor
// SPDX-License-Identifier: Apache-2.0

import { FEATURE_MEANS, FEATURE_VARIANCES, MODEL_FEATURE_COUNT } from "./constants.js";

export function buildNormalizedFeatures(frames) {
  if (!Array.isArray(frames) || frames.length !== 5) {
    throw new TypeError("Exactly five feature frames are required");
  }

  const [behind2, behind1, current, ahead1, ahead2] = frames;
  for (const frame of frames) {
    if (!(frame instanceof Float32Array) || frame.length !== 14) {
      throw new TypeError("Each feature frame must contain 14 Float32 values");
    }
  }

  const features = new Float32Array(MODEL_FEATURE_COUNT);
  for (let i = 0; i < 14; i += 1) {
    features[i] = (current[i] - FEATURE_MEANS[i]) / FEATURE_VARIANCES[i];
    const derivative = (ahead2[i] + ahead1[i] - behind1[i] - behind2[i]) / 4;
    features[14 + i] = (derivative - FEATURE_MEANS[14 + i]) / FEATURE_VARIANCES[14 + i];
  }

  return features;
}

export function argMax(values, count = values.length) {
  let bestIndex = -1;
  let bestValue = -Infinity;
  for (let i = 0; i < count; i += 1) {
    if (values[i] > bestValue) {
      bestIndex = i;
      bestValue = values[i];
    }
  }
  return { index: bestIndex, value: bestValue };
}
