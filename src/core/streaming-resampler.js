// Copyright 2026 Greg Fodor
// SPDX-License-Identifier: Apache-2.0

const DEFAULT_RADIUS = 24;

function sinc(value) {
  if (Math.abs(value) < 1e-12) return 1;
  const angle = Math.PI * value;
  return Math.sin(angle) / angle;
}

function blackman(distance, radius) {
  const position = distance / radius;
  if (Math.abs(position) >= 1) return 0;
  return 0.42 + 0.5 * Math.cos(Math.PI * position) + 0.08 * Math.cos(2 * Math.PI * position);
}

export class StreamingSincResampler {
  constructor(inputSampleRate, outputSampleRate, { radius = DEFAULT_RADIUS } = {}) {
    if (!(inputSampleRate > 0) || !(outputSampleRate > 0)) {
      throw new RangeError("Sample rates must be positive");
    }
    if (!Number.isInteger(radius) || radius < 4) {
      throw new RangeError("Resampler radius must be an integer of at least 4");
    }

    this.inputSampleRate = inputSampleRate;
    this.outputSampleRate = outputSampleRate;
    this.step = inputSampleRate / outputSampleRate;
    this.radius = radius;
    // Leave a transition band below the lower Nyquist frequency so the
    // finite Blackman-windowed kernel attenuates rather than aliases it.
    this.cutoff = Math.min(1, outputSampleRate / inputSampleRate) * 0.95;
    this.reset();
  }

  reset() {
    this.nextOutputPosition = 0;
    this.bufferStart = 0;
    this.samples = new Float32Array(0);
  }

  process(input) {
    if (!(input instanceof Float32Array)) {
      throw new TypeError("Audio input must be a Float32Array");
    }

    if (input.length === 0) return new Float32Array(0);
    if (this.inputSampleRate === this.outputSampleRate) return input.slice();

    const combined = new Float32Array(this.samples.length + input.length);
    combined.set(this.samples);
    combined.set(input, this.samples.length);
    this.samples = combined;

    const output = [];
    const availableEnd = this.bufferStart + this.samples.length;
    while (Math.floor(this.nextOutputPosition) + this.radius < availableEnd) {
      const center = Math.floor(this.nextOutputPosition);
      const first = center - this.radius + 1;
      const last = center + this.radius;
      let weighted = 0;
      let weightSum = 0;

      for (let index = first; index <= last; index += 1) {
        const reflectedIndex = index < 0 ? -index : index;
        const distance = this.nextOutputPosition - index;
        const weight = this.cutoff * sinc(this.cutoff * distance) * blackman(distance, this.radius);
        weighted += this.samples[reflectedIndex - this.bufferStart] * weight;
        weightSum += weight;
      }

      output.push(weighted / weightSum);
      this.nextOutputPosition += this.step;
    }

    const keepFrom = Math.max(0, Math.floor(this.nextOutputPosition) - this.radius);
    const discard = keepFrom - this.bufferStart;
    if (discard > 0) {
      this.samples = this.samples.slice(discard);
      this.bufferStart = keepFrom;
    }

    return Float32Array.from(output);
  }
}
