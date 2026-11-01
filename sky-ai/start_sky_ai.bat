@echo off
REM Double-click to start Sky AI Ultra. First run: installs everything and trains Sky AI.
REM After that it only retrains when the files in the data folder change.
cd /d "%~dp0"
title Sky AI Ultra

if not exist .venv\Scripts\activate.bat (
    echo === First time: installing everything. This can take 10-20 minutes. ===
    call setup.bat
    if errorlevel 1 goto failed
)
call .venv\Scripts\activate.bat

REM Install anything new in requirements.txt (quick when nothing changed).
pip install -q -r requirements.txt
if errorlevel 1 goto failed

echo.
echo === Checking Sky AI's training. Training only runs when the data changed. ===
python train.py --if-changed
if errorlevel 1 goto failed

echo.
echo === Opening Sky AI Ultra ===
python app.py
if errorlevel 1 goto failed
goto end

:failed
echo.
echo Something went wrong. Copy the error message above and paste it to Claude.
pause

:end
