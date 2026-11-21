import { handleApi } from "../../src/api";

interface Env {
  DB: D1Database;
}

// The web app is served from the same origin, so no CORS headers are needed.
export const onRequest: PagesFunction<Env> = async ({ env, request }) => {
  try {
    return await handleApi(env.DB, request);
  } catch (err) {
    console.error("API error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
};
