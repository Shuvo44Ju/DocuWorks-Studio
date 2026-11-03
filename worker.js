import { onRequestGet, onRequestPost, onRequestOptions } from "./functions/api/convert.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/convert" || url.pathname === "/api/convert/") {
      const context = { request, env, ctx, params: {} };
      if (request.method === "OPTIONS") return onRequestOptions(context);
      if (request.method === "GET") return onRequestGet(context);
      if (request.method === "POST") return onRequestPost(context);
      return new Response(JSON.stringify({ error: "Method not allowed." }), {
        status: 405,
        headers: { "Content-Type": "application/json; charset=utf-8", "Allow": "GET, POST, OPTIONS", "Cache-Control": "no-store" }
      });
    }
    return env.ASSETS.fetch(request);
  }
};
