import { onRequestGet, onRequestPost, onRequestOptions } from "./functions/api/convert.js";
import { onRequestPost as onAssistantPost, onRequestOptions as onAssistantOptions } from "./functions/api/assistant.js";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/face-swap-engine" || url.pathname === "/api/face-swap-engine/") {
      if (request.method !== "GET") return new Response("Method not allowed.", { status: 405, headers: { "Allow": "GET" } });
      const cache = caches.default;
      const cacheKey = new Request("https://docuworks-studio.internal/face-swap-engine.js");
      let cached = await cache.match(cacheKey);
      if (!cached) {
        const upstream = await fetch("https://esm.sh/browser-inswapper@0.1.0?bundle&target=es2022", {
          headers: { "Accept": "application/javascript" }
        });
        if (!upstream.ok) return new Response("Face-swap engine upstream failed: " + upstream.status, { status: 502 });
        const body = await upstream.arrayBuffer();
        cached = new Response(body, {
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "public, max-age=86400",
            "Access-Control-Allow-Origin": "*",
            "X-Content-Type-Options": "nosniff"
          }
        });
        ctx.waitUntil(cache.put(cacheKey, cached.clone()));
      } else {
        cached = new Response(cached.body, new Headers(cached.headers));
        cached.headers.set("Access-Control-Allow-Origin", "*");
      }
      return cached;
    }

    if (url.pathname === "/api/assistant" || url.pathname === "/api/assistant/") {
      if (request.method === "OPTIONS") return onAssistantOptions({ request, env, ctx, params: {} });
      if (request.method === "GET") return jsonResponse({service:"DocuWorks AI Agent",route:"/api/assistant",model:"@cf/google/gemma-4-26b-a4b-it",bindingConfigured:!!env?.AI,agentMode:true,agentBuild:"2026-11-16-agent-v1"});
      if (request.method === "POST") return onAssistantPost({ request, env, ctx, params: {} });
      return jsonResponse({ error: "Method not allowed." }, 405);
    }

    if (url.pathname === "/api/convert" || url.pathname === "/api/convert/") {
      const context = { request, env, ctx, params: {} };
      if (request.method === "OPTIONS") return onRequestOptions(context);
      if (request.method === "GET") return onRequestGet(context);
      if (request.method === "POST") return onRequestPost(context);
      return jsonResponse({ error: "Method not allowed." }, 405);
    }

    return env.ASSETS.fetch(request);
  }
};
