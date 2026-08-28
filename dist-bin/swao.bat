@echo off
REM swao.bat -- launcher for SWAO Windows binaries.
REM
REM Place this file alongside one or more SWAO binaries in the same directory:
REM
REM   swao-community-win.exe       Community edition (open-source, default)
REM   swao-consultant-win-x64.exe  Consultant edition
REM   swao-enterprise-win-x64.exe  Enterprise edition
REM
REM Tier selection:
REM   The launcher picks the Community binary by default.
REM   Set SWAO_TIER to select a different edition:
REM
REM     set SWAO_TIER=consultant
REM     set SWAO_TIER=enterprise
REM
REM   If Community is not present, the launcher falls back to Consultant then
REM   Enterprise automatically. An error is shown if no binary is found.
REM
REM Behaviour:
REM   - With args:    forwards them to the selected binary and exits with its code
REM   - Without args: opens the SWAO TUI menu (swao menu)
REM
REM The wrapper uses %~dp0 to resolve binaries relative to itself, so the .bat
REM and .exe files can sit in any directory without editing this file.
REM
REM See docs/runbooks/install.md for full installation instructions.

setlocal EnableDelayedExpansion
title SWAO -- Sovereign Workload Assessment and Onboarding
set "DIR=%~dp0"

REM --- Resolve which binary to use ---------------------------------------

if /I "!SWAO_TIER!"=="enterprise" (
    set "SWAO=!DIR!swao-enterprise-win-x64.exe"
    set "TIER_LABEL=Enterprise"
    goto :check_binary
)

if /I "!SWAO_TIER!"=="consultant" (
    set "SWAO=!DIR!swao-consultant-win-x64.exe"
    set "TIER_LABEL=Consultant"
    goto :check_binary
)

REM Default: Community. Auto-detect if not found.
if exist "!DIR!swao-community-win.exe" (
    set "SWAO=!DIR!swao-community-win.exe"
    set "TIER_LABEL=Community"
    goto :run
)
if exist "!DIR!swao-consultant-win-x64.exe" (
    set "SWAO=!DIR!swao-consultant-win-x64.exe"
    set "TIER_LABEL=Consultant"
    goto :run
)
if exist "!DIR!swao-enterprise-win-x64.exe" (
    set "SWAO=!DIR!swao-enterprise-win-x64.exe"
    set "TIER_LABEL=Enterprise"
    goto :run
)

echo.
echo ERROR: No SWAO binary found in !DIR!
echo.
echo Expected one of:
echo   swao-community-win.exe
echo   swao-consultant-win-x64.exe
echo   swao-enterprise-win-x64.exe
echo.
echo Download the binary for your edition from:
echo   https://github.com/Accenture/SWAO/releases
echo.
exit /b 1

:check_binary
if not exist "!SWAO!" (
    echo.
    echo ERROR: !TIER_LABEL! binary not found: !SWAO!
    echo.
    echo Set SWAO_TIER=community, SWAO_TIER=consultant, or SWAO_TIER=enterprise,
    echo or place the matching .exe in the same directory as swao.bat.
    echo.
    exit /b 1
)

:run
REM --- Forward args or open TUI ------------------------------------------
if not "%~1"=="" (
    set "SWAO_LAUNCHER_WROTE_BANNER=1"
    "!SWAO!" %*
    exit /b %ERRORLEVEL%
)

echo.
echo ================================================================
echo.
echo                    S  W  A  O
echo.
echo   Sovereign Workload Assessment and Onboarding
echo   Windows launcher  [!TIER_LABEL! edition]
echo.
echo   Free and Open-Source Software (FOSS)
echo.
echo   Website       :  https://steady-echo-yp4z.here.now/
echo   Technical Docs:  https://accenture.github.io/SWAO/en/
echo   Source Code   :  https://github.com/Accenture/SWAO
echo.
echo ================================================================
echo.

set "SWAO_LAUNCHER_WROTE_BANNER=1"
"!SWAO!" menu
exit /b %ERRORLEVEL%
