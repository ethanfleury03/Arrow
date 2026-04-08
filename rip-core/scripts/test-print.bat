@echo off
setlocal

call "%~dp0setup-env.bat" || exit /b 1

set "ROOT=%~dp0.."
set "EXE_VENDOR=%ROOT%\vendor\memjet-rip.exe"
set "EXE_BUILD=%ROOT%\src\build\Release\memjet-rip.exe"

:: Resolve EXE — prefer vendor/ pre-built, fall back to build output
if exist "%EXE_VENDOR%" (
    set "EXE=%EXE_VENDOR%"
) else if exist "%EXE_BUILD%" (
    set "EXE=%EXE_BUILD%"
) else (
    echo [ERROR] memjet-rip.exe not found.
    echo [ERROR] Expected at:
    echo [ERROR]   vendor\memjet-rip.exe          ^(pre-built^)
    echo [ERROR]   src\build\Release\memjet-rip.exe ^(from build^)
    echo [HINT] Run scripts\rebuild.bat or add the EXE to vendor\
    exit /b 1
)

if "%~1"=="" (
    echo Usage:
    echo   scripts\test-print.bat "C:\path\input.pdf" [extra rip args]
    exit /b 1
)

echo [INFO] Running: %EXE%
"%EXE%" -i "%~1" --pes-ip 192.168.100.200 --pes-port 13001 --dpi 1600 --paper letter --page 1 -v %2 %3 %4 %5 %6 %7 %8 %9
set "RC=%ERRORLEVEL%"
echo [INFO] EXITCODE=%RC%
exit /b %RC%
