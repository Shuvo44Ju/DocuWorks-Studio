@echo off
setlocal
cd /d "%~dp0downloader-service"
echo ==========================================
echo DocuWorks Studio - YouTube Downloader
echo ==========================================
where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Install Python 3.11 or newer from https://www.python.org/downloads/
  echo During installation, tick "Add Python to PATH".
  pause
  exit /b 1
)
python -m pip install --upgrade pip
if errorlevel 1 goto failed
python -m pip install -r requirements.txt
if errorlevel 1 goto failed
where ffmpeg >nul 2>nul
if errorlevel 1 (
  echo.
  echo FFmpeg is required for MP3 conversion and MP4 merging.
  where winget >nul 2>nul
  if not errorlevel 1 (
    echo Installing FFmpeg with Windows Package Manager...
    winget install --id Gyan.FFmpeg -e --accept-package-agreements --accept-source-agreements
    echo.
    echo If FFmpeg was just installed, close this window and run this file again.
  ) else (
    echo Install FFmpeg from https://ffmpeg.org/download.html and add it to PATH.
  )
  pause
  exit /b 1
)
echo.
echo Downloader is starting at http://localhost:5000
echo Keep this window open while using the downloader webpage.
echo Press CTRL+C to stop the server.
echo.
python main.py
goto end
:failed
echo.
echo Setup failed. Check the error above.
pause
exit /b 1
:end
pause
