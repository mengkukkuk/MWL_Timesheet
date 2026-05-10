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
SET NGROK_EXE=%APP_DIR%\ngrokv3\ngrok.exe
SET TAILSCALE_EXE=C:\Program Files\Tailscale\tailscale.exe
SET SVC_APP=MeterWorklog
SET SVC_NGROK=MeterWorklog-ngrok
SET APP_PORT=5123
SET DB_SERVER=localhost\SQLEXPRESS
SET DB_NAME=MeterWorklog
SET DB_DRIVER={ODBC Driver 17 for SQL Server}
SET DB_TRUST_CERT=yes
SET SECRET_KEY=Metercenter
SET NGROK_AUTHTOKEN=
SET NGROK_DOMAIN=
SET TAILSCALE_DOMAIN=
REM Waitress channel timeout (seconds). Default 3600 = 60 min — needed for multi-GB
REM uploads over Tailscale, especially via DERP relays. Override in .env if needed.
SET WAITRESS_CHANNEL_TIMEOUT=3600
REM Waitress max request body size (bytes). Waitress's OWN default is 1 GB and it
REM rejects oversized requests BEFORE Flask's MAX_CONTENT_LENGTH is consulted, so
REM this MUST be at least as large as FILE_UPLOAD_MAX_MB * 1024 * 1024.
REM Default 5368709120 = 5 GB (matches FILE_UPLOAD_MAX_MB=5120 with no headroom).
REM For larger uploads, raise both this and FILE_UPLOAD_MAX_MB.
SET WAITRESS_MAX_REQUEST_BODY=5368709120

REM Load settings from .env if present
if exist "%APP_DIR%\.env" (
    for /f "usebackq tokens=1* delims==" %%A in (`findstr /b SECRET_KEY "%APP_DIR%\.env" 2^>nul`) do if /i "%%A"=="SECRET_KEY" set SECRET_KEY=%%B
    for /f "usebackq tokens=1* delims==" %%A in (`findstr /b DB_SERVER "%APP_DIR%\.env" 2^>nul`) do if /i "%%A"=="DB_SERVER" set DB_SERVER=%%B
    for /f "usebackq tokens=1* delims==" %%A in (`findstr /b DB_NAME "%APP_DIR%\.env" 2^>nul`) do if /i "%%A"=="DB_NAME" set DB_NAME=%%B
    for /f "usebackq tokens=1* delims==" %%A in (`findstr /b NGROK_AUTHTOKEN "%APP_DIR%\.env" 2^>nul`) do if /i "%%A"=="NGROK_AUTHTOKEN" set NGROK_AUTHTOKEN=%%B
    for /f "usebackq tokens=1* delims==" %%A in (`findstr /b NGROK_DOMAIN "%APP_DIR%\.env" 2^>nul`) do if /i "%%A"=="NGROK_DOMAIN" set NGROK_DOMAIN=%%B
    for /f "usebackq tokens=1* delims==" %%A in (`findstr /b TAILSCALE_DOMAIN "%APP_DIR%\.env" 2^>nul`) do if /i "%%A"=="TAILSCALE_DOMAIN" set TAILSCALE_DOMAIN=%%B
    for /f "usebackq tokens=1* delims==" %%A in (`findstr /b WAITRESS_CHANNEL_TIMEOUT "%APP_DIR%\.env" 2^>nul`) do if /i "%%A"=="WAITRESS_CHANNEL_TIMEOUT" set WAITRESS_CHANNEL_TIMEOUT=%%B
    for /f "usebackq tokens=1* delims==" %%A in (`findstr /b WAITRESS_MAX_REQUEST_BODY "%APP_DIR%\.env" 2^>nul`) do if /i "%%A"=="WAITRESS_MAX_REQUEST_BODY" set WAITRESS_MAX_REQUEST_BODY=%%B
)

net session >nul 2>&1
if %errorlevel% neq 0 ( echo ERROR: Run as Administrator! & pause & exit /b 1 )

if not exist "%NSSM_EXE%" (
    echo ERROR: nssm.exe not found at %NSSM_EXE%
    echo Download from https://nssm.cc/download and copy to C:\Windows\System32\
    pause & exit /b 1
)

echo Installing MeterWorklog to: %APP_DIR%
if not exist "%APP_DIR%\logs" mkdir "%APP_DIR%\logs"

echo [1/2] Installing %SVC_APP% service...
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
    "TAILSCALE_DOMAIN=%TAILSCALE_DOMAIN%"

echo [2/2] Installing %SVC_NGROK% service...
%NSSM_EXE% install %SVC_NGROK% "%NGROK_EXE%"
%NSSM_EXE% set %SVC_NGROK% AppParameters "http %APP_PORT% --url=%NGROK_DOMAIN% --authtoken=%NGROK_AUTHTOKEN%"
%NSSM_EXE% set %SVC_NGROK% AppDirectory "%APP_DIR%"
%NSSM_EXE% set %SVC_NGROK% DisplayName "MeterWorklog ngrok Tunnel"
%NSSM_EXE% set %SVC_NGROK% Start SERVICE_AUTO_START
%NSSM_EXE% set %SVC_NGROK% AppStdout "%APP_DIR%\logs\ngrok.log"
%NSSM_EXE% set %SVC_NGROK% AppStderr "%APP_DIR%\logs\ngrok-error.log"
%NSSM_EXE% set %SVC_NGROK% AppRotateFiles 1
%NSSM_EXE% set %SVC_NGROK% AppRotateBytes 5242880
%NSSM_EXE% set %SVC_NGROK% DependOnService %SVC_APP%

echo Starting services...
%NSSM_EXE% start %SVC_APP%
timeout /t 3 >nul
%NSSM_EXE% start %SVC_NGROK%

echo [3/3] Configuring Tailscale Serve (HTTPS reverse proxy)...
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
echo   Public:   https://%NGROK_DOMAIN%
if defined TAILSCALE_DOMAIN if not "%TAILSCALE_DOMAIN%"=="" (
    echo   Tailnet:  https://%TAILSCALE_DOMAIN%
)
echo   Logs:     %APP_DIR%\logs\
echo   Restart:  nssm restart %SVC_APP%
pause
