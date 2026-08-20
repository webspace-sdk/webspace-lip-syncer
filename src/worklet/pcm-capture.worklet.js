// Copyright 2026 Greg Fodor
// SPDX-License-Identifier: Apache-2.0

const PROCESSOR_NAME = "webspace-lip-sync-capture";

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.chunkSize = options.processorOptions?.chunkSize || 512;
    this.chunk = new Float32Array(this.chunkSize);
    this.chunkOffset = 0;
    this.chunkTimestamp = 0;
    this.outputPort = null;
    this.tapPort = null;

    this.port.onmessage = event => {
      if (event.data?.type === "attach-output-port") {
        this.outputPort?.close();
        this.outputPort = event.data.port;
      } else if (event.data?.type === "attach-tap-port") {
        this.tapPort?.close();
        this.tapPort = event.data.port;
      } else if (event.data?.type === "detach-tap-port") {
        this.detachTap();
      } else if (event.data?.type === "stop") {
        this.detachTap();
        this.outputPort?.close();
        this.outputPort = null;
      }
    };
  }

  detachTap() {
    if (!this.tapPort) return;
    if (this.chunkOffset > 0) {
      const partial = this.chunk.slice(0, this.chunkOffset);
      this.tapPort.postMessage(
        { type: "audio", samples: partial.buffer, timestamp: this.chunkTimestamp },
        [partial.buffer]
      );
    }
    this.tapPort.postMessage({ type: "stopped" });
    this.tapPort.close();
    this.tapPort = null;
  }

  process(inputs, outputs) {
    const output = outputs[0]?.[0];
    if (output) output.fill(0);

    const input = inputs[0]?.[0];
    if (!input || (!this.outputPort && !this.tapPort)) return true;

    let inputOffset = 0;
    while (inputOffset < input.length) {
      if (this.chunkOffset === 0) this.chunkTimestamp = (currentFrame + inputOffset) / sampleRate;

      const copyCount = Math.min(input.length - inputOffset, this.chunk.length - this.chunkOffset);
      this.chunk.set(input.subarray(inputOffset, inputOffset + copyCount), this.chunkOffset);
      inputOffset += copyCount;
      this.chunkOffset += copyCount;

      if (this.chunkOffset === this.chunk.length) {
        const completed = this.chunk;
        if (this.tapPort) {
          const tapCopy = completed.slice();
          this.tapPort.postMessage(
            { type: "audio", samples: tapCopy.buffer, timestamp: this.chunkTimestamp },
            [tapCopy.buffer]
          );
        }
        if (this.outputPort) {
          this.outputPort.postMessage(
            { samples: completed.buffer, timestamp: this.chunkTimestamp },
            [completed.buffer]
          );
        }
        this.chunk = new Float32Array(this.chunkSize);
        this.chunkOffset = 0;
      }
    }

    return true;
  }
}

registerProcessor(PROCESSOR_NAME, PcmCaptureProcessor);
