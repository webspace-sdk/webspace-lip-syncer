// Copyright 2026 Greg Fodor
// SPDX-License-Identifier: Apache-2.0

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = process.argv[2];
const outputDirectory = resolve(process.argv[3] || resolve(root, "model"));

if (!inputPath) {
  throw new Error("Usage: npm run import-model -- <legacy-lipsync.worker.js> [output-directory]");
}

function decodeDataUrl(url) {
  const comma = url.indexOf(",");
  if (comma < 0 || !url.slice(0, comma).includes("base64")) throw new Error("Expected base64-encoded data");
  return Buffer.from(url.slice(comma + 1), "base64");
}

const source = await readFile(resolve(inputPath), "utf8");
const match = source.match(/const\s+modelSrc\s*=\s*("data:application\/json;base64,[^"]+")\s*;/);
if (!match) throw new Error("Could not locate the inline modelSrc data URL");

const modelUrl = JSON.parse(match[1]);
const model = JSON.parse(decodeDataUrl(modelUrl).toString("utf8"));
if (!model.weightsManifest?.length || model.weightsManifest.length !== 1) {
  throw new Error("Expected one TensorFlow.js weights manifest group");
}

const group = model.weightsManifest[0];
if (!group.paths?.length || group.paths.length !== 1) throw new Error("Expected one inline weight shard");
const weights = decodeDataUrl(group.paths[0]);
group.paths = ["group1-shard1of1.bin"];
model.userDefinedMetadata = {
  ...(model.userDefinedMetadata || {}),
  license: "Apache-2.0",
  copyright: "Copyright 2020 Greg Fodor"
};

await mkdir(outputDirectory, { recursive: true });
await writeFile(resolve(outputDirectory, "model.json"), `${JSON.stringify(model, null, 2)}\n`);
await writeFile(resolve(outputDirectory, "group1-shard1of1.bin"), weights);

console.log(`Wrote ${weights.length} bytes of model weights to ${outputDirectory}`);
