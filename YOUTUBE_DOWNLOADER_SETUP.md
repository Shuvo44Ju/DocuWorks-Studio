# DocuWorks Studio — Standalone YouTube Downloader

The Downloader page connects directly to a separate standalone HTTPS service. Media downloading does **not** pass through the DocuWorks Cloudflare Worker. The existing Cloudflare Worker can continue serving the other DocuWorks Studio features.

## Backend

The `downloader-service` folder contains the complete backend:

- **Flask** and **Flask-CORS** (not FastAPI)
- **yt-dlp** for retrieving supported YouTube video and audio streams
- **FFmpeg** for MP3 conversion and MP4 audio/video merging
- `GET /` and `GET /healthz` health checks
- `POST /info` for video information
- `POST /download` for MP4 or MP3 downloads

The service accepts YouTube video URLs only, does not process playlists, and enforces a maximum duration of three hours and a maximum output size of 500 MB.

**Authentication:** The current Flask implementation does not use a bearer token. Do not add a `DOWNLOADER_API_TOKEN` setting or an Authorization header unless the backend and frontend are deliberately updated together. The browser configuration contains no API secret.

## Run locally

Install Python 3.12 or later and FFmpeg, then open a terminal:

```bash
cd downloader-service
pip install -r requirements.txt
python main.py
```

The service listens on:

`http://localhost:5000`

In `downloader-config.js`, set:

```js
window.DW_DOWNLOADER_API = "http://localhost:5000";
```

Reload the DocuWorks Downloader page and test the connection. The local service must remain running while you use the downloader.

## Deploy online

Deploy the `downloader-service` folder to a Docker/container host that provides a public HTTPS service.

The repository Dockerfile installs FFmpeg, installs the Python dependencies, and starts the Flask application with `python main.py`. The container listens on port `5000`; configure the hosting service to route public HTTPS traffic to that container port.

Set this environment variable on the hosting service:

```text
ALLOWED_ORIGINS=https://YOUR-DOCUWORKS-SITE.example
```

Replace the example value with the exact origin of your DocuWorks Studio website. For temporary testing, `*` is accepted, but a production deployment should restrict CORS to your site.

When the host gives you a public HTTPS URL, put that URL in `downloader-config.js`:

```js
window.DW_DOWNLOADER_API = "https://your-downloader.example.com";
```

Redeploy or publish the DocuWorks website after changing the configuration. No Cloudflare downloader proxy, Cloudflare Worker secret, or browser API token is required.

## Verify the service

Open the deployed service's health endpoint:

`https://your-downloader.example.com/healthz`

A running service should return a small JSON response with `ok: true`.

## Important

A standalone server avoids Cloudflare Workers' execution limits for media processing, but it is not literally unlimited. Its CPU, memory, temporary disk space, network bandwidth, and hosting provider limits still apply. The service also limits each download to three hours and 500 MB.

Use the downloader only for content you own, have permission to download, or are otherwise legally entitled to download. It does not bypass DRM or private-video access controls.
