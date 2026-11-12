import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = process.env.WEB_DIST ? resolve(process.env.WEB_DIST) : resolve(REPO_ROOT, "web/dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
};

export function serveStatic(req: Request): Response {
  const url = new URL(req.url);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";

  let filePath = resolve(ROOT, "." + pathname);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + "/")) {
    filePath = resolve(ROOT, "index.html");
  }

  const isFile = existsSync(filePath) && statSync(filePath).isFile();

  if (!isFile) {
    const ext = pathname.includes(".") ? pathname.slice(pathname.lastIndexOf(".")) : "";
    const isAsset = pathname.startsWith("/assets/") || ext !== "";
    if (isAsset) return new Response("Not found", { status: 404 });
    filePath = resolve(ROOT, "index.html"); // SPA fallback for client-side routes
  }

  const file = Bun.file(filePath);
  const ext = filePath.slice(filePath.lastIndexOf("."));
  const headers: Record<string, string> = {};
  const type = MIME[ext];
  if (type) headers["content-type"] = type;
  headers["x-content-type-options"] = "nosniff";
  if (pathname.startsWith("/assets/")) headers["cache-control"] = "public, max-age=31536000, immutable";

  return new Response(file, { headers });
}
