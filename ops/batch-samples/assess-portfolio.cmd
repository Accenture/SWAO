@echo off
REM ===========================================================
REM SWAO -- assess N apps + emit portfolio BI bundle
REM
REM Edit the three variables below to match your engagement,
REM then run this script from a Windows command prompt.
REM Halts on the first failure so partial bundles are not
REM emitted silently.
REM ===========================================================

REM --- Configuration ----------------------------------------
REM Absolute path to the SWAO binary on this machine.
set SWAO_BIN=C:\Projects\accenture\swao\dist-bin\swao-enterprise-win.exe

REM Absolute path to the operator workspace (where .swao.yml lives).
set WORKSPACE=C:\swao-e2e

REM Space-separated list of app ids under <WORKSPACE>\apps\.
REM Match the directory names exactly; the script does not glob.
set APP_LIST=sovereign-health e2e-ct app-three app-four app-five
REM -----------------------------------------------------------

if not exist "%SWAO_BIN%" (
  echo [error] swao binary not found at %SWAO_BIN%
  echo         Edit SWAO_BIN at the top of this script.
  exit /b 1
)

cd /d "%WORKSPACE%"
if errorlevel 1 (
  echo [error] could not enter workspace at %WORKSPACE%
  echo         Edit WORKSPACE at the top of this script.
  exit /b 1
)

echo.
echo === Pre-flight environment check (doctor) ===
"%SWAO_BIN%" doctor
if errorlevel 1 (
  echo.
  echo [error] doctor reported a failure -- fix the listed issue and re-run.
  echo         Most common: missing licence, no anthropic-api-key in keychain,
  echo         Chromium not installed (run: swao install-playwright).
  exit /b 1
)

REM Assess each app sequentially. errorlevel from any assess halts the batch.
for %%A in (%APP_LIST%) do (
  echo.
  echo === Assessing %%A ===
  "%SWAO_BIN%" assess --app %%A
  if errorlevel 1 (
    echo.
    echo [error] assess failed for %%A -- aborting batch.
    echo         Inspect logs at %WORKSPACE%\apps\%%A\wsp\runs\^<latest^>\
    exit /b 1
  )
)

echo.
echo === Emitting portfolio BI bundle (export --portfolio) ===
"%SWAO_BIN%" export --portfolio
if errorlevel 1 (
  echo.
  echo [error] portfolio export failed.
  echo         Premium-tier licence required for --portfolio.
  echo         Check: swao license status
  exit /b 1
)

echo.
echo === Batch complete ===
"%SWAO_BIN%" --version
echo.
echo Bundle paths printed above. Paste the portfolio bundle path
echo into PowerBI Desktop's SWAOPortfolioExportPath parameter,
echo or open the .pbit at:
echo    %WORKSPACE%\wsp\templates\powerbi\swao-portfolio.pbit
echo.
