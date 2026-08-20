// Copyright 2026 Greg Fodor
// SPDX-License-Identifier: Apache-2.0

export class StreamingLinearResampler {
  constructor(inputSampleRate, outputSampleRate) {
    if (!(inputSampleRate > 0) || !(outputSampleRate > 0)) {
      throw new RangeError("Sample rates must be positive");
    }

    this.inputSampleRate = inputSampleRate;
    this.outputSampleRate = outputSampleRate;
    this.step = inputSampleRate / outputSampleRate;
    this.reset();
  }

  reset() {
    this.position = 0;
    this.carry = new Float32Array(0);
  }

  process(input) {
    if (!(input instanceof Float32Array)) {
      throw new TypeError("Audio input must be a Float32Array");
    }

    if (input.length === 0) return new Float32Array(0);
    if (this.inputSampleRate === this.outputSampleRate) return input.slice();

    const combined = new Float32Array(this.carry.length + input.length);
    combined.set(this.carry);
    combined.set(input, this.carry.length);

    const output = [];
    while (this.position + 1 < combined.length) {
      const index = Math.floor(this.position);
      const fraction = this.position - index;
      output.push(combined[index] + (combined[index + 1] - combined[index]) * fraction);
      this.position += this.step;
    }

    const consumed = Math.floor(this.position);
    this.carry = combined.slice(consumed);
    this.position -= consumed;
    return Float32Array.from(output);
  }
}
