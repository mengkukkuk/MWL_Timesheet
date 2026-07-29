# AGENTS.md — MeterWorklog (MWL) Project Guide

This file orients Codex (and any new contributor) to the MWL codebase.
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
| Frontend     | React 19 + TypeScript SPA (Tailwind CDN) built with Vite, routed by react-router; Flask serves one shell (`app.html`) + JSON — see §6 |
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
├── init_db.sql             # Full schema (tables, indexes, defaults) — auto-applied by db.init_db()
├── init_db2.sql            # Alternate / older schema variant — NOT used by db.init_db(); kept for reference only
├── migrate_to_employee.py  # One-shot migration: members.id → EmployeeID
│
├── app/                    # Flask app package — blueprints
│   ├── __init__.py         # Flask factory, config, CSRF, blueprint reg, Vite manifest bridge (vite_asset())
│   ├── auth.py             # Login, logout, decorators (@login_required, @elevated_required, @admin_required)
│   ├── cache.py            # In-process TTLCache (cachetools) for /api/members, /api/projects, /api/employees
│   ├── constants.py        # Roles, ELEVATED_ROLES tuple
│   ├── core.py             # SPA catch-all route (spa()), /api/settings, misc plumbing
│   ├── members.py          # Legacy members table — GET only (POST/PUT/DELETE disabled; use /api/employees)
│   ├── employees.py        # dbo.Employee CRUD (HR directory — authoritative)
│   ├── projects.py         # Projects + per-employee role assignments
│   ├── skills.py           # Per-employee skill records
│   ├── worklogs.py         # Worklog CRUD + dashboard + projects-summary
│   ├── allowance.py        # Daily allowance entries per employee/project (dbo.Allowance)
│   ├── users.py            # User account admin (approve/role/reset)
│   ├── avatars.py          # Profile photo upload/serve
│   ├── files.py            # File-share tree, upload/download
│   ├── exports.py          # Excel export from openpyxl templates
│   └── helpers.py          # parse_time, parse_members, format_members
│
├── frontend/                # React + TypeScript SPA, compiled by Vite — see §6
│   ├── vite.config.ts       # TWO entries (app, login), dev proxy to Flask, manualChunks
│   ├── package.json         # react, react-dom, react-router, @tanstack/react-query
│   ├── index.html           # `app` entry HTML (-> src/main.tsx); login.html -> login island.
│   │                        #   dashboard/worklog/projectsSummary/files/settings.html are STALE
│   │                        #   pre-teardown entry files, no longer Vite inputs (safe to delete).
│   └── src/
│       ├── main.tsx              # `app` entry — mounts #root, RouterProvider, exposes window.mwlNavigate
│       ├── router.tsx            # createBrowserRouter: every tab path renders <AppShell/>
│       ├── queryClient.ts        # TanStack Query client
│       ├── lib.ts                # api<T>() fetch wrapper + shared payload types + i18n re-exports
│       ├── i18n/                 # dict.ts + index.ts — the single i18n source of truth (React)
│       ├── shell/                # AppShell.tsx + all chrome: Nav, Selector, ToastHost, WorklogModal,
│       │                         #   DraftPanel, DashboardTab, AllowanceTab/AllowanceModal, useShellState
│       ├── login/                # standalone login island (LoginApp.tsx, ClockTimerWidget.tsx, ...)
│       ├── dashboard/            # dashboard island (DashboardIsland, TeamOverviewIsland, ExportControls, ...)
│       ├── worklog/              # worklog table/calendar island (WorklogIsland, WorklogTable, ...)
│       ├── files/                # file-share island (FilesIsland: upload, folder tree, preview)
│       ├── projects-summary/     # elevated Projects Summary island (KPI cards + Chart.js)
│       └── settings/             # elevated Settings island (members/projects/users/approvals/presets)
│
├── static/
│   ├── style.css           # Custom CSS (extends Tailwind CDN)
│   ├── mwllogo.png
│   └── react/              # Vite build OUTPUT (git-ignored) — hashed js/css + .vite/manifest.json,
│                           #   read by app/__init__.py's vite_asset() Jinja global. Run `npm run build`
│                           #   in frontend/ to (re)generate.
│       # Note: the old vanilla SPA — static/app.js, static/app.js.bak and the
│       # static/app/ modules (i18n/core/worklogs/calendar/allowance/draft.js) —
│       # was fully removed in the React teardown. The whole UI is now the `app`
│       # React bundle (frontend/src/shell/AppShell.tsx). style.css is the only
│       # hand-written asset left under static/.
│
├── logintest/              # Ad-hoc SQL helpers (SYSTEM login setup) — NOT part of deploy pipeline
│   ├── setup_system_login.sql   # Idempotent SYSTEM login setup (preferred if needed)
│   ├── setup_login.sql          # Older duplicate of setup_system_login.sql
│   ├── checklogin.sql           # Verification query
│   └── worklog_deployaaaa.txt   # Stale chat-dump notes (candidate for deletion)
│
├── templates/
│   ├── app.html             # SPA shell — rendered by core.spa() for every non-API/static route.
│   │                         #   Bare: loads the `app` Vite bundle into <div id="root">; AppShell
│   │                         #   renders all nav/tabs/modals inside it (see §6).
│   ├── login.html            # Server-rendered login/register/reset page — deliberately NOT a
│   │                         #   react-router route (see §6). Loads the `login` Vite island.
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
- **`init_db2.sql` is NOT executed automatically** — it is an older /
  alternate schema variant kept in the repo for reference. Do not assume
  it has been applied. If you need DDL from it, run it manually with
  `sqlcmd -S <server> -d MeterWorklog -i init_db2.sql`.

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

Frontend mirror: `isElevated()` in [frontend/src/lib.ts](frontend/src/lib.ts).

### Sessions

`session['user_id']`, `session['username']`, `session['role']`,
`session['member_id']` (post-migration: this stores `EmployeeID`).

### Login throttling

Per-username sliding window: `MAX_LOGIN_ATTEMPTS=5` in `LOGIN_WINDOW=15m`,
locks for `LOGIN_LOCKOUT=5m`. Super_Ultimate_ADMIN has stricter limits
configurable via `SUPER_ADMIN_*` env vars; on lockout an unlock email is
sent (SMTP config required).

---

## 6. Frontend — React SPA (react-router + TanStack Query)

The vanilla→React migration (`purring-weaving-pillow.md`) is **complete**.
The entire UI is a single React tree; there is no vanilla JS, no
`static/app/*.js`, no `showTab`/`loadModuleOnce`/`LegacyRoute`/`legacyBridge`,
and no per-tab `view-*` DOM markup. Flask serves one bare shell
(`templates/app.html`) plus JSON APIs; React owns everything inside `#root`.

### Shell & routing

- [templates/app.html](templates/app.html) is the **only** template Flask
  renders for in-app navigation. [app/core.py](app/core.py)'s `spa()`
  catch-all route serves it for any path that isn't `/api/*`, `/static/*`,
  or an explicit route (e.g. `/login`) — see §5. It is a bare shell:
  Tailwind CDN, fonts, `style.css`, the `.ps-*` inline styles for the
  projects-summary island, `<div id="root"></div>`, and the `app` bundle.
- The `app` Vite bundle ([frontend/src/main.tsx](frontend/src/main.tsx))
  mounts into `#root`: `QueryClientProvider` + `RouterProvider` running
  [router.tsx](frontend/src/router.tsx)'s `createBrowserRouter`. **Every**
  tab path (`/dashboard`, `/worklog`, `/allowance`, `/files`,
  `/projects-summary`, `/settings`) renders the same
  [`<AppShell>`](frontend/src/shell/AppShell.tsx); `/` and unknown paths
  redirect to `localStorage.lastTab` (or `dashboard`).
- `AppShell` ([frontend/src/shell/AppShell.tsx](frontend/src/shell/AppShell.tsx))
  owns the whole UI: `<Nav>`, `<Selector>` (member/year/month), a
  `<main><Suspense>` that renders the active tab, plus `<ToastHost>`,
  `<WorklogModal>` and `<DraftPanel>`. Each tab body is a **`React.lazy`
  code-split chunk** of the `app` bundle (DashboardTab, WorklogIsland,
  AllowanceTab, FilesIsland, ProjectsSummaryIsland, SettingsIsland). The
  elevated-only tabs (`projects-summary`, `settings`) are gated by
  `ELEVATED_TABS` in AppShell + hidden in `<Nav>`.
- Nav buttons call `window.mwlNavigate('<tab>')` (defined in `main.tsx`),
  which pushes a real router navigation so URL/history/back-button work.
- Cross-tab context lives in the shared `<Selector>` controls
  (`#member-select`, `#year-select`, month selects) rendered by
  `useShellState`; islands read them via `getElementById().value` +
  `change` events, and `window.currentMemberId` mirrors the member. Window
  events (`mwl:dashboard`, `mwl:langchange`, `mwl:toast`) are the remaining
  cross-island bus.
- `/login` is a **separate, server-rendered page**
  ([templates/login.html](templates/login.html)), never a react-router
  route — the `login` Vite entry is a standalone React island, and
  `lib.ts`'s `api()` does a hard `window.location.href = '/login'` on 401.

### Vite bundles & assets

- Only **two** Vite entries in [frontend/vite.config.ts](frontend/vite.config.ts):
  `app` (`index.html` → the AppShell SPA) and `login` (`login.html`). Every
  tab is a lazy chunk of `app`, not a separate entry. `manualChunks` splits
  `react-vendor` (react, react-dom) and `query` (@tanstack/react-query) so
  their hashes stay stable across app deploys. Output goes to
  `static/react/` with a content hash + `.vite/manifest.json`.
- [app/__init__.py](app/__init__.py)'s `vite_asset(entry)` Jinja global
  reads that manifest and resolves an entry name to its hashed `<script>`/
  `<link>` URLs (fallback lookup by the manifest node's `name` field, since
  keys are source filenames like `index.html`). Templates call it as
  `{% set assets = vite_asset('app') %}` / `vite_asset('login')`.
- Islands under `frontend/src/`: `dashboard/` (monthly dashboard, Monthly
  Ledger, Excel export via ExportControls, TeamOverviewIsland for the
  elevated all-members view), `worklog/` (table + calendar, bulk edit),
  `files/` (upload with XHR progress, folder tree, drag-to-move, doc/image
  preview — `preview.ts` lazy-loads vendor libs), `projects-summary/`
  (elevated KPI cards + Chart.js bar/donut via the CDN `window.Chart`),
  `settings/` (elevated: Team Members, Projects, Account Approvals, User
  Accounts, Worklog Visibility [Super_Ultimate_ADMIN only], Time Presets).
- Dev server: `cd frontend && npm run dev` (Vite on :5173) proxies `/api/*`
  to Flask on :5123 and rewrites the `Origin` header (see the comment in
  `vite.config.ts`) so `verify_api_csrf_origin()` doesn't 403 non-GET
  requests made from the Vite dev origin. **Build for real verification**
  with `npm run build` — the Flask app at :5123 only ever serves the
  built `static/react/` output, not Vite's own dev-server root files.

### Shared conventions

- API calls: `api<T>()` in [frontend/src/lib.ts](frontend/src/lib.ts) — a
  typed fetch wrapper that auto-redirects to `/login` on 401. Prefer it
  over raw `fetch()` so error handling stays consistent.
- i18n: `t()` / `currentLang()` / `toggleLang()` / `useLang()` from
  [frontend/src/i18n/index.ts](frontend/src/i18n/index.ts) (backed by
  `dict.ts`), re-exported through `lib.ts`. `setLang()` dispatches a
  `mwl:langchange` window event for cross-island re-render. This is the
  single i18n source — the old `static/app/i18n.js` + `data-i18n` system
  is gone.

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

> **Important — manual steps the installer does NOT do:**
> 1. **It does not create `FILE_STORAGE_DIR` / `AVATAR_STORAGE_DIR`.**
>    Create them by hand before first upload, e.g.
>    `mkdir D:\MeterWorklog_Storage\files` and `mkdir D:\MeterWorklog_Storage\avatars`.
> 2. **It does not apply the ACL lockdown** from §10a — run those
>    `icacls` commands manually as Administrator.
> 3. **It does not run `init_db2.sql`** — only `init_db.sql` is auto-applied.
> 4. **The script ships with hardcoded defaults** for `SECRET_KEY`,
>    `NGROK_AUTHTOKEN`, `DB_SERVER`, `NGROK_DOMAIN` near the top of
>    [install-service.bat](install-service.bat). These are overridden by
>    `.env`, but the defaults are checked into source — **rotate any
>    leaked values and replace the script defaults with blanks** for prod.

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

This is the **complete** set of env vars consumed by
[app/__init__.py](app/__init__.py) and the install scripts. Anything not
listed here is not read by the app.

```
# ── Required (app will not start without these) ─────────────────────────
SECRET_KEY=<32-byte hex>             # fail-fast if missing
DB_SERVER=localhost\SQLEXPRESS
DB_NAME=MeterWorklog
DB_DRIVER={ODBC Driver 17 for SQL Server}
DB_TRUST_CERT=yes
DB_USER=                             # blank → Trusted_Connection (Windows Auth)
DB_PASSWORD=

# ── Public access ───────────────────────────────────────────────────────
NGROK_AUTHTOKEN=<your-token>
NGROK_DOMAIN=<your-subdomain>.ngrok-free.dev
TAILSCALE_DOMAIN=<machine>.<tailnet>.ts.net   # optional

# ── Server tuning ───────────────────────────────────────────────────────
APP_PORT=5050                        # used by install-service.bat + dev.bat
PORT=5050                            # legacy alias read by app.py — keep equal to APP_PORT
FLASK_DEBUG=                         # set "true" only for dev.bat; never in prod
SESSION_COOKIE_SECURE=               # blank → auto-on when NGROK_DOMAIN or TAILSCALE_DOMAIN set
WAITRESS_CHANNEL_TIMEOUT=3600
WAITRESS_MAX_REQUEST_BODY=5368709120 # bytes; MUST be ≥ FILE_UPLOAD_MAX_MB * 1024 * 1024

# ── File / avatar storage ───────────────────────────────────────────────
# Strongly recommended: separate drive from code (see §10a).
# NOTE: install-service.bat currently ships with `D:\MWLStorage\files` and
#       `D:\MWLStorage\avatar` (singular!) as built-in defaults. Override
#       in .env to the canonical paths below and align both ends.
FILE_STORAGE_DIR=D:\MeterWorklog_Storage\files
AVATAR_STORAGE_DIR=D:\MeterWorklog_Storage\avatars
FILE_UPLOAD_MAX_MB=5120              # Flask MAX_CONTENT_LENGTH
FILE_STORAGE_CAP_MB=20480            # total quota across all files
FILE_MIN_FREE_MB=8192                # stop uploads if free space < this

# ── Super_Ultimate_ADMIN login throttling ───────────────────────────────
SUPER_ADMIN_MAX_LOGIN_ATTEMPTS=3
SUPER_ADMIN_LOGIN_WINDOW_MINUTES=15
SUPER_ADMIN_LOCKOUT_MINUTES=30
SUPER_ADMIN_UNLOCK_TOKEN_MINUTES=30
SUPER_ADMIN_UNLOCK_EMAIL_COOLDOWN_SECONDS=300

# ── SMTP (required only if you want Super_Ultimate_ADMIN unlock emails) ─
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=...
SMTP_PASSWORD=...
MAIL_FROM=...
SUPER_ADMIN_UNLOCK_EMAIL=...         # destination for unlock-link emails
APP_BASE_URL=https://<your-subdomain>.ngrok-free.dev   # used to build unlock URLs
```

> Storage-path drift to watch for: `install-service.bat:37-38` ships
> `D:\MWLStorage\…` defaults (and `avatar` is singular), while §10a
> recommends `D:\MeterWorklog_Storage\…`. Pick one set and align the
> install script's defaults to match, otherwise an operator following
> §10a will lock down the wrong directory.

---

## 10a. Storage & Backup Strategy

### Why Separate Storage from Code

Storing user files (`FILE_STORAGE_DIR`, `AVATAR_STORAGE_DIR`) **outside the project root** is critical for:

- **Accidental deletion protection**: Project improvements, redeploys, or version upgrades won't risk losing user data
- **Independent backup cycles**: Back up `D:\MeterWorklog_Storage\` on a separate schedule from code repos (e.g., nightly vs. weekly)
- **Permission isolation**: Storage directory can be restricted to SYSTEM account only, preventing accidental web access
- **Disk management**: User data and code can grow independently; file quotas can be tuned separately

### Recommended Windows Deployment (MANUAL — not automated by the installer)

`install-service.bat` does **not** create the storage directories and
does **not** apply ACLs. After running it, perform these steps by hand
as Administrator:

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
- **Coerce `EmployeeID` to `int` at the request boundary.** The DB column
  is NVARCHAR and SQL Server papers over the int/str mismatch with
  implicit conversion, but mixing types in auth comparisons (`row['EmployeeID']
  != str(session['member_id'])`) is fragile. `create_worklog` already does
  this; mirror that pattern in every new endpoint.
- **Choose `@elevated_required` over `@admin_required`** for any setting
  that affects all employees (e.g. global toggles in `/api/settings/*`).
  Reserve `@admin_required` for Super_Ultimate_ADMIN-only operations
  (role changes, account approval).
- **Frontend module convention**: everything is React now. New UI is a
  component under `frontend/src/<tab>/` (or `frontend/src/shell/` for
  chrome shared across tabs). Heavy, tab-specific islands are code-split
  via `React.lazy` in [frontend/src/shell/AppShell.tsx](frontend/src/shell/AppShell.tsx);
  small shared pieces (Nav, Selector, ToastHost, WorklogModal, DraftPanel)
  import eagerly. There is no `<script defer>` / `loadModuleOnce()` /
  `STATIC_V` path anymore — those were removed in the teardown. Do **not**
  add a new Vite entry for a tab; the whole app ships in the single `app`
  bundle (the only other entry is the standalone `login` island).
- **Time math** for daily aggregates uses
  `((max(end) - min(start)) - lunch_overlap) / 60`
  with lunch = 12:00–13:00. See `get_dashboard()` and
  `get_projects_summary()` in [app/worklogs.py](app/worklogs.py).
- **Decorators stack in order**: `@blueprint.route(...)` →
  `@login_required` → `@elevated_required`/`@admin_required` →
  function definition.
- **Frontend naming convention**: hyphenated tab/path names
  (`projects-summary`, not `projectsSummary`) so the router path, the
  `TabName` union, and the `frontend/src/<tab>/` folder all line up.
- **Add a new tab** (all React now):
  1. Add the hyphenated name to `TAB_NAMES` in
     [frontend/src/router.tsx](frontend/src/router.tsx) so a matching
     `/<name>` route renders `<AppShell>` and deep-links/back-forward work.
  2. Add the same name to `TAB_NAMES` and the `TabName` union
     (`frontend/src/shell/Nav.tsx`), plus a nav button in `Nav.tsx` — its
     click calls `onNavigate('<name>')`, which pushes a real router
     navigation (preserving `?member=&y=`).
  3. Build the tab's island under `frontend/src/<name>/` and add a
     `React.lazy` import + a `case '<name>':` in `AppShell.tsx`'s content
     switch.
  4. If elevated-only, add the name to `ELEVATED_TABS` in `AppShell.tsx`
     (renders the placeholder for non-elevated users) and hide its nav
     button in `Nav.tsx`. If it's member-scoped, add it to `MEMBER_SCOPED`
     so it shows the "select a member" placeholder until one is chosen.
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
  Note: `app.py` currently reads `PORT` (not `APP_PORT`); keep both equal
  in `.env` until that is unified.
- File upload fails with no Flask log entry → either `FILE_STORAGE_DIR`
  does not exist, or `WAITRESS_MAX_REQUEST_BODY` is smaller than
  `FILE_UPLOAD_MAX_MB * 1024 * 1024` (Waitress rejects before Flask sees
  the request).
- Bootstrapping the first admin: register normally, then in SSMS run
  `UPDATE users SET role='Super_Ultimate_ADMIN' WHERE username='...';`

---

## 13. Known drift / TODOs (as of 2026-05-18 code review)

These are real issues caught by the project-wide code review. Docs were
updated to flag them; code fixes are still pending and intentionally
out-of-scope for that review.

| # | Where | Issue | Severity |
|---|-------|-------|----------|
| 1 | [install-service.bat](install-service.bat):19-26 | `SECRET_KEY`, `NGROK_AUTHTOKEN`, `DB_SERVER`, `NGROK_DOMAIN` hardcoded as `SET` defaults; will leak into NSSM env if `.env` is missing any key. Rotate the exposed ngrok token + `SECRET_KEY` and blank the defaults. | Critical |
| 2 | [app/worklogs.py](app/worklogs.py) `update_worklog()` | `member_id` from JSON is **not** `int()`-coerced (unlike `create_worklog()`); auth comparison mixes str/int. | Critical |
| 3 | [app/core.py](app/core.py) `/api/settings/worklog-visibility` | Uses `@admin_required` (Super_Ultimate_ADMIN only); should be `@elevated_required` so Admin/Leader can toggle. | High |
| 4 | install-service.bat | Does not create `FILE_STORAGE_DIR` / `AVATAR_STORAGE_DIR`; first upload fails. Add `mkdir` calls. | High |
| 5 | install-service.bat defaults | Storage paths drift from §10a (`D:\MWLStorage\…` and `avatar` singular vs `D:\MeterWorklog_Storage\…` and `avatars`). Pick one and align. | High |
| 6 | db.init_db() / docs | `init_db2.sql` is **not** auto-applied. Either delete it or document that it requires manual `sqlcmd -i`. | High |
| 7 | [uninstall-service.bat](uninstall-service.bat) | Looks for nssm in `C:\Windows\System32\` while install-service.bat ships one at `ngrokv3\nssm.exe`; standardize the location. | Medium |
| 8 | [.env.example](.env.example) | Missing ~20 vars the app actually reads (all `SUPER_ADMIN_*`, all `SMTP_*`, `MAIL_FROM`, `APP_BASE_URL`, `PORT`, `FLASK_DEBUG`, `FILE_STORAGE_DIR`). | Medium |
| 9 | [app/auth.py](app/auth.py) `/api/employee-lookup` | Intentionally public; rate-limiting TODO never landed — employee enumeration possible. | Medium |
| 10 | [app/avatars.py](app/avatars.py) | Returns raw exception text to clients on error paths (e.g. line 151). Sanitize for prod. | Medium |
| 11 | ~~`static/app.js.bak`~~ | **Resolved** — deleted in the full-SPA teardown, along with `static/app.js` and the entire `static/app/` vanilla module directory. | — |
| 12 | `logintest/` | Undocumented, duplicates SETUP.txt content, `.gitignore` already excludes it → committed files are stale. Clean up. | Low |
| 13 | [requirements.txt](requirements.txt) | `cachetools>=5.3` lacks an upper bound. Pin `<6.0` for reproducibility. | Low |
| 14 | [.gitignore](.gitignore):228 | Malformed `. e n v` (spaced characters) — does nothing, just clutter. | Low |
| 15 | ~~Frontend `esc()` / `_psEsc()`~~ | **Resolved** — the vanilla `worklogs.js`/`projects-summary.js` were deleted in the teardown; React renders escape output by default, so the hand-rolled helpers are gone. | — |
