// Copyright 2026 Greg Fodor
// SPDX-License-Identifier: Apache-2.0

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 5173);
const mimeTypes = new Map([
  [".bin", "application/octet-stream"],
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".wasm", "application/wasm"]
]);

function sendText(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8", ...headers });
  response.end(body);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (url.pathname === "/") {
      response.writeHead(302, { Location: "/example/" });
      response.end();
      return;
    }

    const decodedPath = decodeURIComponent(url.pathname);
    let filePath = resolve(root, `.${decodedPath}`);
    if (filePath !== root && !filePath.startsWith(root + sep)) {
      sendText(response, 403, "Forbidden\n");
      return;
    }

    let fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      filePath = resolve(filePath, "index.html");
      fileStat = await stat(filePath);
    }
    if (!fileStat.isFile()) throw new Error("Not a file");

    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Length": fileStat.size,
      "Content-Type": mimeTypes.get(extname(filePath).toLowerCase()) || "application/octet-stream"
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(filePath).pipe(response);
  } catch {
    sendText(response, 404, "Not found\n");
  }
});

server.listen(port, host, () => {
  console.log(`Webspace Lip Syncer demo: http://${host}:${port}/example/`);
  console.log("Press Ctrl+C to stop.");
});
