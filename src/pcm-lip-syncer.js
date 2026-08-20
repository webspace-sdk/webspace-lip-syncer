// Copyright 2026 Greg Fodor
// SPDX-License-Identifier: Apache-2.0

const DEFAULT_MODEL_URL = new URL("../model/model.json", import.meta.url);
const DEFAULT_WORKER_URL = new URL("./lip-sync.worker.js", import.meta.url);

function detailEvent(type, detail) {
  if (typeof CustomEvent === "function") return new CustomEvent(type, { detail });
  const event = new Event(type);
  Object.defineProperty(event, "detail", { value: detail });
  return event;
}

export class PcmLipSyncer extends EventTarget {
  static async create(options) {
    const instance = new PcmLipSyncer();
    await instance.initialize(options);
    return instance;
  }

  constructor() {
    super();
    this.worker = null;
    this.destroyed = false;
    this.currentViseme = 0;
  }

  async initialize({
    inputSampleRate,
    modelUrl = DEFAULT_MODEL_URL,
    workerUrl = DEFAULT_WORKER_URL,
    wasmBaseUrl,
    workerFactory,
    readyTimeoutMs = 30000,
    silenceThresholdDb = -50,
    silenceHoldMs = 120,
    agreementFrames = 3,
    minimumVisemeFrames = 2
  } = {}) {
    if (!(inputSampleRate > 0)) throw new RangeError("inputSampleRate is required and must be positive");

    this.worker = workerFactory
      ? workerFactory(workerUrl)
      : new Worker(workerUrl, { type: "module", name: "webspace-lip-sync-inference" });

    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Lip sync worker initialization timed out")),
          readyTimeoutMs
        );

        this.worker.onmessage = event => {
          const message = event.data;
          if (message?.type === "ready") {
            clearTimeout(timeout);
            resolve();
          } else if (message?.type === "error") {
            const error = new Error(message.error?.message || "Lip sync worker failed");
            error.stack = message.error?.stack || error.stack;
            clearTimeout(timeout);
            reject(error);
          } else {
            this.handleWorkerMessage(message);
          }
        };

        this.worker.onerror = event => {
          clearTimeout(timeout);
          reject(event.error || new Error(event.message || "Lip sync worker failed"));
        };

        this.worker.postMessage({
          type: "init",
          inputSampleRate,
          modelUrl: String(modelUrl),
          wasmBaseUrl: wasmBaseUrl ? String(wasmBaseUrl) : undefined,
          options: { silenceThresholdDb, silenceHoldMs, agreementFrames, minimumVisemeFrames }
        });
      });
    } catch (error) {
      this.worker?.terminate();
      this.worker = null;
      throw error;
    }

    this.worker.onmessage = event => this.handleWorkerMessage(event.data);
    this.worker.onerror = event => {
      const error = event.error || new Error(event.message || "Lip sync worker failed");
      this.dispatchEvent(detailEvent("error", error));
    };
  }

  handleWorkerMessage(message) {
    if (message?.type === "viseme") {
      this.currentViseme = message.detail.viseme;
      this.dispatchEvent(detailEvent("viseme", message.detail));
    } else if (message?.type === "error") {
      const error = new Error(message.error?.message || "Lip sync worker failed");
      error.stack = message.error?.stack || error.stack;
      this.dispatchEvent(detailEvent("error", error));
    }
  }

  push(samples, timestamp = 0) {
    this.assertActive();
    if (!(samples instanceof Float32Array)) throw new TypeError("samples must be a Float32Array");
    const copy = samples.slice();
    this.worker.postMessage({ type: "audio", samples: copy.buffer, timestamp }, [copy.buffer]);
  }

  attachAudioPort(port) {
    this.assertActive();
    this.worker.postMessage({ type: "attach-audio-port", port }, [port]);
  }

  setSpeaking(speaking) {
    this.assertActive();
    this.worker.postMessage({ type: "set-speaking", speaking });
  }

  reset() {
    this.assertActive();
    this.currentViseme = 0;
    this.worker.postMessage({ type: "reset" });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.worker?.postMessage({ type: "destroy" });
    this.worker?.terminate();
    this.worker = null;
  }

  assertActive() {
    if (this.destroyed || !this.worker) throw new Error("Lip syncer has been destroyed");
  }
}
