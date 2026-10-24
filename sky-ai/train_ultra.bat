@echo off
REM Double-click to train Sky AI Ultra (Qwen3-4B). Your current model is backed up first.
REM To go back to the Standard model afterwards, run: .venv\Scripts\python.exe train.py --restore
cd /d "%~dp0"
title Sky AI Ultra - training

if not exist .venv\Scripts\python.exe (
    echo Run start_sky_ai.bat once first so everything gets installed.
    pause
    exit /b 1
)

echo === Training Sky AI Ultra (Qwen3-4B). The first run downloads about 8 GB. ===
echo === This takes a while; the progress lines show how much time is left.  ===
echo.
.venv\Scripts\python.exe train.py --ultra --max-length 1536
if errorlevel 1 (
    echo.
    echo Something went wrong. Copy the error message above and paste it to Claude.
    pause
    exit /b 1
)
echo.
echo Done! Double-click start_sky_ai.bat to chat with Sky AI Ultra.
pause
