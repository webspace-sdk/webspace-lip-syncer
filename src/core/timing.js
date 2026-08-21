// Copyright 2026 Greg Fodor
// SPDX-License-Identifier: Apache-2.0

import { MODEL_LABEL_DELAY_SECONDS } from "./constants.js";

export function targetTimestamp(featureTimestamp, smoothingDelay = 0) {
  return featureTimestamp - MODEL_LABEL_DELAY_SECONDS - smoothingDelay;
}
