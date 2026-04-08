@echo off
setlocal

cd /d "%~dp0.." || exit /b 1

set "ROOT=%CD%"
set "SRC=%ROOT%\src"
set "BUILD=%SRC%\build"
set "EXE=%BUILD%\Release\memjet-rip.exe"
set "EXE_VENDOR=%ROOT%\vendor\memjet-rip.exe"
set "JSL_RUNTIME=%ROOT%\vendor\runtime\jsl"
set "PDL_THRIFT_ROOT=%ROOT%\vendor\pdl_py"
set "GS_STUB=%ROOT%\gswin64c"
set "GS_STUB_EXE=%ROOT%\gswin64c.exe"

:: Check for pre-built EXE in vendor/ first
if exist "%EXE_VENDOR%" (
    echo [INFO] Using pre-built EXE from vendor\: %EXE_VENDOR%
    set "EXE=%EXE_VENDOR%"
    goto :env_ready
)

:: No vendor EXE — require build artifacts
if not exist "%SRC%\CMakeLists.txt" (
    echo [ERROR] Missing %SRC%\CMakeLists.txt — cannot build from source
    echo [HINT] Either place memjet-rip.exe in vendor\ or run scripts\rebuild.bat first
    exit /b 1
)

:: Build path — validate dependencies exist
if not exist "%JSL_RUNTIME%" (
    echo [ERROR] Missing JSL runtime folder: %JSL_RUNTIME%
    echo [HINT] Place required JSL DLLs in vendor\runtime\jsl\
    exit /b 1
)

if not exist "%PDL_THRIFT_ROOT%\thrift" (
    echo [ERROR] Missing Thrift python runtime: %PDL_THRIFT_ROOT%\thrift
    echo [HINT] Ensure vendor\pdl_py contains thrift\ and Memjet\ packages
    exit /b 1
)

echo [INFO] Using build output EXE: %EXE%

:env_ready
set "PATH=%JSL_RUNTIME%;%PATH%"
set "PDL_THRIFT_ROOT=%PDL_THRIFT_ROOT%"

if exist "%GS_STUB%" (
    echo [WARN] Local gswin64c shim detected at repo root: %GS_STUB%
    echo [WARN] This can shadow the real Ghostscript binary.
)
if exist "%GS_STUB_EXE%" (
    echo [WARN] Local gswin64c.exe detected at repo root: %GS_STUB_EXE%
    echo [WARN] This can shadow the real Ghostscript binary.
)

for /f "delims=" %%G in ('where gswin64c 2^>nul') do (
    echo [INFO] gswin64c=%%G
    set "GS_FOUND=1"
    goto :gs_found
)

:gs_not_found
if not defined GS_FOUND (
    echo [ERROR] gswin64c not found in PATH
    echo [HINT] Install Ghostscript (gswin64c.exe)
    exit /b 1
)

:gs_found

echo [OK] setup-env complete
echo [INFO] ROOT=%ROOT%
echo [INFO] EXE=%EXE%
echo [INFO] JSL_RUNTIME=%JSL_RUNTIME%
echo [INFO] PDL_THRIFT_ROOT=%PDL_THRIFT_ROOT%
exit /b 0
