@echo off
REM ══════════════════════════════════════════════════════════════════════
REM  MeterWorklog - Uninstall Windows Services
REM  Run AS ADMINISTRATOR
REM ══════════════════════════════════════════════════════════════════════

SET NSSM_EXE=C:\Windows\System32\nssm.exe
SET TAILSCALE_EXE=C:\Program Files\Tailscale\tailscale.exe
SET SVC_APP=MeterWorklog
SET SVC_NGROK=MeterWorklog-ngrok
SET SVC_CLOUDFLARED=MeterWorklog-cloudflared

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Run this script as Administrator!
    pause
    exit /b 1
)

echo Stopping and removing services...

%NSSM_EXE% stop %SVC_CLOUDFLARED% >nul 2>&1
%NSSM_EXE% remove %SVC_CLOUDFLARED% confirm
echo   %SVC_CLOUDFLARED% removed.

REM Harmless no-op if MeterWorklog-ngrok was never (re)installed (e.g. on a machine
REM provisioned after the Cloudflare Tunnel cutover) — kept for symmetry during
REM the transition window.
%NSSM_EXE% stop %SVC_NGROK% >nul 2>&1
%NSSM_EXE% remove %SVC_NGROK% confirm
echo   %SVC_NGROK% removed.

%NSSM_EXE% stop %SVC_APP% >nul 2>&1
%NSSM_EXE% remove %SVC_APP% confirm
echo   %SVC_APP% removed.

if exist "%TAILSCALE_EXE%" (
    "%TAILSCALE_EXE%" serve reset >nul 2>&1
    echo   Tailscale serve config reset.
)

echo.
echo All services removed.
pause
