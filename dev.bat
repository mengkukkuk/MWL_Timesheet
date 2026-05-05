@echo off
REM ══════════════════════════════════════════════════════════════
REM  MeterWorklog — Dev Server + ngrok
REM  Starts Flask (debug mode) and ngrok in separate windows.
REM ══════════════════════════════════════════════════════════════

SET APP_DIR=%~dp0
IF "%APP_DIR:~-1%"=="\" SET APP_DIR=%APP_DIR:~0,-1%

SET PYTHON_EXE=%APP_DIR%\.venv\Scripts\python.exe
SET NGROK_EXE=%APP_DIR%\ngrokv3\ngrok.exe

REM Load ngrok settings from .env
SET NGROK_AUTHTOKEN=
SET NGROK_DOMAIN=
SET APP_PORT=5000

IF EXIST "%APP_DIR%\.env" (
    FOR /f "usebackq tokens=1* delims==" %%A IN (`findstr /b APP_PORT    "%APP_DIR%\.env" 2^>nul`) DO IF /I "%%A"=="APP_PORT"         SET APP_PORT=%%B
    FOR /f "usebackq tokens=1* delims==" %%A IN (`findstr /b NGROK_AUTHTOKEN "%APP_DIR%\.env" 2^>nul`) DO IF /I "%%A"=="NGROK_AUTHTOKEN" SET NGROK_AUTHTOKEN=%%B
    FOR /f "usebackq tokens=1* delims==" %%A IN (`findstr /b NGROK_DOMAIN   "%APP_DIR%\.env" 2^>nul`) DO IF /I "%%A"=="NGROK_DOMAIN"    SET NGROK_DOMAIN=%%B
)

IF NOT EXIST "%PYTHON_EXE%" (
    echo ERROR: .venv not found. Run:  python -m venv .venv  ^&  .venv\Scripts\pip install -r requirements.txt
    pause & exit /b 1
)

echo ================================================
echo   MeterWorklog Dev Server
echo   Local : http://localhost:%APP_PORT%
IF NOT "%NGROK_DOMAIN%"=="" echo   Public: https://%NGROK_DOMAIN%
echo ================================================
echo.

REM Start Flask dev server in a new window
START "MeterWorklog Flask" cmd /k "cd /d "%APP_DIR%" && set FLASK_DEBUG=true && "%PYTHON_EXE%" app.py"

REM Start ngrok tunnel if configured
IF "%NGROK_AUTHTOKEN%"=="" (
    echo WARNING: NGROK_AUTHTOKEN not set in .env — skipping ngrok.
) ELSE (
    timeout /t 2 >nul
    IF "%NGROK_DOMAIN%"=="" (
        START "MeterWorklog ngrok" cmd /k ""%NGROK_EXE%" http %APP_PORT% --authtoken=%NGROK_AUTHTOKEN%"
    ) ELSE (
        START "MeterWorklog ngrok" cmd /k ""%NGROK_EXE%" http %APP_PORT% --url=%NGROK_DOMAIN% --authtoken=%NGROK_AUTHTOKEN%"
    )
)

echo Both windows started. Close them to stop the servers.
echo.
pause
