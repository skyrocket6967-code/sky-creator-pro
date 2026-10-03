@echo off
REM Double-click this file to set up, train (first time only) and chat with Sky AI.
cd /d "%~dp0"

if not exist .venv\Scripts\activate.bat (
    echo === First time: installing everything. This can take 10-20 minutes. ===
    call setup.bat
    if errorlevel 1 goto failed
)
call .venv\Scripts\activate.bat

if not exist sky-ai-lora\adapter_config.json (
    echo.
    echo === Training Sky AI for the first time. This takes a few minutes. ===
    python train.py
    if errorlevel 1 goto failed
)

echo.
echo === Starting Sky AI. Type /exit to quit. ===
python chat.py
goto end

:failed
echo.
echo Something went wrong. Copy the error message above and paste it to Claude.

:end
echo.
pause
