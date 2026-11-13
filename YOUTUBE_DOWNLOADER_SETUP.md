# DocuWorks Studio — Standalone YouTube Downloader

The Downloader page is now independent of the DocuWorks Cloudflare Worker. The page talks directly to a separate HTTPS downloader service.

## Backend

The `downloader-service` folder is the complete backend. It uses FastAPI, yt-dlp and FFmpeg and exposes:

- `GET /healthz`
- `POST /info`
- `POST /download`

The service accepts YouTube video URLs only, does not process playlists, limits videos to three hours / 500 MB, and requires a bearer token. It should be used only for content the user is legally entitled to download. It does not bypass DRM or private-video access controls.

## One-time connection

1. Deploy `downloader-service` to any HTTPS container host that supports Docker.
2. Set `DOWNLOADER_API_TOKEN` on that service.
3. Copy the service's HTTPS URL into `downloader-config.js` as `window.DW_DOWNLOADER_API`.
4. Make sure the service allows browser requests from the DocuWorks Studio website (CORS).

No Cloudflare Worker secret or downloader proxy is required for the Downloader page.

The existing Cloudflare Worker used by other DocuWorks Studio features can remain unchanged.
