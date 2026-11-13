import { onRequestGet, onRequestPost, onRequestOptions } from "./functions/api/convert.js";

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

function validYouTubeUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\\./, "");
    return (url.protocol === "https:" || url.protocol === "http:") &&
      (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be");
  } catch {
    return false;
  }
}

async function handleYouTubeApi(request, env, route) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const serviceUrl = String(env.DOWNLOAD_SERVICE_URL || "").replace(/\\/+$/, "");
  const serviceToken = String(env.DOWNLOAD_SERVICE_TOKEN || "");
  if (!serviceUrl || !serviceToken) {
    return jsonResponse({
      error: "The media downloader service is not connected yet. Complete the one-time backend setup in YOUTUBE_DOWNLOADER_SETUP.md."
    }, 503);
  }

  let payload;
  try {
    if (route === "download") {
      const form = await request.formData();
      payload = {
        url: String(form.get("url") || ""),
        format: String(form.get("format") || "mp4").toLowerCase(),
        quality: String(form.get("quality") || "best"),
        audio_bitrate: String(form.get("audioBitrate") || "320"),
        rights_confirmed: String(form.get("rightsConfirmed") || "").toLowerCase() === "true"
      };
    } else {
      payload = await request.json();
    }
  } catch {
    return jsonResponse({ error: "Invalid request body." }, 400);
  }

  if (!validYouTubeUrl(String(payload.url || ""))) {
    return jsonResponse({ error: "Enter a valid YouTube video URL." }, 400);
  }
  if (route === "download") {
    if (payload.rights_confirmed !== true) {
      return jsonResponse({ error: "Confirm that you have the right to download this content." }, 400);
    }
    if (!["mp4", "mp3"].includes(payload.format)) {
      return jsonResponse({ error: "Choose MP4 or MP3." }, 400);
    }
    if (!["best", "2160", "1440", "1080", "720", "480", "360"].includes(payload.quality)) {
      return jsonResponse({ error: "Unsupported video quality." }, 400);
    }
    if (!["128", "192", "256", "320"].includes(payload.audio_bitrate)) {
      return jsonResponse({ error: "Unsupported MP3 bitrate." }, 400);
    }
  }

  let upstreamBase;
  try {
    upstreamBase = new URL(serviceUrl);
    if (upstreamBase.protocol !== "https:") throw new Error("HTTPS required");
  } catch {
    return jsonResponse({ error: "The configured downloader service URL is invalid." }, 503);
  }

  const endpoint = serviceUrl + (route === "info" ? "/info" : "/download");
  let upstream;
  try {
    upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + serviceToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  } catch {
    return jsonResponse({ error: "Could not reach the media processing service. Please try again later." }, 502);
  }

  const headers = new Headers();
  for (const name of ["content-type", "content-disposition", "content-length", "cache-control"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Cache-Control", "no-store");
  return new Response(upstream.body, { status: upstream.status, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/youtube/info" || url.pathname === "/api/youtube/download") {
      return handleYouTubeApi(request, env, url.pathname.endsWith("/info") ? "info" : "download");
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