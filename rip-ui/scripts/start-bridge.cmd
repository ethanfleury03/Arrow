@echo off
setlocal ENABLEEXTENSIONS

set "ROOT=%~dp0.."
pushd "%ROOT%" >nul

rem ---- Canonical runtime defaults (override by pre-setting env vars) ----
if not defined MEMJET_REAL_BACKEND set "MEMJET_REAL_BACKEND=ssh"
if not defined MEMJET_TARGET_HOST set "MEMJET_TARGET_HOST=192.168.100.200"
if not defined MEMJET_TARGET_COMMAND_PORT set "MEMJET_TARGET_COMMAND_PORT=13001"
if not defined MEMJET_TARGET_EVENT_PORT set "MEMJET_TARGET_EVENT_PORT=9231"
if not defined MEMJET_TARGET_DATA_PORT set "MEMJET_TARGET_DATA_PORT=13001"
if not defined RIP_BRIDGE_ENABLE_REAL_COMMANDS set "RIP_BRIDGE_ENABLE_REAL_COMMANDS=true"
if not defined RIP_BRIDGE_ENABLE_REAL_START_PRINT set "RIP_BRIDGE_ENABLE_REAL_START_PRINT=true"
if not defined RIP_BRIDGE_REAL_DRY_RUN set "RIP_BRIDGE_REAL_DRY_RUN=false"
if not defined MEMJET_ALLOW_DATA_SUBMISSION set "MEMJET_ALLOW_DATA_SUBMISSION=true"
if not defined RIP_BRIDGE_HOST set "RIP_BRIDGE_HOST=127.0.0.1"
if not defined RIP_BRIDGE_PORT set "RIP_BRIDGE_PORT=8787"

if not defined MEMJET_GBORCAT_BIN (
  if exist "%CD%\runtime\bin\gborcat.exe" (
    set "MEMJET_GBORCAT_BIN=%CD%\runtime\bin\gborcat.exe"
    goto :gbor_done
  )
  for /f "delims=" %%I in ('where gborcat.exe 2^>nul') do (
    set "MEMJET_GBORCAT_BIN=%%I"
    goto :gbor_done
  )
)
:gbor_done

call scripts\verify-runtime.cmd
if errorlevel 1 (
  echo [start-bridge] runtime verification failed.
  popd >nul
  exit /b 1
)

echo [start-bridge] starting bridge from %CD%
echo [start-bridge] backend=%MEMJET_REAL_BACKEND% host=%MEMJET_TARGET_HOST% cmd=%MEMJET_TARGET_COMMAND_PORT% evt=%MEMJET_TARGET_EVENT_PORT% data=%MEMJET_TARGET_DATA_PORT%

node bridge\server.js
set "RC=%ERRORLEVEL%"

echo [start-bridge] exited with code %RC%
popd >nul
exit /b %RC%
