# DocuWorks Studio — Standalone YouTube Downloader

The Downloader page uses a simple standalone Flask server. It does **not** use the DocuWorks Cloudflare Worker for media downloading.

## Backend

The `downloader-service` folder contains the complete backend:

- Flask
- Flask-CORS
- yt-dlp
- FFmpeg
- `GET /` and `GET /healthz` health checks
- `POST /info` for video information
- `POST /download` for MP4/MP3 downloads

The service accepts YouTube video URLs, does not process playlists, and limits processing to three hours / 500 MB.

## Run locally

Install Python and FFmpeg, then:

```bash
cd downloader-service
pip install -r requirements.txt
python app.py
```

The server runs at:

`http://localhost:5000`

For local testing, set `window.DW_DOWNLOADER_API` in `downloader-config.js` to:

`http://localhost:5000`

## Put it online

Deploy the `downloader-service` folder to any normal HTTPS server/container host that can run Docker.

Set the server environment variable:

`ALLOWED_ORIGINS=https://YOUR-DOCUWORKS-SITE.example`

You can temporarily use `*` for testing, but a production deployment should restrict CORS to your DocuWorks site.

After deployment, copy the server HTTPS address into:

`downloader-config.js`

Example:

```js
window.DW_DOWNLOADER_API = "https://your-downloader.example.com";
```

There is **no API token in the browser** and no Cloudflare downloader proxy.

## Important

The server still has the normal limits of whatever computer/server is hosting it (CPU, RAM, storage and bandwidth). It is not subject to Cloudflare Workers' execution limits because the media processing happens directly on the standalone server.

Use the downloader only for content you own, have permission to download, or are otherwise legally entitled to download. It does not bypass DRM or private-video access controls.
