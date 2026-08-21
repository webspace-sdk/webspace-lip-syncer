// Copyright 2020-2026 Greg Fodor
// SPDX-License-Identifier: Apache-2.0

import * as tf from "@tensorflow/tfjs";
import { setWasmPaths } from "@tensorflow/tfjs-backend-wasm";
import "@tensorflow/tfjs-backend-wasm";

import { MODEL_HOP_SIZE, MODEL_SAMPLE_RATE, MODEL_VISEME_COUNT } from "../core/constants.js";
import { argMax, buildNormalizedFeatures } from "../core/features.js";
import { resetStatefulLayers } from "../core/reset-model-state.js";
import { softmaxProbability } from "../core/scores.js";
import { StreamingSincResampler } from "../core/streaming-resampler.js";
import { targetTimestamp } from "../core/timing.js";
import { TorchaudioFeatureStream } from "../core/torchaudio-features.js";
import { VisemeSmoother } from "../core/viseme-smoother.js";

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
    this.silenceThresholdDb = silenceThresholdDb;
    this.silenceHoldSeconds = silenceHoldMs / 1000;
    this.resampler = new StreamingSincResampler(inputSampleRate, MODEL_SAMPLE_RATE);
    this.featureStream = new TorchaudioFeatureStream();
    this.smoother = new VisemeSmoother({ agreementFrames, minimumFrames: minimumVisemeFrames });
    this.reset();
  }

  reset() {
    this.resampler?.reset();
    this.featureStream?.reset();
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
    this.featureStream.push(resampled, (features, frameSample, levelDb) =>
      this.processFeatureFrame(features, frameSample, levelDb)
    );
  }

  processFeatureFrame(features, frameSample, levelDb) {
    const featureTimestamp = this.baseTimestamp + frameSample / MODEL_SAMPLE_RATE;
    this.rawFeatureFrames.push(features);
    this.rawFeatureTimes.push(featureTimestamp);
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
      this.emitViseme(
        smoothed.viseme,
        timestamp,
        targetTimestamp(timestamp),
        1,
        null,
        false,
        levelDb,
        smoothed.changed
      );
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

      const confidence = softmaxProbability(values, best.index, MODEL_VISEME_COUNT);
      if (!Number.isFinite(confidence)) {
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
        targetTimestamp(timestamp, smoothingDelay),
        confidence,
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

  emitViseme(viseme, timestamp, effectiveTimestamp, confidence, logit, speaking, levelDb, changed) {
    self.postMessage({
      type: "viseme",
      detail: { viseme, timestamp, effectiveTimestamp, confidence, logit, speaking, levelDb, changed }
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
