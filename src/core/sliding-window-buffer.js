// Copyright 2026 Greg Fodor
// SPDX-License-Identifier: Apache-2.0

export class SlidingWindowBuffer {
  constructor(windowSize, hopSize) {
    if (!Number.isInteger(windowSize) || windowSize <= 0) throw new RangeError("windowSize must be positive");
    if (!Number.isInteger(hopSize) || hopSize <= 0) throw new RangeError("hopSize must be positive");

    this.windowSize = windowSize;
    this.hopSize = hopSize;
    this.reset();
  }

  reset() {
    this.buffer = new Float32Array(0);
    this.bufferStart = 0;
    this.nextWindowEnd = this.windowSize;
  }

  push(samples, onWindow) {
    if (!(samples instanceof Float32Array)) throw new TypeError("samples must be a Float32Array");
    if (typeof onWindow !== "function") throw new TypeError("onWindow must be a function");

    const combined = new Float32Array(this.buffer.length + samples.length);
    combined.set(this.buffer);
    combined.set(samples, this.buffer.length);
    this.buffer = combined;

    const availableEnd = this.bufferStart + this.buffer.length;
    while (this.nextWindowEnd <= availableEnd) {
      const absoluteStart = this.nextWindowEnd - this.windowSize;
      const relativeStart = absoluteStart - this.bufferStart;
      onWindow(this.buffer.slice(relativeStart, relativeStart + this.windowSize), this.nextWindowEnd);
      this.nextWindowEnd += this.hopSize;
    }

    const keepFrom = Math.max(this.bufferStart, this.nextWindowEnd - this.windowSize);
    const discardCount = keepFrom - this.bufferStart;
    if (discardCount > 0) {
      this.buffer = this.buffer.slice(discardCount);
      this.bufferStart = keepFrom;
    }
  }
}
