import { onRequestGet, onRequestPost, onRequestOptions } from "./functions/api/convert.js";
import { onRequestPost as onAssistantPost, onRequestOptions as onAssistantOptions } from "./functions/api/assistant.js";

function jsonResponse(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: {
    "Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",
    "X-Content-Type-Options":"nosniff", ...extra
  }});
}
const downloadCors = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Methods":"GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers":"Range",
  "Access-Control-Expose-Headers":"Content-Range, Content-Length, Content-Disposition, Accept-Ranges, Content-Type",
  "Vary":"Origin"
};
function isPrivateHost(host) {
  const h=host.toLowerCase().replace(/^\[|\]$/g,"");
  if (h==="localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const p=h.split(".").map(Number);
    return p.some(n=>n>255) || p[0]===10 || p[0]===127 || p[0]===0 ||
      (p[0]===169&&p[1]===254) || (p[0]===172&&p[1]>=16&&p[1]<=31) ||
      (p[0]===192&&p[1]===168) || (p[0]===100&&p[1]>=64&&p[1]<=127);
  }
  if (h.includes(":")) return h==="::1" || h==="::" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80");
  return false;
}
async function downloadProxy(request) {
  if (request.method==="OPTIONS") return new Response(null,{status:204,headers:downloadCors});
  if (request.method!=="GET" && request.method!=="HEAD") return jsonResponse({error:"Method not allowed."},405,downloadCors);
  const incoming=new URL(request.url), raw=incoming.searchParams.get("url");
  if (!raw) return jsonResponse({error:"Missing file URL."},400,downloadCors);
  let target;
  try { target=new URL(raw); } catch { return jsonResponse({error:"Invalid file URL."},400,downloadCors); }
  if (!["http:","https:"].includes(target.protocol) || target.username || target.password || isPrivateHost(target.hostname))
    return jsonResponse({error:"Only public HTTP/HTTPS file URLs are supported."},400,downloadCors);
  const headers=new Headers();
  const range=request.headers.get("Range");
  if (range && /^bytes=\d*-\d*(,\s*\d*-\d*)*$/.test(range)) headers.set("Range",range);
  let upstream;
  try {
    upstream=await fetch(target.toString(),{method:request.method,headers,redirect:"follow"});
  } catch {
    return jsonResponse({error:"The source server could not be reached. It may block automated requests."},502,downloadCors);
  }
  try {
    const finalUrl=new URL(upstream.url || target.toString());
    if (!["http:","https:"].includes(finalUrl.protocol) || isPrivateHost(finalUrl.hostname))
      return jsonResponse({error:"The source redirected to an unsupported address."},502,downloadCors);
  } catch { return jsonResponse({error:"Invalid source response."},502,downloadCors); }
  const out=new Headers(downloadCors);
  for (const name of ["content-type","content-length","content-range","content-disposition","accept-ranges","cache-control","last-modified","etag"]) {
    const value=upstream.headers.get(name); if(value) out.set(name,value);
  }
  out.set("Cache-Control","no-store");
  out.set("X-Content-Type-Options","nosniff");
  return new Response(request.method==="HEAD"?null:upstream.body,{status:upstream.status,statusText:upstream.statusText,headers:out});
}
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/download" || url.pathname === "/api/download/") return downloadProxy(request);
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