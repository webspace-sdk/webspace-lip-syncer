// Copyright 2026 Greg Fodor
// SPDX-License-Identifier: Apache-2.0

import { PcmLipSyncer } from "./pcm-lip-syncer.js";
import { createAnalysisConditioner } from "./core/analysis-conditioning.js";

const DEFAULT_WORKLET_URL = new URL("./pcm-capture.worklet.js", import.meta.url);

function detailEvent(type, detail) {
  if (typeof CustomEvent === "function") return new CustomEvent(type, { detail });
  const event = new Event(type);
  Object.defineProperty(event, "detail", { value: detail });
  return event;
}

export class WebAudioLipSyncer extends EventTarget {
  static async create(audioContext, options = {}) {
    if (!audioContext?.audioWorklet) throw new TypeError("An AudioContext with AudioWorklet support is required");

    const pcm = await PcmLipSyncer.create({ ...options, inputSampleRate: audioContext.sampleRate });
    try {
      await audioContext.audioWorklet.addModule(options.workletUrl || DEFAULT_WORKLET_URL);
      return new WebAudioLipSyncer(audioContext, pcm, options);
    } catch (error) {
      pcm.destroy();
      throw error;
    }
  }

  constructor(audioContext, pcm, { chunkSize = 512, conditionAudio = true, sourceNode } = {}) {
    super();
    this.audioContext = audioContext;
    this.pcm = pcm;
    this.sourceNode = null;
    this.destroyed = false;
    this.pcmTapPort = null;

    this.captureNode = new AudioWorkletNode(audioContext, "webspace-lip-sync-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: "explicit",
      processorOptions: { chunkSize }
    });

    this.silentGain = audioContext.createGain();
    this.silentGain.gain.value = 0;
    this.captureNode.connect(this.silentGain);
    this.silentGain.connect(audioContext.destination);

    this.conditioner = conditionAudio ? createAnalysisConditioner(audioContext) : null;
    this.analysisInputNode = this.conditioner?.input || this.captureNode;
    if (this.conditioner) this.conditioner.output.connect(this.captureNode);

    const channel = new MessageChannel();
    this.captureNode.port.postMessage({ type: "attach-output-port", port: channel.port1 }, [channel.port1]);
    this.pcm.attachAudioPort(channel.port2);

    this.forwardViseme = event => this.dispatchEvent(detailEvent("viseme", event.detail));
    this.forwardError = event => this.dispatchEvent(detailEvent("error", event.detail));
    this.pcm.addEventListener("viseme", this.forwardViseme);
    this.pcm.addEventListener("error", this.forwardError);

    if (sourceNode) this.connect(sourceNode);
  }

  get currentViseme() {
    return this.pcm.currentViseme;
  }

  connect(sourceNode) {
    this.assertActive();
    if (!sourceNode?.connect) throw new TypeError("sourceNode must be an AudioNode");
    this.disconnect();
    this.sourceNode = sourceNode;
    this.sourceNode.connect(this.analysisInputNode);
    return this;
  }

  disconnect() {
    if (!this.sourceNode) return;
    this.sourceNode.disconnect(this.analysisInputNode);
    this.sourceNode = null;
  }

  createPcmTap() {
    this.assertActive();
    if (this.pcmTapPort) throw new Error("A PCM tap is already attached");

    const channel = new MessageChannel();
    this.captureNode.port.postMessage({ type: "attach-tap-port", port: channel.port1 }, [channel.port1]);
    this.pcmTapPort = channel.port2;
    return channel.port2;
  }

  detachPcmTap() {
    if (!this.pcmTapPort) return;
    this.captureNode.port.postMessage({ type: "detach-tap-port" });
    this.pcmTapPort = null;
  }

  setSpeaking(speaking) {
    this.pcm.setSpeaking(speaking);
  }

  reset() {
    this.pcm.reset();
  }

  destroy() {
    if (this.destroyed) return;
    this.disconnect();
    this.destroyed = true;
    this.detachPcmTap();
    this.captureNode.port.postMessage({ type: "stop" });
    this.captureNode.disconnect();
    this.conditioner?.gainNode.disconnect();
    this.conditioner?.compressorNode.disconnect();
    this.silentGain.disconnect();
    this.pcm.removeEventListener("viseme", this.forwardViseme);
    this.pcm.removeEventListener("error", this.forwardError);
    this.pcm.destroy();
  }

  assertActive() {
    if (this.destroyed) throw new Error("Lip syncer has been destroyed");
  }
}
