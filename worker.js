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

    if (url.pathname === "/api/assistant" || url.pathname === "/api/assistant/") {
      if (request.method === "OPTIONS") return onAssistantOptions({ request, env, ctx, params: {} });
      if (request.method === "GET") return jsonResponse({service:"DocuWorks AI Assistant",route:"/api/assistant",model:"@cf/google/gemma-4-26b-a4b-it",bindingConfigured:!!env?.AI});
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
