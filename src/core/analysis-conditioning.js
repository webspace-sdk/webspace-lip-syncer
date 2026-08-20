// Copyright 2026 Greg Fodor
// SPDX-License-Identifier: Apache-2.0

export const ANALYSIS_CONDITIONING = Object.freeze({
  gain: 3,
  threshold: -12,
  knee: 0,
  ratio: 20,
  attack: 0.005,
  release: 0.05
});

export function createAnalysisConditioner(audioContext) {
  const gainNode = audioContext.createGain();
  const compressorNode = audioContext.createDynamicsCompressor();

  gainNode.gain.setValueAtTime(ANALYSIS_CONDITIONING.gain, audioContext.currentTime);
  compressorNode.threshold.value = ANALYSIS_CONDITIONING.threshold;
  compressorNode.knee.value = ANALYSIS_CONDITIONING.knee;
  compressorNode.ratio.value = ANALYSIS_CONDITIONING.ratio;
  compressorNode.attack.value = ANALYSIS_CONDITIONING.attack;
  compressorNode.release.value = ANALYSIS_CONDITIONING.release;
  gainNode.connect(compressorNode);

  return { input: gainNode, output: compressorNode, gainNode, compressorNode };
}
