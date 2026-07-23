import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import worker from "../dist/server/index.js";

const root = resolve("dist/client");
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

const assets = {
  async fetch(request) {
    const url = new URL(request.url);
    const filePath = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
      return new Response("Forbidden", { status: 403 });
    }
    try {
      const info = await stat(filePath);
      if (!info.isFile()) return new Response("Not found", { status: 404 });
      const body = await readFile(filePath);
      return new Response(body, {
        headers: {
          "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  },
};

const server = createServer(async (incoming, outgoing) => {
  try {
    const host = incoming.headers.host ?? "localhost:3000";
    const init = { method: incoming.method, headers: incoming.headers };
    if (incoming.method !== "GET" && incoming.method !== "HEAD") {
      init.body = Readable.toWeb(incoming);
      init.duplex = "half";
    }
    const request = new Request(`http://${host}${incoming.url ?? "/"}`, init);
    const staticResponse = await assets.fetch(request);
    const response =
      staticResponse.status !== 404
        ? staticResponse
        : await worker.fetch(
            request,
            { ASSETS: assets },
            { waitUntil() {}, passThroughOnException() {} },
          );
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (!response.body || incoming.method === "HEAD") {
      outgoing.end();
      return;
    }
    Readable.fromWeb(response.body).pipe(outgoing);
  } catch (error) {
    outgoing.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    outgoing.end(error instanceof Error ? error.message : "Preview failed");
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    process.stderr.write("端口 3000 已被占用；如果通感画布已经打开，可以忽略此消息。\n");
    process.exit(0);
  }
  throw error;
});

server.listen(3000, "127.0.0.1", () => {
  process.stdout.write("Local preview: http://localhost:3000/\n");
});
