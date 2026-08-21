// Copyright 2026 Greg Fodor
// SPDX-License-Identifier: Apache-2.0

import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const metadata = JSON.parse(await readFile(resolve(root, ".build-meta.json"), "utf8"));
const packageRoots = new Set();
const apacheLicense = (await readFile(resolve(root, "LICENSE"), "utf8"))
  .split("   END OF TERMS AND CONDITIONS")[0]
  .concat("   END OF TERMS AND CONDITIONS")
  .trim();

const tensorflowLayersMitLicense = `TensorFlow.js Layers is licensed under both the MIT and Apache-2.0 licenses.

All contributions by François Chollet:
Copyright (c) 2015 - 2018, François Chollet.

All contributions by Google:
Copyright (c) 2015 - 2018, Google LLC.

All contributions by Microsoft:
Copyright (c) 2017 - 2018, Microsoft, LLC

All other contributions:
Copyright (c) 2015 - 2018, the respective contributors.

Each contributor holds copyright over their respective contributions.

The MIT License (MIT)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const fftJsMitLicense = `Copyright (c) Fedor Indutny

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

async function bundledLicenseFallback(packageJson, packageRoot) {
  if (packageJson.name === "fft.js") return fftJsMitLicense;

  if (packageJson.name === "seedrandom") {
    const source = await readFile(resolve(packageRoot, "seedrandom.js"), "utf8");
    const header = source.match(/^\/\*([\s\S]*?)\*\//);
    return header?.[1].trim() || null;
  }

  if (!packageJson.name.startsWith("@tensorflow/")) return null;

  const attribution =
    packageJson.name === "@tensorflow/tfjs-layers"
      ? `${tensorflowLayersMitLicense}\n\nApache-2.0 license:\n\n`
      : "Copyright Google LLC and the TensorFlow.js contributors.\n\nApache-2.0 license:\n\n";
  return `${attribution}${apacheLicense}`;
}

async function findPackageRoot(inputPath) {
  let current = dirname(isAbsolute(inputPath) ? inputPath : resolve(root, inputPath));
  while (current !== dirname(current)) {
    try {
      await readFile(resolve(current, "package.json"), "utf8");
      if (current.includes("node_modules")) return current;
    } catch {
      // Continue toward the package root.
    }
    current = dirname(current);
  }
  return null;
}

for (const inputPath of Object.keys(metadata.inputs)) {
  if (!inputPath.includes("node_modules")) continue;
  const packageRoot = await findPackageRoot(inputPath);
  if (packageRoot) packageRoots.add(packageRoot);
}

const packages = [];
for (const packageRoot of packageRoots) {
  const packageJson = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
  const license = typeof packageJson.license === "string" ? packageJson.license : "";
  const permitted = /^(?:MIT|ISC|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|0BSD)(?:\s+(?:AND|OR)\s+(?:MIT|ISC|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|0BSD))*$/.test(
    license
  );
  if (!permitted) throw new Error(`Non-permissive or unknown license for ${packageJson.name}: ${license || "missing"}`);

  const entries = await readdir(packageRoot);
  const licenseFile = entries.find(name => /^licen[cs]e(?:\..+)?$/i.test(name));
  const licenseText = licenseFile
    ? await readFile(resolve(packageRoot, licenseFile), "utf8")
    : await bundledLicenseFallback(packageJson, packageRoot);
  if (!licenseText) throw new Error(`No license text found for bundled package ${packageJson.name}`);

  packages.push({
    name: packageJson.name,
    version: packageJson.version,
    license,
    text: licenseText.trim()
  });
}

packages.sort((a, b) => a.name.localeCompare(b.name));
const sections = packages.map(
  item => `${"=".repeat(80)}\n${item.name} ${item.version} - ${item.license}\n${"=".repeat(80)}\n\n${item.text}`
);
const output = [
  "THIRD-PARTY SOFTWARE NOTICES",
  "",
  "The distributable bundles include the permissively licensed components listed below.",
  "Their licenses apply to their respective components.",
  "",
  ...sections
].join("\n\n");

await writeFile(resolve(root, "THIRD_PARTY_NOTICES.txt"), `${output}\n`);
