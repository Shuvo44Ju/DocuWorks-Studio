import { onRequestGet, onRequestPost, onRequestOptions } from "./functions/api/convert.js";
import { onRequestPost as onCadAnalyzePost, onRequestOptions as onCadAnalyzeOptions } from "./functions/api/cad/analyze.js";
import { onRequestPost as onCadModifyPost, onRequestOptions as onCadModifyOptions } from "./functions/api/cad/modify.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/cad/modify" || url.pathname === "/api/cad/modify/") {\n      if (request.method === "OPTIONS") return onCadModifyOptions({ request, env, ctx, params: {} });\n      if (request.method === "POST") return onCadModifyPost({ request, env, ctx, params: {} });\n      return new Response(JSON.stringify({ error: "Method not allowed." }), { status: 405, headers: { "Content-Type": "application/json; charset=utf-8", "Allow": "POST, OPTIONS", "Cache-Control": "no-store" } });\n    }\n    if (url.pathname === "/api/cad/analyze" || url.pathname === "/api/cad/analyze/") {
      if (request.method === "OPTIONS") return onCadAnalyzeOptions({ request, env, ctx, params: {} });
      if (request.method === "POST") return onCadAnalyzePost({ request, env, ctx, params: {} });
      return new Response(JSON.stringify({ error: "Method not allowed." }), {
        status: 405,
        headers: { "Content-Type": "application/json; charset=utf-8", "Allow": "POST, OPTIONS", "Cache-Control": "no-store" }
      });
    }
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
