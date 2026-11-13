"""
Simple standalone backend for the DocuWorks Studio downloader.

Run locally:
    pip install -r requirements.txt
    python main.py

FFmpeg is required for MP3 conversion and MP4 video/audio merging.
Keep yt-dlp updated because YouTube changes frequently.
"""
import os
import re
import shutil
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
import yt_dlp

app = Flask(__name__)

# Restrict this to your DocuWorks site in production, for example:
# ALLOWED_ORIGINS=https://yourname.github.io
allowed_origins = os.getenv("ALLOWED_ORIGINS", "*")
CORS(app, origins=allowed_origins, expose_headers=["Content-Disposition"])

@app.after_request
def allow_local_network_access(response):
    # Supports browsers that require an explicit private-network CORS response
    # when a hosted HTTPS page connects to the user's local localhost service.
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response

MAX_FILE_BYTES = 500 * 1024 * 1024
MAX_DURATION_SECONDS = 3 * 60 * 60


def is_youtube_url(value):
    try:
        parsed = urlparse(value)
        host = (parsed.hostname or "").lower().rstrip(".")
        return (
            parsed.scheme in ("http", "https")
            and (
                host == "youtube.com"
                or host.endswith(".youtube.com")
                or host == "youtu.be"
            )
        )
    except Exception:
        return False


def safe_title(value):
    value = re.sub(r'[\\\\/:*?"<>|]+', "_", value or "download")
    value = re.sub(r"\s+", " ", value).strip()
    return value[:150] or "download"


def base_options():
    return {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "socket_timeout": 20,
        "retries": 2,
        "fragment_retries": 2,
        "extractor_retries": 2,
        "max_filesize": MAX_FILE_BYTES,
        "ignoreerrors": False,
    }


def get_info(url):
    if not is_youtube_url(url):
        raise ValueError("Enter a valid YouTube video URL.")

    options = base_options()
    options["skip_download"] = True

    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(url, download=False)

    if not info or info.get("_type") == "playlist":
        raise ValueError("Playlists are not supported. Paste a single video link.")

    duration = int(info.get("duration") or 0)
    if duration > MAX_DURATION_SECONDS:
        raise ValueError("Videos longer than three hours are not supported.")

    formats = info.get("formats") or []
    heights = sorted({
        int(item["height"])
        for item in formats
        if item.get("height")
        and item.get("vcodec") != "none"
        and item.get("ext") in ("mp4", "webm")
    })

    # Approximate size estimates for the UI.
    audio_sizes = [
        item.get("filesize") or item.get("filesize_approx") or 0
        for item in formats
        if item.get("vcodec") == "none" and item.get("acodec") != "none"
    ]
    best_audio = max(audio_sizes, default=0)

    estimates = {"mp3": best_audio}
    for quality in ("360", "480", "720", "1080", "1440", "2160", "best"):
        cap = max(heights) if quality == "best" and heights else (
            int(quality) if quality != "best" else 0
        )
        video_sizes = [
            item.get("filesize") or item.get("filesize_approx") or 0
            for item in formats
            if item.get("height")
            and int(item["height"]) <= cap
            and item.get("vcodec") != "none"
        ]
        best_video = max(video_sizes, default=0)
        estimates[quality] = best_video + best_audio if best_video or best_audio else 0

    return {
        "title": info.get("title") or "YouTube video",
        "uploader": info.get("uploader") or info.get("channel") or "YouTube",
        "duration": duration,
        "thumbnail": info.get("thumbnail") or "",
        "webpage_url": info.get("webpage_url") or url,
        "available_heights": heights,
        "max_height": max(heights) if heights else None,
        "estimated_sizes": estimates,
    }


@app.get("/")
def health():
    return "ok"


@app.get("/healthz")
def healthz():
    return jsonify(ok=True, service="docuworks-media-downloader")


@app.post("/info")
def info():
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()

    try:
        return jsonify(get_info(url))
    except Exception as exc:
        return jsonify(error=str(exc)[:300]), 422


@app.post("/download")
def download():
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    fmt = str(data.get("format", "mp4")).lower()
    quality = str(data.get("quality", "best"))
    bitrate = str(data.get("audioBitrate", data.get("audio_bitrate", "192")))

    if not is_youtube_url(url):
        return jsonify(error="Enter a valid YouTube video URL."), 400

    if fmt not in ("mp4", "mp3"):
        return jsonify(error="Choose MP4 or MP3."), 400

    if quality not in ("best", "2160", "1440", "1080", "720", "480", "360"):
        return jsonify(error="Unsupported video quality."), 400

    if bitrate not in ("128", "192", "256", "320"):
        return jsonify(error="Unsupported MP3 bitrate."), 400

    tmp = tempfile.mkdtemp(prefix="docuworks-media-")
    try:
        opts = base_options()
        opts["outtmpl"] = os.path.join(tmp, "%(title).150s.%(ext)s")
        opts["restrictfilenames"] = True
        opts["overwrites"] = True

        if fmt == "mp3":
            opts["format"] = "bestaudio/best"
            opts["postprocessors"] = [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": bitrate,
            }]
        else:
            if quality == "best":
                opts["format"] = (
                    "bestvideo[ext=mp4]+bestaudio[ext=m4a]/"
                    "best[ext=mp4]/best"
                )
            else:
                opts["format"] = (
                    f"bestvideo[height<={quality}][ext=mp4]+"
                    f"bestaudio[ext=m4a]/"
                    f"best[height<={quality}][ext=mp4]/"
                    f"best[height<={quality}]"
                )
            opts["merge_output_format"] = "mp4"

        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)

        if not info or info.get("_type") == "playlist":
            raise RuntimeError("Could not process this video.")

        duration = int(info.get("duration") or 0)
        if duration > MAX_DURATION_SECONDS:
            raise RuntimeError("Videos longer than three hours are not supported.")

        extension = ".mp3" if fmt == "mp3" else ".mp4"
        candidates = [
            path for path in Path(tmp).glob("*" + extension)
            if path.is_file()
        ]

        if not candidates:
            candidates = [
                path for path in Path(tmp).iterdir()
                if path.is_file()
                and not path.name.endswith((".part", ".ytdl"))
            ]

        if not candidates:
            raise RuntimeError("No file was produced.")

        path = max(candidates, key=lambda item: item.stat().st_size)

        if path.stat().st_size > MAX_FILE_BYTES:
            return jsonify(error="The file exceeds the 500 MB processing limit."), 413

        title = safe_title(info.get("title") or path.stem)
        filename = title + extension
        response = send_file(
            path,
            as_attachment=True,
            download_name=filename,
            mimetype="audio/mpeg" if fmt == "mp3" else "video/mp4",
            conditional=True,
        )
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.call_on_close(lambda: shutil.rmtree(tmp, ignore_errors=True))
        return response

    except Exception as exc:
        shutil.rmtree(tmp, ignore_errors=True)
        message = str(exc)
        if "ffmpeg" in message.lower():
            message = "FFmpeg is unavailable on the downloader server."
        elif "requested format is not available" in message.lower():
            message = "The selected quality is not available for this video."
        else:
            message = message[:300] or "Download failed."
        return jsonify(error=message), 422


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port)
