import asyncio
import hmac
import os
import shutil
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool
from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError

app = FastAPI(title="DocuWorks Media Downloader", docs_url=None, redoc_url=None)
MAX_FILE_BYTES = 500 * 1024 * 1024
MAX_DURATION_SECONDS = 3 * 60 * 60
DOWNLOAD_GATE = asyncio.Semaphore(1)


class VideoRequest(BaseModel):
    url: str = Field(min_length=8, max_length=2048)


class DownloadRequest(BaseModel):
    url: str = Field(min_length=8, max_length=2048)
    format: str = "mp4"
    quality: str = "best"
    audio_bitrate: str = "320"
    rights_confirmed: bool = False


def require_token(authorization: str = Header(default="")):
    expected = os.getenv("DOWNLOADER_API_TOKEN", "")
    if not expected:
        raise HTTPException(status_code=503, detail="Downloader API token is not configured.")
    supplied = authorization.removeprefix("Bearer ").strip()
    if not authorization.startswith("Bearer ") or not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="Unauthorized.")
    return True


def validate_youtube_url(value: str) -> str:
    try:
        parsed = urlparse(value)
        host = (parsed.hostname or "").lower().rstrip(".")
        allowed = host == "youtu.be" or host == "youtube.com" or host.endswith(".youtube.com")
        if parsed.scheme not in ("http", "https") or not allowed:
            raise ValueError()
        if host == "youtube.com" and parsed.path == "/":
            raise ValueError()
        return value
    except Exception:
        raise HTTPException(status_code=400, detail="Enter a valid YouTube video URL.")


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
        "ignoreerrors": False
    }


def size_of(fmt):
    return fmt.get("filesize") or fmt.get("filesize_approx") or 0


def build_info(url: str):
    validate_youtube_url(url)
    options = base_options()
    options["skip_download"] = True
    with YoutubeDL(options) as ydl:
        info = ydl.extract_info(url, download=False)

    if not info or info.get("_type") == "playlist":
        raise HTTPException(status_code=422, detail="Playlists are not supported. Paste a single video link.")
    duration = int(info.get("duration") or 0)
    if duration > MAX_DURATION_SECONDS:
        raise HTTPException(status_code=413, detail="Videos longer than three hours are not supported.")

    formats = info.get("formats") or []
    heights = sorted({
        int(item["height"]) for item in formats
        if item.get("height") and item.get("vcodec") != "none" and item.get("ext") in ("mp4", "webm")
    })
    audio_sizes = [size_of(item) for item in formats if item.get("vcodec") == "none" and item.get("acodec") != "none"]
    best_audio_size = max(audio_sizes, default=0)

    estimates = {"mp3": best_audio_size}
    for target in ("360", "480", "720", "1080", "1440", "2160", "best"):
        cap = max(heights) if target == "best" else int(target)
        candidates = [
            item for item in formats
            if item.get("height") and int(item["height"]) <= cap
            and item.get("vcodec") != "none"
            and item.get("ext") == "mp4"
        ]
        video_size = max((size_of(item) for item in candidates), default=0)
        estimates[target] = video_size + best_audio_size if video_size or best_audio_size else 0

    return {
        "title": info.get("title") or "YouTube video",
        "uploader": info.get("uploader") or info.get("channel") or "YouTube",
        "duration": duration,
        "thumbnail": info.get("thumbnail") or "",
        "webpage_url": info.get("webpage_url") or url,
        "available_heights": heights,
        "max_height": max(heights) if heights else None,
        "estimated_sizes": estimates
    }


def download_file(body: DownloadRequest):
    validate_youtube_url(body.url)
    if not body.rights_confirmed:
        raise HTTPException(status_code=400, detail="Confirm that you have the right to download this content.")
    if body.format not in ("mp3", "mp4"):
        raise HTTPException(status_code=400, detail="Choose MP3 or MP4.")
    if body.audio_bitrate not in ("128", "192", "256", "320"):
        raise HTTPException(status_code=400, detail="Unsupported MP3 bitrate.")
    if body.quality not in ("best", "2160", "1440", "1080", "720", "480", "360"):
        raise HTTPException(status_code=400, detail="Unsupported video quality.")

    folder = Path(tempfile.mkdtemp(prefix="docuworks-media-"))
    output_template = str(folder / "%(title).160B.%(ext)s")
    options = base_options()
    options.update({
        "outtmpl": output_template,
        "restrictfilenames": True,
        "overwrites": True
    })

    if body.format == "mp3":
        options["format"] = "bestaudio/best"
        options["postprocessors"] = [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": body.audio_bitrate
        }]
    else:
        if body.quality == "best":
            selector = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
        else:
            selector = (
                "bestvideo[height<=" + body.quality + "][ext=mp4]+bestaudio[ext=m4a]/"
                "best[height<=" + body.quality + "][ext=mp4]/"
                "best[height<=" + body.quality + "]"
            )
        options["format"] = selector
        options["merge_output_format"] = "mp4"

    try:
        with YoutubeDL(options) as ydl:
            info = ydl.extract_info(body.url, download=True)
            if not info or info.get("_type") == "playlist":
                raise HTTPException(status_code=422, detail="Could not process this video.")
            duration = int(info.get("duration") or 0)
            if duration > MAX_DURATION_SECONDS:
                raise HTTPException(status_code=413, detail="Videos longer than three hours are not supported.")

        extension = ".mp3" if body.format == "mp3" else ".mp4"
        candidates = [path for path in folder.glob("*" + extension) if path.is_file()]
        if not candidates:
            candidates = [path for path in folder.iterdir() if path.is_file() and not path.name.endswith((".part", ".ytdl"))]
        if not candidates:
            raise HTTPException(status_code=422, detail="The media file could not be created. Try another quality.")
        media_file = max(candidates, key=lambda path: path.stat().st_size)
        if media_file.stat().st_size > MAX_FILE_BYTES:
            raise HTTPException(status_code=413, detail="The file exceeds the 500 MB processing limit.")
        return folder, media_file
    except HTTPException:
        shutil.rmtree(folder, ignore_errors=True)
        raise
    except DownloadError as exc:
        shutil.rmtree(folder, ignore_errors=True)
        message = str(exc)
        if "ffmpeg" in message.lower():
            raise HTTPException(status_code=503, detail="The media processor is unavailable. Please contact the site administrator.")
        raise HTTPException(status_code=422, detail="YouTube could not provide this video in the selected format. Try a lower quality or another video.")
    except Exception:
        shutil.rmtree(folder, ignore_errors=True)
        raise HTTPException(status_code=500, detail="The media processing service encountered an unexpected error.")


@app.get("/healthz")
def health():
    return {"ok": True, "service": "docuworks-media-downloader"}


@app.post("/info")
async def video_info(body: VideoRequest, _: bool = Depends(require_token)):
    try:
        return await run_in_threadpool(build_info, body.url)
    except DownloadError:
        raise HTTPException(status_code=422, detail="YouTube could not provide information for this video.")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=422, detail="Unable to analyze this video. Check the link and try again.")


@app.post("/download")
async def create_download(body: DownloadRequest, _: bool = Depends(require_token)):
    async with DOWNLOAD_GATE:
        folder, media_file = await run_in_threadpool(download_file, body)
    filename = media_file.name.replace('"', "").replace("\\", "_")
    content_type = "audio/mpeg" if body.format == "mp3" else "video/mp4"
    return FileResponse(
        media_file,
        media_type=content_type,
        filename=filename,
        background=BackgroundTask(shutil.rmtree, folder, ignore_errors=True),
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
    )
