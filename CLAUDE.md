# CLAUDE.md — MeterWorklog (MWL) Project Guide

This file orients Claude Code (and any new contributor) to the MWL codebase.
Read this before making changes.

---

## 1. What this project is

**MeterWorklog (MWL)** is an internal time-tracking / worklog web app for a
small company. It tracks per-employee daily work entries (start/end times,
project, task, status), aggregates monthly hours, manages projects/skills,
shares files between team members, and exports timesheets to Excel.

It is deployed as a **Windows service** on a single on-prem machine and
exposed externally via **ngrok** and/or **Tailscale Serve**.

---

## 2. Tech stack

| Layer        | Choice                                                   |
| ------------ | -------------------------------------------------------- |
| Web server   | Flask 3.1 (dev) + Waitress 3.0 (prod, via NSSM)          |
| Database     | Microsoft SQL Server (Express) via pyodbc + ODBC 17      |
| Frontend     | Vanilla JavaScript SPA + Tailwind CSS (CDN), no build    |
| Auth         | Server-side sessions (Flask `session`, signed cookie)    |
| Excel export | `openpyxl` against template workbooks in `templates/`    |
| Service host | NSSM (`nssm.exe`) — registers the Python + ngrok procs   |
| Public URL   | ngrok reserved domain (free tier) and/or Tailscale Serve |

Python deps live in [requirements.txt](requirements.txt). Install via
`.venv\Scripts\pip install -r requirements.txt`.

---

## 3. Repository layout

```
mwl deploy/
├── app.py                  # Entry point — runs `app:app` Flask instance
├── db.py                   # pyodbc wrapper, thread-local connection
├── init_db.sql             # Full schema (tables, indexes, defaults)
├── init_db2.sql            # Migration / additive DDL
├── migrate_to_employee.py  # One-shot migration: members.id → EmployeeID
│
├── app/                    # Flask app package — blueprints
│   ├── __init__.py         # Flask factory, config, CSRF, blueprint reg
│   ├── auth.py             # Login, logout, decorators (@login_required, @elevated_required, @admin_required)
│   ├── constants.py        # Roles, ELEVATED_ROLES tuple
│   ├── core.py             # /api/me, settings, misc plumbing
│   ├── members.py          # Legacy members table CRUD (kept for migration)
│   ├── employees.py        # dbo.Employee CRUD (HR directory — authoritative)
│   ├── projects.py         # Projects + per-employee role assignments
│   ├── skills.py           # Per-employee skill records
│   ├── worklogs.py         # Worklog CRUD + dashboard + projects-summary
│   ├── users.py            # User account admin (approve/role/reset)
│   ├── avatars.py          # Profile photo upload/serve
│   ├── files.py            # File-share tree, upload/download
│   ├── exports.py          # Excel export from openpyxl templates
│   └── helpers.py          # parse_time, parse_members, format_members
│
├── static/
│   ├── app.js              # Sequential script loader for /static/app/*.js
│   ├── style.css           # Custom CSS (extends Tailwind CDN)
│   ├── mwllogo.png
│   └── app/                # Frontend modules (loaded in this order)
│       ├── i18n.js         # TH / EN translation tables
│       ├── core.js         # Tab router (showTab), api(), session state
│       ├── dashboard.js    # Per-employee monthly dashboard
│       ├── projects-summary.js  # Projects Summary tab (elevated only)
│       ├── worklogs.js     # Worklog table CRUD UI
│       ├── calendar.js     # Calendar view of worklogs
│       ├── export.js       # Single + bulk Excel export
│       ├── settings.js     # Admin settings panel
│       ├── files.js        # File-share UI
│       └── draft.js        # Squad Draft side panel
│
├── templates/
│   ├── index.html          # Single-page app shell (all tabs + modals)
│   ├── login.html          # Login + register + password reset
│   ├── Monthly_Worklog_Template.xlsx       # openpyxl source for single export
│   └── Monthly_Worklog_Template_All.xlsx   # openpyxl source for bulk export
│
├── storage/                # User uploads (avatars/, files/) — NOT in git
├── logs/                   # NSSM stdout/stderr logs — NOT in git
├── ngrokv3/ngrok.exe       # Vendored ngrok binary
│
├── install-service.bat     # NSSM install + Tailscale serve config (run as Admin)
├── uninstall-service.bat   # NSSM removal (run as Admin)
├── dev.bat                 # Local dev launcher (Flask debug + ngrok)
└── SETUP.txt               # End-user setup walkthrough
```

---

## 4. Database

### Connection

Single point of contact: [db.py](db.py).

- `get_connection()` — caches one pyodbc connection per thread in
  `threading.local()`, validates with a no-op `cursor()` call, reconnects
  on failure.
- `query(sql, params=(), fetchone=False)` — returns `dict` rows
  (`dict(zip(columns, row))`). **Always** use parameterized queries; never
  string-concat user input.
- `execute(sql, params=())` — INSERT/UPDATE/DELETE; if the SQL has an
  `OUTPUT INSERTED.id` clause, returns the new id.
- `init_db()` — runs `init_db.sql` split on `\nGO\n`. Safe to call
  repeatedly (the SQL guards each `CREATE TABLE` with `IF NOT EXISTS`).
  It is invoked once on the first request via the `before_request` hook.

### Connection settings (env vars)

| Var              | Default                          | Notes                  |
| ---------------- | -------------------------------- | ---------------------- |
| `DB_SERVER`      | `localhost`                      | e.g. `localhost\SQLEXPRESS` |
| `DB_NAME`        | `MeterWorklog`                   |                        |
| `DB_DRIVER`      | `{ODBC Driver 17 for SQL Server}`|                        |
| `DB_USER` / `DB_PASSWORD` | (empty → Trusted_Connection) | Leave blank for Windows Auth |
| `DB_TRUST_CERT`  | `yes`                            |                        |

### Key tables (see [init_db.sql](init_db.sql))

- `dbo.Employee` — authoritative HR directory. Surrogate `ID INT IDENTITY`
  + business key `EmployeeID NVARCHAR(10)`. `EmployeeName`, `Department`,
  `Position`, `Level`, `JG`, plus avatar columns.
- `worklogs` — one row per work entry. Key columns:
  - `EmployeeID INT` — **authoritative** post-migration (links to
    `dbo.Employee.EmployeeID`).
  - `member_id INT NULL` — **legacy**, kept for backward-compat only.
  - `log_date DATE`, `start_time TIME`, `end_time TIME`.
  - `hours DECIMAL(5,2) PERSISTED` — computed column: `(end - start) -
    lunch_overlap`, where lunch = 12:00–13:00.
  - `overtime_hours DECIMAL(5,2) PERSISTED` — computed: time before 08:30
    or after 17:30.
  - `status` ∈ {`Done`, `In Progress`, `Pending`, `Man day`}.
  - Index `IX_worklogs_employee_date` on `(EmployeeID, log_date)`.
- `projects` — `id`, `name UNIQUE`, `main_members` and `support_members`
  stored as **JSON arrays of EmployeeIDs** (NVARCHAR(MAX), e.g.
  `"[33546, 33547]"`).
- `users` — login accounts. Roles ∈ {`Staff`, `Leader`, `Admin`,
  `Super_Ultimate_ADMIN`}. `EmployeeID` links to `dbo.Employee`.
  `status` ∈ {`Pending`, `Active`, `Declined`} (self-registered accounts
  start as `Pending` and need admin approval).
- `members` — **legacy** table kept for migration only; new code uses
  `EmployeeID` directly.
- `settings`, `skills`, `files`, `folders`, etc.

### Migration note

`worklogs` and `users` keep both `member_id` (legacy FK to `members.id`)
and `EmployeeID` (new business key). **Always** write `EmployeeID`; leave
`member_id` `NULL`. See [migrate_to_employee.py](migrate_to_employee.py)
for the one-shot migration that backfilled existing rows.

---

## 5. Web framework wiring

### App factory — [app/__init__.py](app/__init__.py)

- `app = Flask(...)` is created at module import; `template_folder` and
  `static_folder` are pinned to absolute paths so it works under NSSM.
- `SECRET_KEY` is **required** — fail-fast `RuntimeError` if missing.
- `SESSION_COOKIE_SECURE` auto-enables when `NGROK_DOMAIN` or
  `TAILSCALE_DOMAIN` is set (HTTPS deployment); explicit env override
  available.
- `MAX_CONTENT_LENGTH` — file-share upload cap, default 5 GB. Waitress's
  own `--max-request-body-size` must match (set in `install-service.bat`).
- `@app.before_request ensure_db()` — lazy init: runs `db.init_db()` and
  loads the `worklog_open` setting on the first request.
- `@app.before_request verify_api_csrf_origin()` — for any non-GET
  `/api/*` request, validates `Origin`/`Referer` against a trusted set
  (host_url, `X-Forwarded-Host`, `NGROK_DOMAIN`, `TAILSCALE_DOMAIN`).
  Rejects with 403 otherwise. **No CSRF tokens** — origin-based check is
  sufficient because all API calls are same-origin from the SPA.

### Blueprints

All routes live under blueprints in `app/`. Each is registered at the
bottom of `app/__init__.py`. URL prefixes are encoded in each route
(e.g. `@worklogs_bp.route('/api/worklogs')`), not via blueprint
`url_prefix`.

### Auth decorators ([app/auth.py](app/auth.py))

- `@login_required` — checks `'user_id' in session` → 401 if missing.
- `@elevated_required` — `session['role'] in ELEVATED_ROLES` (Admin,
  Leader, Super_Ultimate_ADMIN). Used for cross-employee data access,
  Settings tab, project mutations.
- `@admin_required` — Super_Ultimate_ADMIN only.

Frontend mirror: `isElevated()` in [static/app/core.js](static/app/core.js).

### Sessions

`session['user_id']`, `session['username']`, `session['role']`,
`session['member_id']` (post-migration: this stores `EmployeeID`).

### Login throttling

Per-username sliding window: `MAX_LOGIN_ATTEMPTS=5` in `LOGIN_WINDOW=15m`,
locks for `LOGIN_LOCKOUT=5m`. Super_Ultimate_ADMIN has stricter limits
configurable via `SUPER_ADMIN_*` env vars; on lockout an unlock email is
sent (SMTP config required).

---

## 6. Frontend (SPA, no build step)

- Single page: [templates/index.html](templates/index.html) — contains
  every tab's HTML (`view-dashboard`, `view-worklog`, `view-files`,
  `view-projects-summary`, `view-settings`) plus all modals.
- Loaded by [static/app.js](static/app.js), which sequentially injects
  the `<script>` tags for `static/app/*.js` (dependency order matters:
  `i18n` → `core` → feature modules). Fires a `modulesLoaded` event when
  the last script finishes.
- Tab switching: `showTab(name)` in [static/app/core.js](static/app/core.js).
  Permission-gated tabs (`settings`, `projects-summary`) early-return
  unless `isElevated()`. Last selected tab persisted in `localStorage`.
- API calls: `api(url, opts)` in [core.js](static/app/core.js). Auto-redirects
  to `/login` on 401, toasts on 403/5xx, returns parsed JSON.
- i18n: `t(key)` in [static/app/i18n.js](static/app/i18n.js); `data-i18n`
  attributes on HTML elements get translated on language toggle (TH ↔ EN).

---

## 7. Excel export

[app/exports.py](app/exports.py) loads the template `.xlsx` files in
`templates/`, fills in cells via `openpyxl`, and streams the result as a
download. Two flavours: single employee
(`Monthly_Worklog_Template.xlsx`) and multi-employee
(`Monthly_Worklog_Template_All.xlsx`).

---

## 8. Windows service installation

### Install — [install-service.bat](install-service.bat) (Run as Admin)

Registers two services via NSSM:

1. **`MeterWorklog`** — runs Waitress with the Flask app:
   ```
   python -m waitress --host=0.0.0.0 --port=5050 \
     --channel-timeout=3600 --max-request-body-size=5368709120 app:app
   ```
   Env vars are passed to NSSM via `AppEnvironmentExtra` (DB, SECRET_KEY,
   NGROK_DOMAIN, TAILSCALE_DOMAIN). Logs rotate at 5 MB into `logs\app.log`
   and `logs\app-error.log`.

2. **`MeterWorklog-ngrok`** — runs `ngrokv3\ngrok.exe http %APP_PORT%
   --url=%NGROK_DOMAIN% --authtoken=%NGROK_AUTHTOKEN%`. Depends on the
   app service (`DependOnService`).

Optional: if `C:\Program Files\Tailscale\tailscale.exe` exists, also runs
`tailscale serve --bg --https=443 http://localhost:%APP_PORT%` to expose
the app over the tailnet on HTTPS.

### Uninstall — [uninstall-service.bat](uninstall-service.bat) (Run as Admin)

Stops + removes both NSSM services and runs `tailscale serve reset`.

### Local dev — [dev.bat](dev.bat)

Starts Flask (`FLASK_DEBUG=true`, port 5000) and ngrok in two new cmd
windows. Reads `APP_PORT`, `NGROK_AUTHTOKEN`, `NGROK_DOMAIN` from `.env`.

### Required external tools

- **NSSM** (`nssm.exe`) — copy to `C:\Windows\System32\` once.
- **ngrok v3** — vendored at `ngrokv3\ngrok.exe`.
- **Tailscale** (optional) — installed system-wide.
- **ODBC Driver 17 for SQL Server** — installed system-wide.

---

## 9. Public URL / ngrok domain

- Set `NGROK_AUTHTOKEN` and `NGROK_DOMAIN` (e.g. `mycorp.ngrok-free.dev`)
  in `.env`. The reserved domain on free tier means the URL is stable
  across restarts.
- The app's CSRF origin check trusts `https://$NGROK_DOMAIN/` explicitly
  — see [app/__init__.py:151-160](app/__init__.py).
- `SESSION_COOKIE_SECURE` flips to `True` automatically when
  `NGROK_DOMAIN` or `TAILSCALE_DOMAIN` is set, so the cookie isn't
  silently dropped by the browser over HTTPS.

---

## 10. Required environment variables

Minimal `.env` for production install:

```
SECRET_KEY=<32-byte hex>
DB_SERVER=localhost\SQLEXPRESS
DB_NAME=MeterWorklog
DB_DRIVER={ODBC Driver 17 for SQL Server}
DB_TRUST_CERT=yes

NGROK_AUTHTOKEN=<your-token>
NGROK_DOMAIN=<your-subdomain>.ngrok-free.dev
TAILSCALE_DOMAIN=<machine>.<tailnet>.ts.net   # optional

# Optional tuning
APP_PORT=5050
FILE_UPLOAD_MAX_MB=5120
WAITRESS_CHANNEL_TIMEOUT=3600
WAITRESS_MAX_REQUEST_BODY=5368709120

# Storage (RECOMMENDED: use separate drive for safety & independent backups)
FILE_STORAGE_DIR=D:\MeterWorklog_Storage\files        # General file-share uploads
AVATAR_STORAGE_DIR=D:\MeterWorklog_Storage\avatars    # Profile photos (separate for backup strategy)
FILE_STORAGE_CAP_MB=20480                             # Total quota across all files
FILE_MIN_FREE_MB=8192                                 # Stop uploads if free space drops below

# Optional SMTP (Super_Ultimate_ADMIN unlock emails)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=...
SMTP_PASSWORD=...
MAIL_FROM=...
SUPER_ADMIN_UNLOCK_EMAIL=...
APP_BASE_URL=https://<your-subdomain>.ngrok-free.dev
```

---

## 10a. Storage & Backup Strategy

### Why Separate Storage from Code

Storing user files (`FILE_STORAGE_DIR`, `AVATAR_STORAGE_DIR`) **outside the project root** is critical for:

- **Accidental deletion protection**: Project improvements, redeploys, or version upgrades won't risk losing user data
- **Independent backup cycles**: Back up `D:\MeterWorklog_Storage\` on a separate schedule from code repos (e.g., nightly vs. weekly)
- **Permission isolation**: Storage directory can be restricted to SYSTEM account only, preventing accidental web access
- **Disk management**: User data and code can grow independently; file quotas can be tuned separately

### Recommended Windows Deployment

After running `install-service.bat`, lock down storage permissions (run as Administrator):

```batch
REM Create the storage directory if it doesn't exist
if not exist "D:\MeterWorklog_Storage" mkdir "D:\MeterWorklog_Storage"

REM Reset ACLs and grant full access to SYSTEM only (the service account)
icacls "D:\MeterWorklog_Storage" /reset
icacls "D:\MeterWorklog_Storage" /grant:r "NT AUTHORITY\SYSTEM:(OI)(CI)F"
icacls "D:\MeterWorklog_Storage" /inheritance:r

REM Verify: only SYSTEM should have access
icacls "D:\MeterWorklog_Storage"
```

This ensures:
- Only the NSSM service (running as SYSTEM) can read/write files
- Administrators cannot accidentally browse user files
- Web server process cannot escape its restrictions to access storage

### Backup Strategy

Implement a separate backup pipeline for user data:

1. **Code repository**: Back up `.git/` and source weekly (or per commit)
2. **User data**: Back up `D:\MeterWorklog_Storage\` nightly to external/NAS
3. **Database**: Back up MeterWorklog SQL Server database separately from files
4. **Retention**: Keep 30+ days of file snapshots (user data is valuable; code can be rebuilt)

Example backup script (Windows Task Scheduler):
```batch
REM Run daily at 2 AM: Backup storage to external NAS
xcopy "D:\MeterWorklog_Storage\*" "\\nas.example.com\backups\meterworklog\files\" /E /I /Y
```

### Recovery Checklist

If you need to restore from backup:

1. Stop the service: `nssm stop MeterWorklog`
2. Restore files to `D:\MeterWorklog_Storage\`
3. Verify permissions with `icacls "D:\MeterWorklog_Storage"`
4. Restart the service: `nssm start MeterWorklog`
5. Check logs: `logs\app.log` and `logs\app-error.log`

---

## 11. Conventions for code changes

- **Always parameterize SQL.** Never string-format user input into a
  query — `db.query()` and `db.execute()` both accept a `params` tuple.
- **Use `EmployeeID`, not `member_id`,** for any new worklog/skill code.
  The legacy `member_id` column stays NULL.
- **Time math** for daily aggregates uses
  `((max(end) - min(start)) - lunch_overlap) / 60`
  with lunch = 12:00–13:00. See `get_dashboard()` and
  `get_projects_summary()` in [app/worklogs.py](app/worklogs.py).
- **Decorators stack in order**: `@blueprint.route(...)` →
  `@login_required` → `@elevated_required`/`@admin_required` →
  function definition.
- **Frontend module convention**: filename is hyphenated
  (`projects-summary.js`, not `projectsSummary.js`); the loader expects
  it in [static/app.js](static/app.js).
- **Add a new tab**:
  1. Nav button + view div in [templates/index.html](templates/index.html).
  2. New module in `static/app/<name>.js`, registered in
     [static/app.js](static/app.js).
  3. Add the name to `showTab()`'s tab list, the `allowedTabs` Set, and
     the `if (name === ...)` data-loading branch in
     [static/app/core.js](static/app/core.js).
  4. If admin-only, gate the nav button in `initializeApp()` and add a
     guard at the top of `showTab()`.
- **Add a new API route**: pick the right blueprint (or create one),
  decorate with `@login_required` (+ `@elevated_required` if
  cross-employee), use parameterized SQL, return `jsonify(...)`. Don't
  forget to register the new blueprint in `app/__init__.py` if creating
  one.

---

## 12. Operational tips

- Service logs: `logs\app.log`, `logs\app-error.log`, `logs\ngrok.log`
  (rotated at 5 MB).
- `nssm status MeterWorklog`, `nssm restart MeterWorklog`,
  `nssm stop MeterWorklog`.
- After editing `.env`: re-run `install-service.bat` (it writes env vars
  into the NSSM service config) **or** edit via `nssm edit MeterWorklog`.
- Port 5050 in use → set `APP_PORT` in `.env` and re-run install script.
- Bootstrapping the first admin: register normally, then in SSMS run
  `UPDATE users SET role='Super_Ultimate_ADMIN' WHERE username='...';`
