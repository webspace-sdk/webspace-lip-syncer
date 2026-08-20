// Copyright 2026 Greg Fodor
// SPDX-License-Identifier: Apache-2.0

import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, "wasm"), { recursive: true });

const common = {
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  legalComments: "eof",
  metafile: true,
  sourcemap: true
};

const main = await build({
  ...common,
  entryPoints: [resolve(root, "src/index.js")],
  outfile: resolve(dist, "index.js")
});

const worker = await build({
  ...common,
  entryPoints: [resolve(root, "src/worker/lip-sync.worker.js")],
  outfile: resolve(dist, "lip-sync.worker.js"),
  minify: true
});

const worklet = await build({
  ...common,
  entryPoints: [resolve(root, "src/worklet/pcm-capture.worklet.js")],
  outfile: resolve(dist, "pcm-capture.worklet.js"),
  minify: true
});

await cp(resolve(root, "src/index.d.ts"), resolve(dist, "index.d.ts"));

const wasmSource = resolve(root, "node_modules/@tensorflow/tfjs-backend-wasm/dist");
for (const filename of [
  "tfjs-backend-wasm.wasm",
  "tfjs-backend-wasm-simd.wasm",
  "tfjs-backend-wasm-threaded-simd.wasm"
]) {
  await cp(resolve(wasmSource, filename), resolve(dist, "wasm", filename));
}

const combinedMeta = {
  inputs: { ...main.metafile.inputs, ...worker.metafile.inputs, ...worklet.metafile.inputs },
  outputs: { ...main.metafile.outputs, ...worker.metafile.outputs, ...worklet.metafile.outputs }
};
await writeFile(resolve(root, ".build-meta.json"), `${JSON.stringify(combinedMeta, null, 2)}\n`);
