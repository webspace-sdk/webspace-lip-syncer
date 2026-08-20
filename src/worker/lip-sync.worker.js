// Copyright 2020-2026 Greg Fodor
// SPDX-License-Identifier: Apache-2.0

import * as tf from "@tensorflow/tfjs";
import { setWasmPaths } from "@tensorflow/tfjs-backend-wasm";
import "@tensorflow/tfjs-backend-wasm";
import Meyda from "meyda";

import {
  MODEL_HOP_SIZE,
  MODEL_SAMPLE_RATE,
  MODEL_VISEME_COUNT,
  MODEL_WINDOW_SIZE
} from "../core/constants.js";
import { argMax, buildNormalizedFeatures } from "../core/features.js";
import { resetStatefulLayers } from "../core/reset-model-state.js";
import { SlidingWindowBuffer } from "../core/sliding-window-buffer.js";
import { StreamingLinearResampler } from "../core/streaming-resampler.js";
import { VisemeSmoother } from "../core/viseme-smoother.js";

const MFCC_FEATURES = ["mfcc", "energy"];

function serializeError(error) {
  return {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  };
}

class LipSyncInference {
  constructor({
    model,
    inputSampleRate,
    silenceThresholdDb = -50,
    silenceHoldMs = 120,
    agreementFrames = 3,
    minimumVisemeFrames = 2
  }) {
    this.model = model;
    this.inputSampleRate = inputSampleRate;
    this.silenceThresholdDb = silenceThresholdDb;
    this.silenceHoldSeconds = silenceHoldMs / 1000;
    this.resampler = new StreamingLinearResampler(inputSampleRate, MODEL_SAMPLE_RATE);
    this.windows = new SlidingWindowBuffer(MODEL_WINDOW_SIZE, MODEL_HOP_SIZE);
    this.smoother = new VisemeSmoother({ agreementFrames, minimumFrames: minimumVisemeFrames });
    this.reset();

    Meyda.sampleRate = MODEL_SAMPLE_RATE;
    Meyda.bufferSize = MODEL_WINDOW_SIZE;
    Meyda.hopSize = MODEL_HOP_SIZE;
    Meyda.melBands = 26;
    Meyda.numberOfMFCCCoefficients = 13;
    Meyda.windowingFunction = "hanning";
  }

  reset() {
    this.resampler?.reset();
    this.windows?.reset();
    this.smoother?.reset();
    this.rawFeatureFrames = [];
    this.rawFeatureTimes = [];
    this.rawLevels = [];
    this.baseTimestamp = null;
    this.externalSpeaking = null;
    this.lastSpeakingTimestamp = -Infinity;
    this.inSustainedSilence = true;
    this.resetModelState();
  }

  resetModelState() {
    resetStatefulLayers(this.model);
  }

  setSpeaking(speaking) {
    this.externalSpeaking = speaking == null ? null : Boolean(speaking);
  }

  pushAudio(samples, timestamp) {
    if (!(samples instanceof Float32Array)) throw new TypeError("Worker audio must be Float32Array data");
    if (this.baseTimestamp === null) this.baseTimestamp = Number.isFinite(timestamp) ? timestamp : 0;

    const resampled = this.resampler.process(samples);
    this.windows.push(resampled, (window, endSample) => this.processWindow(window, endSample));
  }

  processWindow(window, endSample) {
    const extracted = Meyda.extract(MFCC_FEATURES, window);
    if (!extracted || !extracted.mfcc || extracted.mfcc.length < 13) return;

    const raw = new Float32Array(14);
    raw[0] = -extracted.mfcc[0];
    for (let i = 1; i < 13; i += 1) raw[i] = extracted.mfcc[i];
    raw[13] = Math.log(Math.max(extracted.energy, 1e-12));

    const centerTimestamp = this.baseTimestamp + (endSample - MODEL_WINDOW_SIZE / 2) / MODEL_SAMPLE_RATE;
    let sumSquares = 0;
    for (let i = 0; i < window.length; i += 1) sumSquares += window[i] * window[i];
    const rms = Math.sqrt(sumSquares / window.length);
    const levelDb = 20 * Math.log10(Math.max(rms, 1e-12));

    this.rawFeatureFrames.push(raw);
    this.rawFeatureTimes.push(centerTimestamp);
    this.rawLevels.push(levelDb);

    if (this.rawFeatureFrames.length < 5) return;
    this.predict(this.rawFeatureFrames, this.rawFeatureTimes[2], this.rawLevels[2]);
    this.rawFeatureFrames.shift();
    this.rawFeatureTimes.shift();
    this.rawLevels.shift();
  }

  predict(frames, timestamp, levelDb) {
    const speaking = this.externalSpeaking ?? levelDb >= this.silenceThresholdDb;

    if (speaking) this.lastSpeakingTimestamp = timestamp;
    const sustainedSilence = !speaking && timestamp - this.lastSpeakingTimestamp >= this.silenceHoldSeconds;

    if (sustainedSilence) {
      if (!this.inSustainedSilence) this.resetModelState();
      this.inSustainedSilence = true;
      const smoothed = this.smoother.force(0);
      this.emitViseme(smoothed.viseme, timestamp, timestamp, 1, false, levelDb, smoothed.changed);
      return;
    }

    this.inSustainedSilence = false;
    const features = buildNormalizedFeatures(frames);
    const input = tf.tensor3d(features, [1, 1, features.length]);
    let prediction;

    try {
      prediction = this.model.predict(input);
      const values = prediction.dataSync();
      const best = argMax(values, MODEL_VISEME_COUNT);

      if (best.index < 0 || !Number.isFinite(best.value)) {
        this.resetModelState();
        return;
      }

      const smoothed = this.smoother.update(best.index);
      const smoothingDelay = smoothed.changed
        ? ((this.smoother.agreementFrames - 1) * MODEL_HOP_SIZE) / MODEL_SAMPLE_RATE
        : 0;
      this.emitViseme(
        smoothed.viseme,
        timestamp,
        timestamp - smoothingDelay,
        best.value,
        speaking,
        levelDb,
        smoothed.changed
      );
    } finally {
      input.dispose();
      if (prediction && typeof prediction.dispose === "function") prediction.dispose();
    }
  }

  emitViseme(viseme, timestamp, effectiveTimestamp, confidence, speaking, levelDb, changed) {
    self.postMessage({
      type: "viseme",
      detail: { viseme, timestamp, effectiveTimestamp, confidence, speaking, levelDb, changed }
    });
  }
}

let inference = null;
let audioPort = null;

function handleAudioMessage(event) {
  if (!inference || !event.data?.samples) return;
  const samples = new Float32Array(event.data.samples);
  inference.pushAudio(samples, event.data.timestamp);
}

self.onmessage = async event => {
  const message = event.data;

  try {
    switch (message?.type) {
      case "init": {
        const wasmBaseUrl = message.wasmBaseUrl || new URL("./wasm/", import.meta.url).href;
        setWasmPaths(wasmBaseUrl.endsWith("/") ? wasmBaseUrl : `${wasmBaseUrl}/`);
        await tf.setBackend("wasm");
        await tf.ready();
        const model = await tf.loadLayersModel(message.modelUrl);
        inference = new LipSyncInference({ model, ...message.options, inputSampleRate: message.inputSampleRate });
        self.postMessage({ type: "ready" });
        break;
      }

      case "audio":
        handleAudioMessage(event);
        break;

      case "attach-audio-port":
        audioPort?.close();
        audioPort = message.port;
        audioPort.onmessage = handleAudioMessage;
        audioPort.start();
        break;

      case "set-speaking":
        inference?.setSpeaking(message.speaking);
        break;

      case "reset":
        inference?.reset();
        break;

      case "destroy":
        audioPort?.close();
        audioPort = null;
        inference = null;
        self.close();
        break;
    }
  } catch (error) {
    self.postMessage({ type: "error", error: serializeError(error) });
  }
};
