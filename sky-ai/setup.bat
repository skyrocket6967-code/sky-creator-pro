@echo off
REM Sky AI one-time setup for Windows. Run from the sky-ai folder:  setup.bat
setlocal

where python >nul 2>nul
if errorlevel 1 (
    echo ERROR: Python was not found. Install Python 3.11 or 3.12 from python.org
    echo and tick "Add python.exe to PATH" in the installer.
    exit /b 1
)

if not exist .venv (
    echo Creating virtual environment in .venv ...
    python -m venv .venv || exit /b 1
)
call .venv\Scripts\activate.bat

python -m pip install --upgrade pip

echo.
echo Installing PyTorch with CUDA support (about 3 GB download) ...
pip install torch --index-url https://download.pytorch.org/whl/cu128
if errorlevel 1 (
    echo cu128 build not available, trying cu130 ...
    pip install torch --index-url https://download.pytorch.org/whl/cu130
)
if errorlevel 1 (
    echo cu130 build not available, trying cu126 ...
    pip install torch --index-url https://download.pytorch.org/whl/cu126 || exit /b 1
)

echo.
echo Installing Hugging Face libraries ...
pip install -r requirements.txt || exit /b 1

echo.
python -c "import torch; ok = torch.cuda.is_available(); print('CUDA available:', ok); print('GPU:', torch.cuda.get_device_name(0) if ok else 'NONE - see README Troubleshooting')"

echo.
echo Setup finished. Next time, activate the environment with:  .venv\Scripts\activate
echo Then train with:  python train.py
endlocal
