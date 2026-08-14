@echo off
REM ===================================================================
REM  MeterWorklog - Windows Service Installer
REM  Run AS ADMINISTRATOR
REM  Place this file inside the MeterWorklog folder before running.
REM ===================================================================

REM Auto-detect folder from location of this script
SET APP_DIR=%~dp0
IF "%APP_DIR:~-1%"=="\" SET APP_DIR=%APP_DIR:~0,-1%

SET PYTHON_EXE=%APP_DIR%\.venv\Scripts\python.exe
SET NSSM_EXE=C:\Windows\System32\nssm.exe
SET NGROK_EXE=%APP_DIR%\deployer\ngrok.exe
SET CLOUDFLARED_EXE=%APP_DIR%\deployer\cloudflared.exe
SET TAILSCALE_EXE=C:\Program Files\Tailscale\tailscale.exe
SET SVC_APP=MeterWorklog
REM NGROK_* / SVC_NGROK are DEPRECATED — kept dormant (defined but no longer
REM installed below) as a fast rollback path during the Cloudflare Tunnel
REM transition. Safe to delete once Cloudflare Tunnel is confirmed stable.
SET SVC_NGROK=MeterWorklog-ngrok
SET SVC_CLOUDFLARED=MeterWorklog-cloudflared
SET APP_PORT=5050
SET DB_SERVER=localhost\SQLEXPRESS
SET DB_NAME=MWLTimesheet
SET DB_DRIVER={ODBC Driver 17 for SQL Server}
SET DB_TRUST_CERT=yes
SET SECRET_KEY=Metercenter
SET NGROK_AUTHTOKEN=
SET NGROK_DOMAIN=
SET CF_TUNNEL_TOKEN=
SET CF_TUNNEL_DOMAIN=
REM Hostname of the Cloudflare Worker that serves the SPA and proxies /api/* here.
REM The browser's Origin is the Worker's hostname, so the CSRF check must trust it.
SET WORKER_DOMAIN=
SET TAILSCALE_DOMAIN=
REM Public base URL used to build password-reset links in emails. Blank on purpose —
REM derived from CF_TUNNEL_DOMAIN (or NGROK_DOMAIN as a fallback) after the .env
REM block below unless .env overrides it.
SET APP_BASE_URL=
REM Waitress channel timeout (seconds). Default 3600 = 60 min — needed for multi-GB
REM uploads over Tailscale, especially via DERP relays. Override in .env if needed.
SET WAITRESS_CHANNEL_TIMEOUT=3600
REM Waitress max request body size (bytes). Waitress's OWN default is 1 GB and it
REM rejects oversized requests BEFORE Flask's MAX_CONTENT_LENGTH is consulted, so
REM this MUST be at least as large as FILE_UPLOAD_MAX_MB * 1024 * 1024.
REM Default 104857600 = 100 MB (matches FILE_UPLOAD_MAX_MB=100 exactly).
SET WAITRESS_MAX_REQUEST_BODY=104857600
REM Storage paths — recommended to use separate drive (e.g. D:\) for safety & backups
SET FILE_STORAGE_DIR=E:\MeterWorklog_Storage\files
SET AVATAR_STORAGE_DIR=E:\MeterWorklog_Storage\avatars
REM Per-file upload cap (MB). Capped at 100 because requests reach Flask through
REM the Cloudflare Worker, and Cloudflare's proxied request-body limit is 100 MB
REM on Free/Pro (200 MB Business, 500 MB Enterprise). Raising this alone does NOT
REM raise the real limit — larger uploads die at the edge with a 413 Flask never
REM sees. Raise the Cloudflare plan first, then this AND WAITRESS_MAX_REQUEST_BODY.
SET FILE_UPLOAD_MAX_MB=100
SET FILE_STORAGE_CAP_MB=614400
SET FILE_MIN_FREE_MB=8192

REM Load settings from .env if present
if exist "%APP_DIR%\.env" (
    for /f "usebackq tokens=1* delims==" %%A in (`findstr /b SECRET_KEY "%APP_DIR%\.env" 2^>nul`) do if /i "%%A"=="SECRET_KEY" set SECRET_KEY=%%B
    for /f "usebackq tokens=1* delims==" %%A in (`findstr /b DB_SERVER "%APP_DIR%\.env" 2^>nul`) do if /i "%%A"=="DB_SERVER" set DB_SERVER=%%B
    for /f "usebackq tokens=1* delims==" %%A in (`findstr /b DB_NAME "%APP_DIR%\.env" 2^>nul`) do if /i "%%A"=="DB_NAME" set DB_NAME=%%B
    for /f "usebackq tokens=1* delims==" %%A in (`findstr /b NGROK_AUTHTOKEN "%APP_DIR%\.env" 2^>nul`) do if /i "%%A"=="NGROK_AUTHTOKEN" set NGROK_AUTHTOKEN=%%B
    for /f "usebackq tokens=1* delims==" %%A in (`findstr /b NGROK_DOMAIN "%APP_DIR%\.env" 2^>nul`) do if /i "%%A"=="NGROK_DOMAIN" set NGROK_DOMAIN=%%B
    REM Quoted set: the token can contain characters an unquoted set would mishandle.
    for /f "usebackq tokens=1* delims==" %%A in (`findstr /b CF_TUNNEL_TOKEN "%APP_DIR%\.env" 2^>nul`) do if /i "%%A"=="CF_TUNNEL_TOKEN" set "CF_TUNNEL_TOKEN=%%B"
    for /f "usebackq tokens=1* delims==" %%A in (`findstr /b CF_TUNNEL_DOMAIN "%APP_DIR%\.env" 2^>nul`) do if /i "%%A"=="CF_TUNNEL_DOMAIN" set CF_TUNNEL_DOMAIN=%%B
    for /f "usebackq tokens=1* delims==" %%A in (`findstr /b WORKER_DOMAIN "%APP_DIR%\.env" 2^>nul`) do if /i "%%A"=="WORKER_DOMAIN" set WORKER_DOMAIN=%%B
    for /f "usebackq tokens=1* delims==" %%A in (`findstr /b TAILSCALE_DOMAIN "%APP_DIR%\.env" 2^>nul`) do if /i "%%A"=="TAILSCALE_DOMAIN" set TAILSCALE_DOMAIN=%%B
    for /f "usebackq tokens=1* delims==" %%A in (`findstr /b WAITRESS_CHANNEL_TIMEOUT "%APP_DIR%\.env" 2^>nul`) do if /i "%%A"=="WAITRESS_CHANNEL_TIMEOUT" set WAITRESS_CHANNEL_TIMEOUT=%%B
    for /f "usebackq tokens=1* delims==" %%A in (`findstr /b WAITRESS_MAX_REQUEST_BODY "%APP_DIR%\.env" 2^>nul`) do if /i "%%A"=="WAITRESS_MAX_REQUEST_BODY" set WAITRESS_MAX_REQUEST_BODY=%%B
    for /f "usebackq tokens=1* delims==" %%A in (`findstr /b FILE_STORAGE_DIR "%APP_DIR%\.env" 2^>nul`) do if /i "%%A"=="FILE_STORAGE_DIR" set FILE_STORAGE_DIR=%%B
    for /f "usebackq tokens=1* delims==" %%A in (`findstr /b AVATAR_STORAGE_DIR "%APP_DIR%\.env" 2^>nul`) do if /i "%%A"=="AVATAR_STORAGE_DIR" set AVATAR_STORAGE_DIR=%%B
    for /f "usebackq tokens=1* delims==" %%A in (`findstr /b FILE_UPLOAD_MAX_MB "%APP_DIR%\.env" 2^>nul`) do if /i "%%A"=="FILE_UPLOAD_MAX_MB" set FILE_UPLOAD_MAX_MB=%%B
    for /f "usebackq tokens=1* delims==" %%A in (`findstr /b FILE_STORAGE_CAP_MB "%APP_DIR%\.env" 2^>nul`) do if /i "%%A"=="FILE_STORAGE_CAP_MB" set FILE_STORAGE_CAP_MB=%%B
    for /f "usebackq tokens=1* delims==" %%A in (`findstr /b FILE_MIN_FREE_MB "%APP_DIR%\.env" 2^>nul`) do if /i "%%A"=="FILE_MIN_FREE_MB" set FILE_MIN_FREE_MB=%%B
    REM Quoted set: the value is a URL, and an unquoted set would break on any & in it.
    for /f "usebackq tokens=1* delims==" %%A in (`findstr /b APP_BASE_URL "%APP_DIR%\.env" 2^>nul`) do if /i "%%A"=="APP_BASE_URL" set "APP_BASE_URL=%%B"
)

REM Default the reset-link base URL to the public domain so the two can never drift.
REM Without this, _base_url() in app\auth.py falls back to the client-supplied
REM X-Forwarded-Host header, which lets a request forge the domain in reset emails.
REM WORKER_DOMAIN wins: once the Worker fronts the app, it is the only hostname
REM users can reach, and the tunnel's own public hostname route gets removed.
REM CF_TUNNEL_DOMAIN is next; NGROK_DOMAIN is a dormant fallback.
if not defined APP_BASE_URL if defined WORKER_DOMAIN if not "%WORKER_DOMAIN%"=="" set "APP_BASE_URL=https://%WORKER_DOMAIN%"
if not defined APP_BASE_URL if defined CF_TUNNEL_DOMAIN if not "%CF_TUNNEL_DOMAIN%"=="" set "APP_BASE_URL=https://%CF_TUNNEL_DOMAIN%"
if not defined APP_BASE_URL if defined NGROK_DOMAIN set "APP_BASE_URL=https://%NGROK_DOMAIN%"

net session >nul 2>&1
if %errorlevel% neq 0 ( echo ERROR: Run as Administrator! & pause & exit /b 1 )

if not exist "%NSSM_EXE%" (
    echo ERROR: nssm.exe not found at %NSSM_EXE%
    echo Download from https://nssm.cc/download and copy to C:\Windows\System32\
    pause & exit /b 1
)

echo Installing MeterWorklog to: %APP_DIR%
if not exist "%APP_DIR%\logs" mkdir "%APP_DIR%\logs"

echo [1/4] Building frontend CSS (Tailwind - static/tailwind.css)...
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo   WARNING: npm not found on PATH - skipping CSS build.
    echo   Install Node.js 18+ from https://nodejs.org, then run manually:
    echo     cd /d "%APP_DIR%" ^&^& npm install ^&^& npm run build:css
    echo   Until then, pages will render UNSTYLED ^(no CDN fallback exists^).
) else (
    pushd "%APP_DIR%"
    call npm install
    call npm run build:css
    if errorlevel 1 (
        echo   WARNING: npm run build:css failed - see output above.
        echo   Pages will render unstyled until this is fixed and re-run.
    )
    popd
)

echo [2/4] Installing %SVC_APP% service...
%NSSM_EXE% install %SVC_APP% "%PYTHON_EXE%"
%NSSM_EXE% set %SVC_APP% AppParameters "-m waitress --host=0.0.0.0 --port=%APP_PORT% --channel-timeout=%WAITRESS_CHANNEL_TIMEOUT% --max-request-body-size=%WAITRESS_MAX_REQUEST_BODY% app:app"
%NSSM_EXE% set %SVC_APP% AppDirectory "%APP_DIR%"
%NSSM_EXE% set %SVC_APP% DisplayName "MeterWorklog App"
%NSSM_EXE% set %SVC_APP% Start SERVICE_AUTO_START
%NSSM_EXE% set %SVC_APP% AppStdout "%APP_DIR%\logs\app.log"
%NSSM_EXE% set %SVC_APP% AppStderr "%APP_DIR%\logs\app-error.log"
%NSSM_EXE% set %SVC_APP% AppRotateFiles 1
%NSSM_EXE% set %SVC_APP% AppRotateBytes 5242880
%NSSM_EXE% set %SVC_APP% AppEnvironmentExtra ^
    "DB_SERVER=%DB_SERVER%" ^
    "DB_NAME=%DB_NAME%" ^
    "DB_DRIVER=%DB_DRIVER%" ^
    "DB_TRUST_CERT=%DB_TRUST_CERT%" ^
    "SECRET_KEY=%SECRET_KEY%" ^
    "NGROK_DOMAIN=%NGROK_DOMAIN%" ^
    "CF_TUNNEL_DOMAIN=%CF_TUNNEL_DOMAIN%" ^
    "WORKER_DOMAIN=%WORKER_DOMAIN%" ^
    "TAILSCALE_DOMAIN=%TAILSCALE_DOMAIN%" ^
    "FILE_STORAGE_DIR=%FILE_STORAGE_DIR%" ^
    "AVATAR_STORAGE_DIR=%AVATAR_STORAGE_DIR%" ^
    "FILE_UPLOAD_MAX_MB=%FILE_UPLOAD_MAX_MB%" ^
    "FILE_STORAGE_CAP_MB=%FILE_STORAGE_CAP_MB%" ^
    "FILE_MIN_FREE_MB=%FILE_MIN_FREE_MB%" ^
    "APP_BASE_URL=%APP_BASE_URL%"

echo [3/4] Installing %SVC_CLOUDFLARED% service...
REM NOTE: %SVC_NGROK% (MeterWorklog-ngrok) is intentionally NOT (re)installed here —
REM Cloudflare Tunnel replaces it. If a MeterWorklog-ngrok service is still registered
REM from a prior install, it's left alone (untouched, not started) as a rollback path:
REM `nssm start MeterWorklog-ngrok` brings the old public path back instantly if the
REM Cloudflare Tunnel token/route turns out to be misconfigured post-cutover.
%NSSM_EXE% install %SVC_CLOUDFLARED% "%CLOUDFLARED_EXE%"
%NSSM_EXE% set %SVC_CLOUDFLARED% AppParameters "tunnel run --token %CF_TUNNEL_TOKEN%"
%NSSM_EXE% set %SVC_CLOUDFLARED% AppDirectory "%APP_DIR%"
%NSSM_EXE% set %SVC_CLOUDFLARED% DisplayName "MeterWorklog Cloudflare Tunnel"
%NSSM_EXE% set %SVC_CLOUDFLARED% Start SERVICE_AUTO_START
%NSSM_EXE% set %SVC_CLOUDFLARED% AppStdout "%APP_DIR%\logs\cloudflared.log"
%NSSM_EXE% set %SVC_CLOUDFLARED% AppStderr "%APP_DIR%\logs\cloudflared-error.log"
%NSSM_EXE% set %SVC_CLOUDFLARED% AppRotateFiles 1
%NSSM_EXE% set %SVC_CLOUDFLARED% AppRotateBytes 5242880
%NSSM_EXE% set %SVC_CLOUDFLARED% DependOnService %SVC_APP%

echo Starting services...
%NSSM_EXE% start %SVC_APP%
timeout /t 3 >nul
%NSSM_EXE% start %SVC_CLOUDFLARED%

echo [4/4] Configuring Tailscale Serve (HTTPS reverse proxy)...
if exist "%TAILSCALE_EXE%" (
    REM tailscale serve --bg persists in the Tailscale daemon's config and survives reboots.
    REM Re-running it just refreshes the same mapping; safe to call on every install.
    "%TAILSCALE_EXE%" serve --bg --https=443 http://localhost:%APP_PORT%
    if errorlevel 1 (
        echo   WARNING: tailscale serve returned a non-zero exit code.
        echo   Common causes: Tailscale not logged in, HTTPS feature not enabled in admin
        echo   panel, or port 443 already in use. Check: "%TAILSCALE_EXE%" serve status
    ) else (
        echo   Tailscale serve configured: https://^<this-machine^>.^<your-tailnet^>.ts.net
        echo   To inspect:  "%TAILSCALE_EXE%" serve status
        echo   To remove:   "%TAILSCALE_EXE%" serve reset
    )
) else (
    echo   SKIPPED: Tailscale CLI not found at %TAILSCALE_EXE%
    echo   Install Tailscale from https://tailscale.com/download/windows then re-run.
)

echo.

echo === Done! ===
echo   Local:    http://localhost:%APP_PORT%
if defined CF_TUNNEL_DOMAIN if not "%CF_TUNNEL_DOMAIN%"=="" echo   Public:   https://%CF_TUNNEL_DOMAIN%
if defined NGROK_DOMAIN if not "%NGROK_DOMAIN%"=="" echo   Public (ngrok, legacy/rollback): https://%NGROK_DOMAIN%
if defined TAILSCALE_DOMAIN if not "%TAILSCALE_DOMAIN%"=="" (
    echo   Tailnet:  https://%TAILSCALE_DOMAIN%
)
echo   Logs:     %APP_DIR%\logs\
echo   Restart:  nssm restart %SVC_APP%
pause
