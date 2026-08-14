@echo off
REM ══════════════════════════════════════════════════════════════
REM  MeterWorklog — Dev Server (Worker edge + Flask origin)
REM  Starts Flask (debug mode) and `wrangler dev`, which serves the
REM  rendered static SPA from dist/ and proxies /api/* to Flask —
REM  the same topology as production. Browse the WRANGLER port.
REM ══════════════════════════════════════════════════════════════

SET APP_DIR=%~dp0
IF "%APP_DIR:~-1%"=="\" SET APP_DIR=%APP_DIR:~0,-1%

SET PYTHON_EXE=%APP_DIR%\.venv\Scripts\python.exe

SET APP_PORT=5050
SET WRANGLER_PORT=8787

IF EXIST "%APP_DIR%\.env" (
    FOR /f "usebackq tokens=1* delims==" %%A IN (`findstr /b APP_PORT "%APP_DIR%\.env" 2^>nul`) DO IF /I "%%A"=="APP_PORT" SET APP_PORT=%%B
)

IF NOT EXIST "%PYTHON_EXE%" (
    echo ERROR: .venv not found. Run:  python -m venv .venv  ^&  .venv\Scripts\pip install -r requirements.txt
    pause & exit /b 1
)

REM dist\ is a gitignored build artifact and wrangler dev serves it directly,
REM so it must exist before the Worker starts or every page 404s.
IF NOT EXIST "%APP_DIR%\dist\index.html" (
    echo dist\ not built yet — running: npm run build
    call npm run build
    IF ERRORLEVEL 1 (
        echo ERROR: npm run build failed. Run `npm install` first if this is a fresh clone.
        pause & exit /b 1
    )
)

echo ================================================
echo   MeterWorklog Dev Server
echo   Browse : http://localhost:%WRANGLER_PORT%   ^<-- use this
echo   Flask  : http://localhost:%APP_PORT%   (origin only)
echo.
echo   Re-run `npm run build` after editing
echo   templates\ or static\ to refresh dist\.
echo ================================================
echo.

REM Flask still serves its own HTML routes on APP_PORT if you want to bypass
REM the Worker, but the Worker is what production looks like.
START "MeterWorklog Flask" cmd /k "cd /d "%APP_DIR%" && set FLASK_DEBUG=true && set PORT=%APP_PORT% && "%PYTHON_EXE%" app.py"

REM --var overrides wrangler.jsonc's ORIGIN_URL so .env's APP_PORT stays the
REM single source of truth for the Flask port.
timeout /t 2 >nul
START "MeterWorklog Worker" cmd /k "cd /d "%APP_DIR%" && npx wrangler dev --port %WRANGLER_PORT% --var ORIGIN_URL:http://localhost:%APP_PORT%"

echo Both windows started. Close them to stop the servers.
echo.
pause
