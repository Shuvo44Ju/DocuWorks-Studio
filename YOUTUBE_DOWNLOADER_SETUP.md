# DocuWorks Studio — YouTube Downloader

## Step 1 — Install the required software (one time)

- Install Python 3.11 or newer from https://www.python.org/downloads/
- During Python setup, enable **Add Python to PATH**.
- FFmpeg is required for MP3 conversion and MP4 video/audio merging. The startup script attempts to install it using Windows Package Manager if it is missing.

## Step 2 — Start the downloader backend

1. Download or update the DocuWorks Studio repository on your Windows PC.
2. Open the repository folder.
3. Double-click **start-downloader.bat**.
4. Wait while it installs Flask, Flask-CORS, and yt-dlp.
5. When the terminal says the service is listening at `http://localhost:5000`, leave that window open.

If FFmpeg is installed during the first run, close the terminal and double-click `start-downloader.bat` again so Windows can refresh its PATH.

## Step 3 — Connect the DocuWorks webpage

1. Open the DocuWorks Studio website on the same PC.
2. Open **YouTube Downloader**.
3. Expand **Backend connection**.
4. Keep the address as `http://localhost:5000`.
5. Click **Test connection**. It should report that the backend is connected.

## Step 4 — Download

1. Paste a YouTube video URL.
2. Choose MP4 or MP3 and the required quality.
3. Tick the permission confirmation.
4. Click **Download**.

Keep the backend terminal open while downloading.

## Important: local versus public access

This setup runs the downloader on your own PC. It is not a public server, and other users or devices cannot use your PC's localhost address. To make the hosted DocuWorks webpage work for everyone, the backend must separately be deployed to a public HTTPS host that supports a persistent Python process and FFmpeg. The repository includes a Dockerfile and `render.yaml` as deployment configuration, but those files do not deploy the service by themselves. Only put a real, deployed HTTPS backend URL into `downloader-config.js`.

Media downloading does not pass through the DocuWorks Cloudflare Worker. The service uses Flask, yt-dlp, and FFmpeg, accepts single YouTube video URLs, and enforces a maximum duration of three hours and a maximum output size of 500 MB. Hosting resources and provider limits still apply.

Use this tool only for content you own, have permission to download, or are otherwise legally entitled to download. It does not bypass DRM or private-video access controls.
