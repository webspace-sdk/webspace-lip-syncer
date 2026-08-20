// Copyright 2026 Greg Fodor
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as tf from "@tensorflow/tfjs";
import { setWasmPaths } from "@tensorflow/tfjs-backend-wasm";
import "@tensorflow/tfjs-backend-wasm";

import { resetStatefulLayers } from "../src/core/reset-model-state.js";

test("model manifest references the extracted weight shard", async () => {
  const model = JSON.parse(await readFile(new URL("../model/model.json", import.meta.url), "utf8"));
  const weights = await readFile(new URL("../model/group1-shard1of1.bin", import.meta.url));
  assert.deepEqual(model.weightsManifest[0].paths, ["group1-shard1of1.bin"]);
  assert.equal(model.userDefinedMetadata.license, "Apache-2.0");
  assert.equal(weights.length, 398412);
});

test("loads the model on the WASM backend and predicts 12 finite scores", async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  setWasmPaths(resolve(root, "node_modules/@tensorflow/tfjs-backend-wasm/dist") + "/");
  await tf.setBackend("wasm");
  await tf.ready();

  const manifest = JSON.parse(await readFile(resolve(root, "model/model.json"), "utf8"));
  const weights = await readFile(resolve(root, "model/group1-shard1of1.bin"));
  const weightData = weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.byteLength);
  const handler = tf.io.fromMemory({
    modelTopology: manifest.modelTopology,
    weightSpecs: manifest.weightsManifest[0].weights,
    weightData
  });
  const model = await tf.loadLayersModel(handler);
  const input = tf.zeros([1, 1, 28]);
  const output = model.predict(input);

  try {
    const scores = Array.from(output.dataSync());
    assert.deepEqual(model.inputs[0].shape, [1, 1, 28]);
    assert.deepEqual(model.outputs[0].shape, [1, 12]);
    assert.equal(scores.length, 12);
    assert.ok(scores.every(Number.isFinite));
    assert.equal(resetStatefulLayers(model), 1);
  } finally {
    tf.dispose([input, output]);
    model.dispose();
  }
});
