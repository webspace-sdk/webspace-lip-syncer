// Copyright 2026 Greg Fodor
// SPDX-License-Identifier: Apache-2.0

import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const permittedLicense =
  /^(?:MIT|ISC|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|0BSD)(?:\s+(?:AND|OR)\s+(?:MIT|ISC|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|0BSD))*$/;

const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
if (packageJson.license !== "Apache-2.0") {
  throw new Error(`Expected package license Apache-2.0, found ${packageJson.license || "missing"}`);
}

const lock = JSON.parse(await readFile(resolve(root, "package-lock.json"), "utf8"));
for (const [path, metadata] of Object.entries(lock.packages)) {
  const license = metadata.license;
  if (!license || !permittedLicense.test(license)) {
    throw new Error(`Non-permissive or unknown dependency license at ${path || "package root"}: ${license || "missing"}`);
  }
}

const model = JSON.parse(await readFile(resolve(root, "model/model.json"), "utf8"));
if (model.userDefinedMetadata?.license !== "Apache-2.0") {
  throw new Error("Expected the model manifest to declare Apache-2.0");
}

const sourceRoots = ["src", "scripts", "test", "example"];
const sourceExtensions = new Set([".css", ".html", ".js", ".mjs", ".svg", ".ts"]);
const missingHeaders = [];
const unexpectedIdentifiers = [];

async function inspectDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await inspectDirectory(path);
      continue;
    }
    if (!sourceExtensions.has(extname(entry.name))) continue;

    const source = await readFile(path, "utf8");
    const identifiers = [
      ...source.matchAll(/^[ \t]*(?:\/\/|\/\*|<!--)[ \t]*SPDX-License-Identifier:[ \t]*([A-Za-z0-9.-]+)/gm)
    ].map(match => match[1]);
    if (identifiers.length === 0) missingHeaders.push(path.slice(root.length + 1));
    for (const identifier of identifiers) {
      if (identifier !== "Apache-2.0") unexpectedIdentifiers.push(`${path.slice(root.length + 1)}: ${identifier}`);
    }
  }
}

for (const sourceRoot of sourceRoots) await inspectDirectory(resolve(root, sourceRoot));

if (missingHeaders.length) {
  throw new Error(`Missing SPDX headers:\n${missingHeaders.join("\n")}`);
}
if (unexpectedIdentifiers.length) {
  throw new Error(`Unexpected first-party SPDX identifiers:\n${unexpectedIdentifiers.join("\n")}`);
}

console.log(`License audit passed for ${Object.keys(lock.packages).length - 1} dependencies and all first-party files.`);
