// Copyright 2026 Greg Fodor
// SPDX-License-Identifier: Apache-2.0

export function softmaxProbability(values, index, count = values.length) {
  if (index < 0 || index >= count || count > values.length) return NaN;

  let maximum = -Infinity;
  for (let i = 0; i < count; i += 1) maximum = Math.max(maximum, values[i]);
  if (!Number.isFinite(maximum)) return NaN;

  let total = 0;
  let selected = 0;
  for (let i = 0; i < count; i += 1) {
    const probability = Math.exp(values[i] - maximum);
    total += probability;
    if (i === index) selected = probability;
  }
  return selected / total;
}
