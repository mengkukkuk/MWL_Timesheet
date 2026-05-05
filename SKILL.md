---
name: mwl-deploy
description: Operational guide for the MeterWorklog (MWL) Flask app — installing/managing the Windows service via NSSM, configuring the ngrok reserved domain + Tailscale Serve, running the dev server, and bootstrapping the database. Activate when the user is deploying, restarting, troubleshooting, or configuring the MWL stack on Windows.
triggers:
  - install service
  - uninstall service
  - nssm
  - ngrok domain
  - tailscale serve
  - waitress
  - meterworklog deploy
  - dev.bat
  - bootstrap admin
---

# MeterWorklog Deployment Skill

Operational playbook for running this Flask + SQL Server app on a Windows host. For architectural / code-level guidance see [CLAUDE.md](CLAUDE.md).

## 1. What gets deployed

Two Windows services managed by **NSSM**:

| Service | Process | Purpose |
|---|---|---|
| `MeterWorklog`        | `.venv\Scripts\python.exe -m waitress ... app:app` | Waitress WSGI server on `0.0.0.0:5050` |
| `MeterWorklog-ngrok`  | `ngrokv3\ngrok.exe http 5050 --url=<reserved> --authtoken=...` | Public HTTPS tunnel (depends on the app service) |

Plus an **idempotent Tailscale Serve** mapping (`https://443 → http://localhost:5050`) when Tailscale is installed — this gives an authenticated `*.ts.net` URL on the same port.

Logs land in `<app>\logs\` (rotated at 5 MB):
- `app.log` / `app-error.log`
- `ngrok.log` / `ngrok-error.log`

## 2. Prerequisites (one-time per host)

1. **Python 3.11+** with `py -m venv .venv` then `.venv\Scripts\pip install -r requirements.txt`.
2. **Microsoft ODBC Driver 17 for SQL Server** — must match `DB_DRIVER` in `.env`.
3. **NSSM** at `C:\Windows\System32\nssm.exe` (download from https://nssm.cc/download).
4. **ngrok v3** unpacked to `<app>\ngrokv3\ngrok.exe`. Sign in at ngrok.com and reserve a domain.
5. **Tailscale** (optional) — install from https://tailscale.com/download/windows and `tailscale up`. HTTPS must be enabled in the tailnet admin panel before `tailscale serve` will work.
6. **`.env`** at repo root with at minimum:
   ```env
   SECRET_KEY=<random-long-string>
   DB_SERVER=localhost\SQLEXPRESS
   DB_NAME=MeterWorklog
   DB_DRIVER={ODBC Driver 17 for SQL Server}
   DB_TRUST_CERT=yes
   NGROK_AUTHTOKEN=<from ngrok dashboard>
   NGROK_DOMAIN=<your-reserved>.ngrok-free.app
   TAILSCALE_DOMAIN=<host>.<tailnet>.ts.net   # informational only
   APP_PORT=5050
   # Optional uploads tuning:
   WAITRESS_CHANNEL_TIMEOUT=3600
   WAITRESS_MAX_REQUEST_BODY=5368709120
   FILE_UPLOAD_MAX_MB=5120
   ```
   `install-service.bat` reads these via `findstr` — keep `KEY=value` with no surrounding spaces or quotes.

## 3. Database bootstrap

Schema lives in `init_db.sql`; `db.init_db()` runs it batch-by-batch (split on `\nGO\n`). Trigger it once after the DB is created — typical sequence:

```cmd
sqlcmd -S localhost\SQLEXPRESS -E -Q "CREATE DATABASE MeterWorklog"
.venv\Scripts\python.exe -c "from db import init_db; init_db()"
```

The first user to register through `/register` is auto-promoted to `Super_Ultimate_ADMIN` if no admins exist (see `app/auth.py`). After that, role changes go through Settings → Users.

If `init_db.sql` has migration batches that already ran, expect `[init_db] SQL batch #N FAILED` warnings — these are non-fatal idempotency complaints and the script continues.

## 4. Install the services

From an **elevated** cmd prompt in the repo root:

```cmd
install-service.bat
```

What it does (verbatim from the script):
1. Auto-detects `APP_DIR` from the `.bat` location.
2. Loads overrides from `.env` (`SECRET_KEY`, `DB_*`, `NGROK_*`, `TAILSCALE_DOMAIN`, Waitress tuning).
3. Creates `<app>\logs\`.
4. `nssm install MeterWorklog` → Waitress with `--channel-timeout` and `--max-request-body-size` from env, app entrypoint `app:app`.
5. Sets `AppEnvironmentExtra` so the service has DB + secret + ngrok env vars (note: it does **not** propagate every variable from `.env` — only the ones explicitly listed; if you add a new env var the app needs at runtime, edit the script).
6. `nssm install MeterWorklog-ngrok` with `DependOnService MeterWorklog`.
7. Starts both services.
8. Runs `tailscale serve --bg --https=443 http://localhost:5050` — survives reboots, safe to re-run.

End-of-script summary prints local / public / tailnet URLs.

## 5. Run in dev mode (no service)

```cmd
dev.bat
```

Spawns two console windows: Flask debug server (`app.py`, default port from `APP_PORT` in `.env`, falls back to 5000) and ngrok if `NGROK_AUTHTOKEN` is set. Closing the windows stops both. Useful for iterating on code without touching the production services.

## 6. Day-to-day operations

```cmd
nssm status   MeterWorklog
nssm restart  MeterWorklog
nssm stop     MeterWorklog-ngrok
nssm start    MeterWorklog-ngrok
nssm edit     MeterWorklog            REM GUI editor for service config
```

Tail logs:
```cmd
powershell Get-Content -Wait -Tail 50 logs\app.log
powershell Get-Content -Wait -Tail 50 logs\app-error.log
powershell Get-Content -Wait -Tail 50 logs\ngrok.log
```

Tailscale Serve inspection:
```cmd
"C:\Program Files\Tailscale\tailscale.exe" serve status
"C:\Program Files\Tailscale\tailscale.exe" serve reset
```

## 7. Updating config / code

- **Code change** → restart only the app: `nssm restart MeterWorklog` (ngrok keeps its tunnel).
- **`.env` change** → re-run `install-service.bat` (it re-applies `AppEnvironmentExtra`) **or** edit via `nssm edit MeterWorklog` → *Environment* tab, then restart.
- **New ngrok domain** → update `NGROK_DOMAIN` in `.env`, then re-run installer (this rewrites `AppParameters` for the ngrok service).
- **Bigger uploads** → bump both `FILE_UPLOAD_MAX_MB` (Flask's `MAX_CONTENT_LENGTH`) **and** `WAITRESS_MAX_REQUEST_BODY` (Waitress rejects requests before Flask sees them — the Waitress limit must be ≥ the Flask one).

## 8. Uninstall

```cmd
uninstall-service.bat
```

Stops + removes both NSSM services and runs `tailscale serve reset`. The `.venv`, `logs\`, `.env`, and ngrok binary are left in place so you can re-install without re-downloading anything.

## 9. Troubleshooting

| Symptom | Most likely cause | Fix |
|---|---|---|
| `ERROR: Run as Administrator!` from installer | Non-elevated shell | Right-click cmd → *Run as administrator* |
| `nssm.exe not found at C:\Windows\System32\nssm.exe` | NSSM not installed | Copy `nssm.exe` (64-bit) into `C:\Windows\System32\` |
| App service starts then immediately stops | Bad `.env` (DB unreachable, SECRET_KEY missing) | Check `logs\app-error.log`; fix env; `nssm restart MeterWorklog` |
| `pyodbc.InterfaceError ... IM002` | ODBC driver name mismatch | Verify driver string with `odbcad32.exe` → *Drivers* tab; align `DB_DRIVER` in `.env` |
| `pyodbc.Error: ... Login failed` | Service running under wrong user (LocalSystem) and SQL only allows Windows auth from a specific account | Either switch SQL to mixed mode and set `DB_USER`/`DB_PASSWORD`, or set the service's *Log On* user via `nssm edit` |
| `[init_db] SQL batch #N FAILED` | Batch already applied | Usually safe — only a problem if the failure is on a brand-new batch the app actually needs |
| ngrok service running but URL unreachable | Authtoken wrong, domain not reserved on this account, or free-tier domain expired | `nssm edit MeterWorklog-ngrok` → check `AppParameters`; verify domain in ngrok dashboard |
| `tailscale serve` non-zero exit | Not logged in, HTTPS feature disabled, port 443 in use | `tailscale status`, enable HTTPS in admin panel, free port 443 |
| 413 / connection reset on big uploads | `WAITRESS_MAX_REQUEST_BODY` too low | Raise both Waitress and Flask limits, restart app service |
| Browser sees `403 CSRF` on POST | Origin not in allow-list | App enforces origin-based CSRF (see `app/__init__.py`); add the new domain there |

## 10. Bootstrapping the first admin (if registration is locked)

If you need a Super_Ultimate_ADMIN but the auto-promote condition is no longer met (an admin already exists), insert directly:

```sql
-- Replace <id> with the row from dbo.users you want to elevate
UPDATE dbo.users SET role = 'Super_Ultimate_ADMIN' WHERE id = <id>;
```

Then have that user log out / in to refresh their session role.

## 11. File map (deployment artifacts only)

| File | Role |
|---|---|
| [install-service.bat](install-service.bat) | Installs both NSSM services + Tailscale Serve |
| [uninstall-service.bat](uninstall-service.bat) | Removes both services + resets Tailscale Serve |
| [dev.bat](dev.bat) | Launches Flask debug + ngrok in two console windows |
| [.env](.env) | Runtime config, read by both `install-service.bat` and the app at startup |
| [db.py](db.py) | Connection (`get_connection`) + migration runner (`init_db`) |
| [init_db.sql](init_db.sql) | Schema, executed batch-by-batch on `\nGO\n` |
| [app/__init__.py](app/__init__.py) | Flask app factory, CSRF/origin check, blueprint registration |
| [logs/](logs) | Service stdout/stderr (auto-rotated at 5 MB) |
