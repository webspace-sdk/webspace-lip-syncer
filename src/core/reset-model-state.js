// Copyright 2026 Greg Fodor
// SPDX-License-Identifier: Apache-2.0

export function resetStatefulLayers(model) {
  let resetCount = 0;
  for (const layer of model?.layers || []) {
    if (layer.stateful === true && typeof layer.resetStates === "function") {
      layer.resetStates();
      resetCount += 1;
    }
  }
  return resetCount;
}
