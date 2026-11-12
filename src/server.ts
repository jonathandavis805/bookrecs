import { handleApi } from "./api";
import { serveStatic } from "./static";

const PORT = Number(process.env.PORT || 3000);

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      return handleApi(req);
    }
    return serveStatic(req);
  },
});

console.log(`bookrecs server running on http://localhost:${server.port}`);
