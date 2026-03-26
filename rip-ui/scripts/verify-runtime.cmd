@echo off
setlocal ENABLEEXTENSIONS

set "ROOT=%~dp0.."
pushd "%ROOT%" >nul

set "OK=1"

echo [verify-runtime] root=%CD%

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] node.exe not found in PATH
  set "OK=0"
) else (
  for /f "delims=" %%I in ('where node') do (
    echo [ok] node=%%I
    goto :node_done
  )
)
:node_done

if defined MEMJET_GBORCAT_BIN (
  if exist "%MEMJET_GBORCAT_BIN%" (
    echo [ok] MEMJET_GBORCAT_BIN=%MEMJET_GBORCAT_BIN%
  ) else (
    echo [ERROR] MEMJET_GBORCAT_BIN is set but file does not exist: %MEMJET_GBORCAT_BIN%
    set "OK=0"
  )
) else (
  if exist "%CD%\runtime\bin\gborcat.exe" (
    set "MEMJET_GBORCAT_BIN=%CD%\runtime\bin\gborcat.exe"
    goto :gbor_found
  )
  for /f "delims=" %%I in ('where gborcat.exe 2^>nul') do (
    set "MEMJET_GBORCAT_BIN=%%I"
    goto :gbor_found
  )
  echo [ERROR] gborcat.exe not found at runtime\bin or PATH and MEMJET_GBORCAT_BIN is not set.
  echo         Example: set MEMJET_GBORCAT_BIN=C:\Arrow\rip-ui\runtime\bin\gborcat.exe
  set "OK=0"
  goto :after_gbor
)

goto :after_gbor
:gbor_found
echo [ok] detected gborcat=%MEMJET_GBORCAT_BIN%

:after_gbor

echo [info] target host=%MEMJET_TARGET_HOST%
echo [info] command port=%MEMJET_TARGET_COMMAND_PORT%
echo [info] event port=%MEMJET_TARGET_EVENT_PORT%
echo [info] data port=%MEMJET_TARGET_DATA_PORT%

if "%OK%"=="1" (
  echo [verify-runtime] PASS
  popd >nul
  exit /b 0
)

echo [verify-runtime] FAIL
popd >nul
exit /b 1
