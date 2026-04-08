@echo off
setlocal

set "VENDOR_DIR=%~dp0..\vendor\ghostscript"
set "GS_INSTALL_DIR=%VENDOR_DIR%\gs"
set "GS_EXE=%VENDOR_DIR%\gs10070w64.exe"
set "GS_BIN=%GS_INSTALL_DIR%\bin\gswin64c.exe"

if not exist "%GS_EXE%" (
    echo [ERROR] Ghostscript installer not found: %GS_EXE%
    echo Run this script from the rip-core directory.
    exit /b 1
)

if exist "%GS_BIN%" (
    echo [INFO] Ghostscript already installed at %GS_BIN%
) else (
    echo [INFO] Installing Ghostscript 10.07.0 to %GS_INSTALL_DIR%...
    start /wait "" "%GS_EXE%" /S /D="%GS_INSTALL_DIR%"
)

if not exist "%GS_BIN%" (
    echo [ERROR] gswin64c.exe not found after install at %GS_BIN%
    exit /b 1
)

echo [OK] Ghostscript installed: %GS_BIN%
exit /b 0
