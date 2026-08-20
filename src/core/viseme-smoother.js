// Copyright 2026 Greg Fodor
// SPDX-License-Identifier: Apache-2.0

export class VisemeSmoother {
  constructor({ initialViseme = 0, agreementFrames = 3, minimumFrames = 2 } = {}) {
    this.initialViseme = initialViseme;
    this.agreementFrames = agreementFrames;
    this.minimumFrames = minimumFrames;
    this.reset();
  }

  reset() {
    this.currentViseme = this.initialViseme;
    this.currentDuration = 0;
    this.history = new Array(this.agreementFrames).fill(this.initialViseme);
    this.historyIndex = 0;
  }

  force(viseme) {
    const changed = viseme !== this.currentViseme;
    this.currentViseme = viseme;
    this.currentDuration = 0;
    this.history.fill(viseme);
    return { viseme, changed };
  }

  update(candidate) {
    this.history[this.historyIndex] = candidate;
    this.historyIndex = (this.historyIndex + 1) % this.history.length;

    let changed = false;
    if (
      candidate !== this.currentViseme &&
      this.currentDuration >= this.minimumFrames &&
      this.history.every(value => value === candidate)
    ) {
      this.currentViseme = candidate;
      this.currentDuration = 0;
      changed = true;
    }

    this.currentDuration += 1;
    return { viseme: this.currentViseme, changed };
  }
}
