// Copyright 2026 Greg Fodor
// SPDX-License-Identifier: Apache-2.0

import FFT from "fft.js";

import { MODEL_HOP_SIZE, MODEL_SAMPLE_RATE, MODEL_WINDOW_SIZE } from "./constants.js";

const MEL_BANDS = 26;
const MFCC_COUNT = 13;
const SPECTRUM_BINS = MODEL_WINDOW_SIZE / 2 + 1;
const HALF_WINDOW = MODEL_WINDOW_SIZE / 2;
const LOG_MEL_OFFSET = 1e-6;
const LOG_ENERGY_OFFSET = 0.001;

function nextPowerOfTwo(value) {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

// fft.js only accepts radix-2 sizes. Bluestein's algorithm evaluates the
// exact 1200-point DFT used by the training transform through a 4096-point
// convolution without changing the frequency grid.
class BluesteinRealFft {
  constructor(size) {
    this.size = size;
    this.convolutionSize = nextPowerOfTwo(size * 2 - 1);
    this.fft = new FFT(this.convolutionSize);
    this.chirpReal = new Float64Array(size);
    this.chirpImag = new Float64Array(size);
    this.input = this.fft.createComplexArray();
    this.inputSpectrum = this.fft.createComplexArray();
    this.product = this.fft.createComplexArray();
    this.convolution = this.fft.createComplexArray();

    const kernel = this.fft.createComplexArray();
    for (let i = 0; i < size; i += 1) {
      const angle = (Math.PI * i * i) / size;
      const real = Math.cos(angle);
      const imag = Math.sin(angle);
      this.chirpReal[i] = real;
      this.chirpImag[i] = imag;
      kernel[i * 2] = real;
      kernel[i * 2 + 1] = imag;
      if (i > 0) {
        const mirrored = this.convolutionSize - i;
        kernel[mirrored * 2] = real;
        kernel[mirrored * 2 + 1] = imag;
      }
    }

    this.kernelSpectrum = this.fft.createComplexArray();
    this.fft.transform(this.kernelSpectrum, kernel);
  }

  powerSpectrum(signal, output) {
    this.input.fill(0);
    for (let i = 0; i < this.size; i += 1) {
      const value = signal[i];
      this.input[i * 2] = value * this.chirpReal[i];
      this.input[i * 2 + 1] = -value * this.chirpImag[i];
    }

    this.fft.transform(this.inputSpectrum, this.input);
    for (let i = 0; i < this.convolutionSize; i += 1) {
      const offset = i * 2;
      const inputReal = this.inputSpectrum[offset];
      const inputImag = this.inputSpectrum[offset + 1];
      const kernelReal = this.kernelSpectrum[offset];
      const kernelImag = this.kernelSpectrum[offset + 1];
      this.product[offset] = inputReal * kernelReal - inputImag * kernelImag;
      this.product[offset + 1] = inputReal * kernelImag + inputImag * kernelReal;
    }
    this.fft.inverseTransform(this.convolution, this.product);

    for (let i = 0; i < output.length; i += 1) {
      const offset = i * 2;
      const convolutionReal = this.convolution[offset];
      const convolutionImag = this.convolution[offset + 1];
      const real =
        convolutionReal * this.chirpReal[i] + convolutionImag * this.chirpImag[i];
      const imag =
        convolutionImag * this.chirpReal[i] - convolutionReal * this.chirpImag[i];
      output[i] = real * real + imag * imag;
    }
  }
}

function createPeriodicHann(size) {
  return Float32Array.from(
    { length: size },
    (_, index) => 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / size)
  );
}

function createMelFilterBank() {
  const melMin = 0;
  const melMax = 2595 * Math.log10(1 + MODEL_SAMPLE_RATE / 2 / 700);
  const melPoints = Float32Array.from(
    { length: MEL_BANDS + 2 },
    (_, index) => melMin + ((melMax - melMin) * index) / (MEL_BANDS + 1)
  );
  const frequencyPoints = Float32Array.from(
    melPoints,
    mel => 700 * (10 ** (mel / 2595) - 1)
  );
  const filters = Array.from({ length: MEL_BANDS }, () => new Float32Array(SPECTRUM_BINS));

  for (let mel = 0; mel < MEL_BANDS; mel += 1) {
    const left = frequencyPoints[mel];
    const center = frequencyPoints[mel + 1];
    const right = frequencyPoints[mel + 2];
    for (let bin = 0; bin < SPECTRUM_BINS; bin += 1) {
      const frequency = (bin * (MODEL_SAMPLE_RATE / 2)) / (SPECTRUM_BINS - 1);
      const lowerSlope = (frequency - left) / (center - left);
      const upperSlope = (right - frequency) / (right - center);
      filters[mel][bin] = Math.max(0, Math.min(lowerSlope, upperSlope));
    }
  }

  return filters;
}

function createOrthonormalDct() {
  return Array.from({ length: MFCC_COUNT }, (_, coefficient) => {
    const scale = coefficient === 0 ? 1 / Math.sqrt(MEL_BANDS) : Math.sqrt(2 / MEL_BANDS);
    return Float32Array.from(
      { length: MEL_BANDS },
      (_, mel) =>
        scale * Math.cos((Math.PI * coefficient * (mel + 0.5)) / MEL_BANDS)
    );
  });
}

export class TorchaudioFeatureExtractor {
  constructor() {
    this.hann = createPeriodicHann(MODEL_WINDOW_SIZE);
    this.melFilters = createMelFilterBank();
    this.dct = createOrthonormalDct();
    this.fft = new BluesteinRealFft(MODEL_WINDOW_SIZE);
    this.windowed = new Float64Array(MODEL_WINDOW_SIZE);
    this.power = new Float64Array(SPECTRUM_BINS);
    this.logMels = new Float64Array(MEL_BANDS);
  }

  extract(mfccWindow, energyWindow) {
    if (!(mfccWindow instanceof Float32Array) || mfccWindow.length !== MODEL_WINDOW_SIZE) {
      throw new TypeError(`MFCC window must contain ${MODEL_WINDOW_SIZE} Float32 samples`);
    }
    if (!(energyWindow instanceof Float32Array) || energyWindow.length !== MODEL_WINDOW_SIZE) {
      throw new TypeError(`Energy window must contain ${MODEL_WINDOW_SIZE} Float32 samples`);
    }

    for (let i = 0; i < MODEL_WINDOW_SIZE; i += 1) {
      this.windowed[i] = Math.fround(mfccWindow[i] * this.hann[i]);
    }
    this.fft.powerSpectrum(this.windowed, this.power);

    for (let mel = 0; mel < MEL_BANDS; mel += 1) {
      const filter = this.melFilters[mel];
      let energy = 0;
      for (let bin = 0; bin < SPECTRUM_BINS; bin += 1) {
        energy += this.power[bin] * filter[bin];
      }
      this.logMels[mel] = Math.log(energy + LOG_MEL_OFFSET);
    }

    const features = new Float32Array(MFCC_COUNT + 1);
    for (let coefficient = 0; coefficient < MFCC_COUNT; coefficient += 1) {
      const row = this.dct[coefficient];
      let value = 0;
      for (let mel = 0; mel < MEL_BANDS; mel += 1) {
        value += this.logMels[mel] * row[mel];
      }
      features[coefficient] = value;
    }

    let energy = 0;
    for (let i = 0; i < MODEL_WINDOW_SIZE; i += 1) {
      energy += energyWindow[i] * energyWindow[i];
    }
    features[MFCC_COUNT] = Math.log(energy + LOG_ENERGY_OFFSET);
    return features;
  }
}

export class TorchaudioFeatureStream {
  constructor({ extractor = new TorchaudioFeatureExtractor() } = {}) {
    this.extractor = extractor;
    this.reset();
  }

  reset() {
    this.samples = new Float32Array(0);
    this.bufferStart = 0;
    this.nextFrame = 0;
  }

  push(input, onFrame) {
    if (!(input instanceof Float32Array)) throw new TypeError("Audio input must be Float32Array");
    if (typeof onFrame !== "function") throw new TypeError("onFrame must be a function");
    if (input.length === 0) return;

    const combined = new Float32Array(this.samples.length + input.length);
    combined.set(this.samples);
    combined.set(input, this.samples.length);
    this.samples = combined;

    const availableEnd = this.bufferStart + this.samples.length;
    while (this.nextFrame * MODEL_HOP_SIZE + MODEL_WINDOW_SIZE <= availableEnd) {
      const frameSample = this.nextFrame * MODEL_HOP_SIZE;
      const mfccWindow = new Float32Array(MODEL_WINDOW_SIZE);
      const energyWindow = new Float32Array(MODEL_WINDOW_SIZE);

      for (let i = 0; i < MODEL_WINDOW_SIZE; i += 1) {
        const centeredIndex = frameSample - HALF_WINDOW + i;
        const reflectedIndex = centeredIndex < 0 ? -centeredIndex : centeredIndex;
        mfccWindow[i] = this.samples[reflectedIndex - this.bufferStart];
        energyWindow[i] = this.samples[frameSample + i - this.bufferStart];
      }

      let sumSquares = 0;
      for (let i = 0; i < energyWindow.length; i += 1) {
        sumSquares += energyWindow[i] * energyWindow[i];
      }
      const levelDb = 20 * Math.log10(Math.max(Math.sqrt(sumSquares / MODEL_WINDOW_SIZE), 1e-12));
      onFrame(this.extractor.extract(mfccWindow, energyWindow), frameSample, levelDb);
      this.nextFrame += 1;
    }

    const nextCenteredStart = this.nextFrame * MODEL_HOP_SIZE - HALF_WINDOW;
    const keepFrom = Math.max(0, nextCenteredStart);
    const discard = keepFrom - this.bufferStart;
    if (discard > 0) {
      this.samples = this.samples.slice(discard);
      this.bufferStart = keepFrom;
    }
  }
}
