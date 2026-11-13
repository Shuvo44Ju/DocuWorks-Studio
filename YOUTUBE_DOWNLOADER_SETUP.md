# DocuWorks Studio — YouTube Downloader backend

The DocuWorks Studio website is static and its Cloudflare Worker cannot run yt-dlp or FFmpeg. This folder contains the separate, authenticated media-processing service required by the Downloader page.

## Deploy the media service

1. Deploy this repository's `downloader-service` folder as a Docker web service on a container host that supports persistent FFmpeg binaries.
2. Set the service environment variable `DOWNLOADER_API_TOKEN` to a long, random secret. Do not put this token in website JavaScript or commit it to GitHub.
3. Expose the service over HTTPS and note its base URL, for example `https://your-service.example.com`.
4. The service health check is `/healthz`.

The container installs FFmpeg and Python dependencies automatically. It accepts only YouTube video URLs, does not process playlists, limits output to 500 MB and three hours, and allows one active download at a time. It requires an authenticated bearer token.

## Connect it to the DocuWorks Cloudflare Worker

In Cloudflare, open the `docuworks-studio` Worker and add these as encrypted secrets/variables:

- `DOWNLOAD_SERVICE_URL` — the HTTPS base URL of the deployed service, without a trailing slash.
- `DOWNLOAD_SERVICE_TOKEN` — exactly the same secret value as `DOWNLOADER_API_TOKEN` on the service.

Redeploy the Worker after adding the values. The website then uses same-origin routes `/api/youtube/info` and `/api/youtube/download`; the secret never reaches the browser.

## Important

The repository changes add the user interface and the complete backend service, but the media service still needs to be deployed and connected in your hosting account before downloads can run. Do not choose a paid hosting plan without reviewing its price first.

Use the Downloader only for videos you own, have permission to download, or are otherwise legally entitled to download. It does not bypass DRM, private-video restrictions, or other access controls.
