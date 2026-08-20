// Copyright 2026 Greg Fodor
// SPDX-License-Identifier: Apache-2.0

import { WebAudioLipSyncer } from "/dist/index.js";
import { encodePcm16Wav } from "./wav.js";

const recordButton = document.querySelector("#record");
const stopButton = document.querySelector("#stop");
const playButton = document.querySelector("#play");
const audio = document.querySelector("#audio");
const mouth = document.querySelector("#mouth");
const status = document.querySelector("#status");
const mode = document.querySelector("#mode");
const visemeLabel = document.querySelector("#viseme");

let recording = null;
let playbackUrl = null;
let visemeTimeline = [];
let playbackFrame = 0;

function setMouth(viseme) {
  const safeViseme = Number.isInteger(viseme) && viseme >= 0 && viseme <= 11 ? viseme : 0;
  mouth.src = `./mouths/viseme-${safeViseme}.svg`;
  visemeLabel.textContent = String(safeViseme);
}

function waitForTapStop(pcmTap) {
  return new Promise(resolve => {
    const timeout = setTimeout(resolve, 1000);
    pcmTap.addEventListener(
      "message",
      event => {
        if (event.data?.type !== "stopped") return;
        clearTimeout(timeout);
        resolve();
      },
      { once: false }
    );
  });
}

async function cleanUpRecording() {
  if (!recording) return;
  recording.stream.getTracks().forEach(track => track.stop());
  recording.pcmTap.close();
  recording.lipSyncer.destroy();
  await recording.context.close();
  recording = null;
}

async function startRecording() {
  recordButton.disabled = true;
  playButton.disabled = true;
  status.textContent = "Requesting microphone access…";
  let pendingStream = null;
  let pendingContext = null;
  let pendingLipSyncer = null;

  try {
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode !== "function") {
      throw new Error("This browser does not support AudioWorklet microphone capture.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
    });
    pendingStream = stream;
    const context = new AudioContext();
    pendingContext = context;
    await context.resume();
    const source = context.createMediaStreamSource(stream);

    status.textContent = "Loading the local lip-sync model…";
    const lipSyncer = await WebAudioLipSyncer.create(context, { sourceNode: source });
    pendingLipSyncer = lipSyncer;
    const pcmTap = lipSyncer.createPcmTap();

    const state = {
      context,
      lipSyncer,
      pcmChunks: [],
      pcmStartTimestamp: null,
      pcmTap,
      stream,
      visemes: []
    };
    recording = state;

    pcmTap.addEventListener("message", event => {
      if (event.data?.type !== "audio" || !event.data.samples) return;
      if (state.pcmStartTimestamp === null) state.pcmStartTimestamp = event.data.timestamp;
      state.pcmChunks.push(new Float32Array(event.data.samples));
    });
    pcmTap.start();

    lipSyncer.addEventListener("viseme", event => {
      const frame = event.detail;
      setMouth(frame.viseme);
      state.visemes.push({ timestamp: frame.effectiveTimestamp ?? frame.timestamp, viseme: frame.viseme });
    });
    lipSyncer.addEventListener("error", event => {
      status.textContent = `Lip-sync error: ${event.detail.message}`;
    });

    pendingStream = null;
    pendingContext = null;
    pendingLipSyncer = null;
    stopButton.disabled = false;
    mode.textContent = "LIVE";
    status.textContent = "Recording. Speak naturally, then press Stop.";
  } catch (error) {
    if (recording) {
      await cleanUpRecording();
    } else {
      pendingStream?.getTracks().forEach(track => track.stop());
      pendingLipSyncer?.destroy();
      if (pendingContext && pendingContext.state !== "closed") await pendingContext.close();
    }
    recordButton.disabled = false;
    playButton.disabled = !playbackUrl;
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}

async function stopRecording() {
  if (!recording) return;
  stopButton.disabled = true;
  status.textContent = "Finishing the recording…";

  try {
    const state = recording;
    const tapStopped = waitForTapStop(state.pcmTap);
    state.lipSyncer.detachPcmTap();
    await tapStopped;

    if (state.pcmStartTimestamp === null || state.pcmChunks.length === 0) {
      throw new Error("No microphone samples were captured.");
    }

    const wav = encodePcm16Wav(state.pcmChunks, state.context.sampleRate);
    const duration = (wav.byteLength - 44) / 2 / state.context.sampleRate;
    visemeTimeline = [{ time: 0, viseme: 0 }];
    for (const frame of state.visemes) {
      const time = frame.timestamp - state.pcmStartTimestamp;
      if (time < 0 || time > duration) continue;
      const previous = visemeTimeline.at(-1);
      if (previous.viseme !== frame.viseme) visemeTimeline.push({ time, viseme: frame.viseme });
    }

    const blob = new Blob([wav], { type: "audio/wav" });
    if (playbackUrl) URL.revokeObjectURL(playbackUrl);
    playbackUrl = URL.createObjectURL(blob);
    audio.src = playbackUrl;
    audio.hidden = false;
    status.textContent = "Recorded. Press Play it back to replay the audio and visemes.";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    await cleanUpRecording();
    setMouth(0);
    mode.textContent = "READY";
    recordButton.disabled = false;
    playButton.disabled = !playbackUrl;
  }
}

function visemeAt(time) {
  let low = 0;
  let high = visemeTimeline.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (visemeTimeline[middle].time <= time) low = middle;
    else high = middle - 1;
  }
  return visemeTimeline[low]?.viseme ?? 0;
}

function animatePlayback() {
  setMouth(visemeAt(audio.currentTime));
  if (!audio.paused && !audio.ended) playbackFrame = requestAnimationFrame(animatePlayback);
}

async function playRecording() {
  if (!playbackUrl) return;
  cancelAnimationFrame(playbackFrame);
  audio.currentTime = 0;
  mode.textContent = "PLAYBACK";
  status.textContent = "Playing the recorded audio and viseme timeline.";
  await audio.play();
  animatePlayback();
}

recordButton.addEventListener("click", startRecording);
stopButton.addEventListener("click", () => void stopRecording());
playButton.addEventListener("click", () => void playRecording());
audio.addEventListener("play", () => {
  cancelAnimationFrame(playbackFrame);
  mode.textContent = "PLAYBACK";
  animatePlayback();
});
audio.addEventListener("pause", () => cancelAnimationFrame(playbackFrame));
audio.addEventListener("seeked", () => setMouth(visemeAt(audio.currentTime)));
audio.addEventListener("ended", () => {
  cancelAnimationFrame(playbackFrame);
  setMouth(0);
  mode.textContent = "READY";
  status.textContent = "Playback finished.";
});

window.addEventListener("beforeunload", () => {
  cancelAnimationFrame(playbackFrame);
  if (playbackUrl) URL.revokeObjectURL(playbackUrl);
  if (recording) {
    recording.stream.getTracks().forEach(track => track.stop());
    recording.pcmTap.close();
    recording.lipSyncer.destroy();
    void recording.context.close();
  }
});
