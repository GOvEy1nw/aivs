@echo off
setlocal

set "ROOT=%~dp0"
set "VIRTUAL_ENV=%ROOT%backend\.venv"
set "PYTHON_EXE=%VIRTUAL_ENV%\Scripts\python.exe"
set "WANGP_DIR=%WANGP_ROOT%"
if "%WANGP_DIR%"=="" set "WANGP_DIR=%WANGP_WGP_PATH%"
if "%WANGP_DIR%"=="" set "WANGP_DIR=C:\Wan2GP"
if /I "%WANGP_DIR:~-6%"=="wgp.py" for %%I in ("%WANGP_DIR%\..") do set "WANGP_DIR=%%~fI"

if not exist "%PYTHON_EXE%" (
    echo [!] Missing project Python: "%PYTHON_EXE%"
    echo     Run pnpm setup:dev:win first, then try again.
    pause
    exit /b 1
)

if not exist "%WANGP_DIR%\wgp.py" (
    echo [!] Missing Wan2GP entrypoint: "%WANGP_DIR%\wgp.py"
    echo     Set WANGP_ROOT, WANGP_WGP_PATH, or place Wan2GP at C:\Wan2GP.
    pause
    exit /b 1
)

if not exist "%WANGP_DIR%\shared\api.py" (
    echo [!] Wan2GP source is incomplete: "%WANGP_DIR%\shared\api.py"
    pause
    exit /b 1
)

cd /d "%WANGP_DIR%" || (
    echo [!] Could not enter Wan2GP folder.
    pause
    exit /b 1
)

rem Avoid activate.bat, which can retain an absolute path after moving the repo.
set "PATH=%VIRTUAL_ENV%\Scripts;%PATH%"
set "PYTHONHOME="
set "WANGP_ROOT=%WANGP_DIR%"

echo [*] Starting Wan2GP browser UI with project venv...
echo [*] Command: "%PYTHON_EXE%" wgp.py --config "%ROOT%." --open-browser %*
"%PYTHON_EXE%" wgp.py --config "%ROOT%." --open-browser %*

set "EXIT_CODE=%ERRORLEVEL%"
echo.
echo [*] Wan2GP exited with code %EXIT_CODE%.
pause
exit /b %EXIT_CODE%
