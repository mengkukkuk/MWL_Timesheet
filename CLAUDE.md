# CLAUDE.md — MeterWorklog (MWL) Project Guide

This file orients Claude Code (and any new contributor) to the MWL codebase.
Read this before making changes.

---

## 1. What this project is

**MeterWorklog (MWL)** is an internal time-tracking / worklog web app for a
small company. It tracks per-employee daily work entries (start/end times,
project, task, status), aggregates monthly hours, manages projects/skills,
shares files between team members, and exports timesheets to Excel.

The Flask app + MSSQL run as a **Windows service** on a single on-prem
machine. Public traffic no longer hits it directly: a **Cloudflare Worker**
serves the SPA as static assets from the edge and proxies `/api/*` back to
Flask through the existing **Cloudflare Tunnel** (see §9a). **Tailscale
Serve** remains as an internal/tailnet path. (Previously ngrok — retired due
to free-tier limits; ngrok wiring is kept dormant as a rollback path, see
§8 and §13.)

> **Workers do not run the Python backend, and cannot.** Hyperdrive supports
> PostgreSQL/MySQL only; Python Workers are Pyodide/WASM (no working
> `threading`, no pyodbc C extension); Workers VPC `connect()` is plaintext
> TCP while TDS login requires TLS. The Worker is an **edge/proxy layer
> only** — `db.py`, pyodbc, and MSSQL are untouched. Rationale in §9a.

---

## 2. Tech stack

| Layer        | Choice                                                   |
| ------------ | -------------------------------------------------------- |
| Web server   | Flask 3.1 (dev) + Waitress 3.0 (prod, via NSSM)          |
| Database     | Microsoft SQL Server (Express) via pyodbc + ODBC 17      |
| Frontend     | Vanilla JavaScript SPA + Tailwind CSS (local purge build)|
| Auth         | Server-side sessions (Flask `session`, signed cookie)    |
| Excel export | `openpyxl` against template workbooks in `templates/`    |
| Service host | NSSM (`nssm.exe`) — registers the Python + cloudflared procs |
| Edge         | Cloudflare Worker via Wrangler — static assets + `/api/*` proxy (§9a) |
| Public URL   | The Worker's hostname; Cloudflare Tunnel is now Worker→Flask only |

Python deps live in [requirements.txt](requirements.txt). Install via
`.venv\Scripts\pip install -r requirements.txt`.

**The frontend has a build step now** (it did not before — see §13 #17).
`npm run build` does two things:

1. `build:css` — Tailwind CLI purge build → `static/tailwind.css` (§6a).
2. `build:static` — [scripts/render-static.mjs](scripts/render-static.mjs)
   renders `templates/*.html` → `dist/` with `static_v()` replaced by
   build-time content hashes, and copies `static/` → `dist/static/` (§6b).

`dist/` is what the Worker serves. Node.js/npm remain **build-time-only** —
nothing Node-based runs at request time on the origin. See §6a/§6b, and
**§12a for what to do after `git pull`.**

---

## 3. Repository layout

```
mwl deploy/
├── app.py                  # Entry point — runs `app:app` Flask instance
├── db.py                   # pyodbc wrapper, thread-local connection
├── init_db.sql             # Full schema (tables, indexes, defaults) — auto-applied by db.init_db()
├── init_db2.sql            # Alternate / older schema variant — NOT used by db.init_db(); kept for reference only
├── migrate_to_employee.py  # One-shot migration: members.id → EmployeeID
├── package.json            # npm devDeps (tailwindcss@2.2.19, wrangler) — build-time only, nothing Node-based runs at request time
├── package-lock.json
├── tailwind.config.js      # purge content = templates/*.html + static/app.js + static/app/*.js
│
├── wrangler.jsonc          # Cloudflare Worker config — assets binding, ORIGIN_URL (dev), vpc_services (prod). See §9a
├── worker/
│   └── index.ts            # The Worker: /api/* → Flask origin, everything else → static assets
├── scripts/
│   └── render-static.mjs   # templates/*.html + static/ → dist/, static_v() → sha256 content hash (§6b)
├── dist/                   # Build OUTPUT served by the Worker — gitignored, made by `npm run build`
│
├── app/                    # Flask app package — blueprints
│   ├── __init__.py         # Flask factory, config, CSRF, blueprint reg
│   ├── auth.py             # Login, logout, decorators (@login_required, @elevated_required, @admin_required)
│   ├── cache.py            # In-process TTLCache (cachetools) for /api/members, /api/projects, /api/employees
│   ├── constants.py        # Roles, ELEVATED_ROLES tuple
│   ├── core.py             # /api/me, settings, misc plumbing
│   ├── members.py          # Legacy members table — GET only (POST/PUT/DELETE disabled; use /api/employees)
│   ├── employees.py        # dbo.Employee CRUD (HR directory — authoritative)
│   ├── projects.py         # Projects + per-employee role assignments
│   ├── skills.py           # Per-employee skill records
│   ├── worklogs.py         # Worklog CRUD + dashboard + projects-summary
│   ├── users.py            # User account admin (approve/role/reset)
│   ├── avatars.py          # Profile photo upload/serve
│   ├── files.py            # File-share tree, upload/download, move (drag & drop + "Move to..." — see §7b)
│   ├── allowance.py        # Per-employee allowance records
│   ├── exports.py          # Excel export from openpyxl templates
│   ├── mail.py             # Brevo email sending (API + SMTP fallback) — password reset
│   └── helpers.py          # parse_time, parse_members, format_members, EMAIL_RE
│
├── static/
│   ├── app.js              # Bootstrap shim — fires `modulesLoaded` event after defer scripts run
│   ├── app.js.bak          # LEGACY pre-modularization monolith — should be deleted
│   ├── tailwind-src.css    # `@tailwind base/components/utilities` directives (source, committed)
│   ├── tailwind.css        # Purged Tailwind build OUTPUT — gitignored, generated by `npm run build:css` (§6a)
│   ├── style.css           # Custom CSS (extends the local Tailwind build)
│   ├── auth.css            # Login/reset page layout — loaded ONLY by login.html (no tailwind there)
│   ├── mwllogo.png
│   └── app/                # Frontend modules — eager via <script defer> + lazy via loadModuleOnce()
│       ├── i18n.js         # TH / EN translation tables                      [EAGER]
│       ├── core.js         # Tab router (showTab), api(), session, loader    [EAGER]
│       ├── dashboard.js    # Per-employee monthly dashboard                  [EAGER]
│       ├── worklogs.js     # Worklog table CRUD UI                           [EAGER]
│       ├── calendar.js     # Calendar view of worklogs                       [EAGER]
│       ├── export.js       # Single + bulk Excel export                      [EAGER]
│       ├── allowance.js    # Allowance UI                                    [EAGER]
│       ├── support.js      # ORPHANED — referenced only by templates/Login.dc.html, which nothing serves (§13 #18)
│       ├── settings.js     # Admin settings panel                            [LAZY]
│       ├── files.js        # File-share UI                                   [LAZY]
│       ├── projects-summary.js  # Projects Summary tab (elevated only)       [LAZY]
│       ├── file-preview.js # In-browser file preview                         [LAZY]
│       └── draft.js        # Squad Draft side panel                          [LAZY]
│
├── logintest/              # Ad-hoc SQL helpers (SYSTEM login setup) — NOT part of deploy pipeline
│   ├── setup_system_login.sql   # Idempotent SYSTEM login setup (preferred if needed)
│   ├── setup_login.sql          # Older duplicate of setup_system_login.sql
│   ├── checklogin.sql           # Verification query
│   └── worklog_deployaaaa.txt   # Stale chat-dump notes (candidate for deletion)
│
├── templates/
│   ├── index.html          # Single-page app shell (all tabs + modals)
│   ├── login.html          # Login + register + "Forgot password?" (sends reset email)
│   ├── reset_password.html # Standalone page opened from the emailed reset link
│   ├── Monthly_Worklog_Template.xlsx       # openpyxl source for single export
│   └── Monthly_Worklog_Template_All.xlsx   # openpyxl source for bulk export
│
├── storage/                # User uploads (avatars/, files/) — NOT in git
├── logs/                   # NSSM stdout/stderr logs — NOT in git
├── deployer/               # Vendored binaries: cloudflared.exe, ngrok.exe (dormant), nssm.exe
│
├── install-service.bat     # NSSM install + Cloudflare Tunnel + Tailscale serve config (run as Admin)
├── uninstall-service.bat   # NSSM removal (run as Admin)
├── dev.bat                 # Local dev launcher (Flask on APP_PORT + `wrangler dev` on 8787 — browse 8787)
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
  start as `Pending` and need admin approval). `email NVARCHAR(255) NULL` —
  optional, set at registration or by an elevated user via Settings → Users
  (`PUT /api/users/<id>/email`); used only as the password-reset destination.
- `user_security_state` — one row per user, `user_id` PK. Holds login-lockout
  state (`failed_login_count`, `locked_until`) and password-reset token state:
  `reset_token_hash` (sha256 of the token — the raw token is never stored),
  `reset_token_expires_at`, `last_reset_email_sent_at` (resend cooldown). See
  `_upsert_security_state()` in [app/auth.py](app/auth.py).
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
- `SESSION_COOKIE_SECURE` auto-enables when `CF_TUNNEL_DOMAIN`, `NGROK_DOMAIN`
  (dormant/deprecated), or `TAILSCALE_DOMAIN` is set (HTTPS deployment);
  explicit env override available.
- `MAX_CONTENT_LENGTH` — file-share upload cap, default 5 GB. Waitress's
  own `--max-request-body-size` must match (set in `install-service.bat`).
- `@app.before_request ensure_db()` — lazy init: runs `db.init_db()` and
  loads the `worklog_open` setting on the first request.
- `@app.before_request verify_api_csrf_origin()` — for any non-GET
  `/api/*` request, validates `Origin`/`Referer` against a trusted set
  (host_url, `X-Forwarded-Host`, `CF_TUNNEL_DOMAIN`, `NGROK_DOMAIN`
  [dormant/deprecated], `TAILSCALE_DOMAIN`). Rejects with 403 otherwise.
  **No CSRF tokens** — origin-based check is sufficient because all API
  calls are same-origin from the SPA.

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

## 6. Frontend (SPA)

> `templates/*.html` is the **single source of truth** for markup, but it is
> not what the browser fetches in the Worker topology — `npm run build`
> renders it to `dist/` first (§6b). Edit the template, never `dist/`.

- Single page: [templates/index.html](templates/index.html) — contains
  every tab's HTML (`view-dashboard`, `view-worklog`, `view-files`,
  `view-projects-summary`, `view-settings`) plus all modals.
- **Eager modules** are loaded by `<script defer>` tags directly in
  [templates/index.html](templates/index.html) (lines ~13–18) in strict
  dependency order: `i18n` → `core` → `dashboard` → `worklogs` →
  `calendar` → `export`. Cache-busted via `?v={{ static_v('app/<file>.js') }}`
  — **mtime**-based when Flask renders the template directly (local dev on
  `APP_PORT`), **sha256 content hash** when the build renders it to `dist/`
  (§6b).
- [static/app.js](static/app.js) is the **bootstrap shim** — after the
  deferred scripts run, it fires a `modulesLoaded` event that other
  modules await for cross-module globals.
- **Lazy modules** (`settings`, `files`, `projects-summary`, `draft`)
  are injected on demand by `loadModuleOnce(name)` in
  [static/app/core.js](static/app/core.js) (script tag with
  `?v=<STATIC_V[name]>` cache token, async=false to preserve init order).
- Tab switching: `showTab(name)` in [static/app/core.js](static/app/core.js).
  Permission-gated tabs (`settings`, `projects-summary`) early-return
  unless `isElevated()`. Last selected tab persisted in `localStorage`.
- API calls: `api(url, opts)` in [core.js](static/app/core.js). Auto-redirects
  to `/login` on 401, toasts on 403/5xx, returns parsed JSON. Prefer
  `api()` over raw `fetch()` so error handling stays consistent.
- i18n: `t(key)` in [static/app/i18n.js](static/app/i18n.js); `data-i18n`
  attributes on HTML elements get translated on language toggle (TH ↔ EN).

---

## 6a. Tailwind CSS build (local, no CDN)

Both `templates/index.html` and `templates/login.html` used to load Tailwind
from the jsdelivr CDN (~60KB/page, uncompressed, third-party dependency).
That's gone — Tailwind is now built locally and purged to a self-hosted
`static/tailwind.css` (~18KB minified).

**How it's wired:**
- `package.json` (repo root) — single devDependency, `tailwindcss@2.2.19`
  (pinned to match what the CDN link used to serve), with a `build:css` npm
  script.
- `tailwind.config.js` (repo root) — `purge.content` lists every file that
  can contain a Tailwind class name: `templates/*.html`, `static/app.js`,
  `static/app/*.js`. Tailwind's purge is a **dumb text scan**, not a JS
  parser — a class name only survives if it appears literally as a
  substring somewhere in one of those files (dynamically *concatenated*
  class strings, e.g. `` `text-${color}-500` ``, would NOT survive; the
  codebase doesn't currently do this — checked during the CDN removal).
- `static/tailwind-src.css` — the 3-line `@tailwind base/components/utilities`
  source file. Committed.
- `static/tailwind.css` — the build **output**. **Gitignored** — it does not
  come down with `git pull`. Must be (re)generated locally:
  ```cmd
  npm install
  npm run build:css
  ```
- Cache-busting works the same as every other static asset: templates
  reference it as `/static/tailwind.css?v={{ static_v('tailwind.css') }}`
  (mtime-based), so a rebuild is picked up by browsers automatically —
  **but only after the app service restarts** if the change also touched
  which classes are used (see §12a).
- Syne + DM Mono (Google Fonts used only by the Projects Summary tab) are
  no longer loaded on every page either — `static/app/projects-summary.js`
  injects that `<link>` once, lazily, the first time the tab opens. Kanit
  stays in the shared `<head>` since it's used everywhere.

> **Gotcha (bit us once):** do **not** set `variants: {}` in
> `tailwind.config.js`. An empty object is not "use the defaults" — it
> silently strips every `hover:`/`focus:`/responsive (`sm:`/`md:`/…)
> variant from the entire build, even though the base utility classes still
> compile fine and the build succeeds with no error. Omit the `variants`
> key entirely to keep Tailwind v2's built-in defaults. If you ever
> suspect a purge/variant regression, spot-check the built file directly
> rather than trusting file size alone, e.g.:
> ```cmd
> findstr /C:"hover\:bg-gray-100" static\tailwind.css
> ```

---

## 6b. Static render build — `templates/` → `dist/`

Cloudflare Workers static assets can only serve **files**, not Jinja templates,
so [scripts/render-static.mjs](scripts/render-static.mjs) renders the three
pages ahead of time into `dist/`. Node only, no new dependencies.

```cmd
npm run build          REM = build:css + build:static
npm run build:static   REM just the render step
```

**What it does:**

1. Refuses to run if `static/tailwind.css` is missing — that file is a
   gitignored artifact (§6a), and a `dist/` built without it 404s the
   stylesheet on every page.
2. Wipes and recreates `dist/`, then copies `static/` → `dist/static/`.
3. Renders each template and writes the result:

   | Source | Emitted as | Served at |
   |---|---|---|
   | `templates/index.html` | `dist/index.html` | `/` |
   | `templates/login.html` | `dist/login.html` | `/login` |
   | `templates/reset_password.html` | `dist/**reset-password**.html` | `/reset-password` |

   The underscore→hyphen rename is deliberate: Flask serves that page at
   `/reset-password` ([app/auth.py](app/auth.py)), and Workers'
   `html_handling` maps a request path to the same-named `.html` file.

**`static_v()` becomes a content hash.** It is the *only* dynamic expression
in any template — no `url_for`, no CSRF token, no session conditional, no
server-rendered user data. The build replaces every
`{{ static_v('app/core.js') }}` with the first 8 hex chars of the sha256 of
`static/app/core.js`. Flask uses **mtime** for the same token; the build uses
a **content hash** because mtime is not stable across git clones and would
spuriously bust every cache on a fresh checkout. The regex tolerates both
spacing variants already in the templates (`… ) }}` and `… )}}`).

> **Guard — read this before adding Jinja to a template.** After rendering,
> the build scans the output for any remaining `{{` or `{%` and **throws**,
> naming the file and line. Adding real Jinja (a loop, a conditional, injected
> user data) will therefore fail `npm run build` loudly instead of silently
> shipping a page with raw template syntax in it. If you genuinely need
> server-rendered data, that page cannot be a static asset — it has to move
> behind the `/api/*` proxy or be fetched as JSON by the SPA.

`dist/` is **gitignored**. It must be rebuilt on every machine and after every
change to `templates/` or `static/` — see §12a. `dev.bat` builds it
automatically if `dist/index.html` is missing, but does *not* rebuild a stale
one; re-run `npm run build` yourself after editing a template.

---

## 7. Excel export

[app/exports.py](app/exports.py) loads the template `.xlsx` files in
`templates/`, fills in cells via `openpyxl`, and streams the result as a
download. Two flavours: single employee
(`Monthly_Worklog_Template.xlsx`) and multi-employee
(`Monthly_Worklog_Template_All.xlsx`).

---

## 7a. Password reset (email link, via Brevo)

Replaces the old hidden username+StaffID reset form. Flow:

1. Login page → "Forgot password?" → user types their **username** →
   `POST /api/forgot-password`. This endpoint **always returns the same
   generic 200 response**, regardless of whether the account exists, has
   an email on file, is `Active`, is `Super_Ultimate_ADMIN` (excluded from
   self-service reset), or is within the resend cooldown — this is
   deliberate anti-enumeration, don't add branches that leak which case
   fired.
2. If eligible, a `secrets.token_urlsafe(32)` token is generated; only its
   sha256 hash + expiry are stored (`user_security_state.reset_token_hash` /
   `reset_token_expires_at`) — the raw token is never persisted or logged.
   An email is sent via [app/mail.py](app/mail.py) with a link to
   `{APP_BASE_URL}/reset-password?token=<token>`.
3. `GET /reset-password` ([templates/reset_password.html](templates/reset_password.html))
   is a standalone page (no Google Fonts, `<meta name="referrer" content="no-referrer">`,
   scrubs the token from the URL via `history.replaceState`) so the token
   never leaks via Referer. It calls `POST /api/reset-password/verify` to
   check validity, then `POST /api/reset-password/confirm` with the new
   password to complete the reset. The token is single-use — consumed
   (nulled) on success — and a successful reset also clears any login
   lockout for that username.
4. Emails are populated two ways: optional field on the registration form
   (`POST /api/register` body gains `email`), or an elevated user (Admin/
   Leader) editing it via Settings → Users → the email icon
   (`PUT /api/users/<id>/email`, [app/users.py](app/users.py)) — same
   Leader-cannot-touch-Admin / nobody-but-self-touches-Super-admin rules as
   `DELETE /api/users/<id>`.

Requires the Brevo env vars in §10. If neither `BREVO_API_KEY` nor
`SMTP_HOST` credentials are configured, `/api/forgot-password` still
returns its generic 200 but the send fails silently server-side (logged
via `app.logger.warning`, never surfaced to the client).

---

## 7b. File Share — drag & drop, multi-select, folder move

The Files tab ([app/files.py](app/files.py) + [static/app/files.js](static/app/files.js))
supports moving files/folders by drag-and-drop or via a "Move to…" picker
modal, on top of the original upload/download/rename/delete CRUD.

**Move endpoints:**
- `POST /api/files/<id>/move` — move a file. Body `{folder_id: int|null}`
  (`null` = root). `@login_required`; permission is uploader-or-elevated
  (`move_file()` checks `row['uploaded_by'] == session['user_id']` unless
  `session['role']` is elevated). Staff additionally can't move a file that
  is classified or sits under a classified folder
  (`_file_hidden_for_staff()` — the move 404s as if the file doesn't exist,
  same anti-enumeration shape as the rest of the classified-file handling).
- `POST /api/files/folder/<id>/move` — move a folder. Body
  `{parent_id: int|null}`. `@elevated_required` (folders are a structural
  change, unlike an individual file). Guards, in order: target folder must
  exist, a folder can't become its own parent, `_is_descendant(target, fid)`
  blocks moving a folder into its own subtree (cycle guard — argument order
  matters, swapping it silently returns `False` for every real cycle), a
  no-op if the target is already the current parent, and
  `_folder_name_conflict()` mirrors the DB's `(parent_id, name)` UNIQUE
  constraint (with the NULL-parent split, since SQL `parent_id = NULL`
  never matches) to reject a same-name collision at the destination.

**Frontend drag-and-drop** ([static/app/files.js](static/app/files.js)):
- Files and folders are `draggable="true"` only when `canMove`/`isElevated()`
  is true for that row — the UI never offers a drag handle for a move the
  API would reject.
- Grabbing an already-selected row drags the whole multi-selection;
  grabbing an unselected row drags just that row (standard file-manager
  behavior) — see `onFileDragStart()`. Folders drag **one at a time**
  (`onFolderDragStart()` — `_folderDragId` is a scalar, not a set).
  `_movableFileIds()` re-derives the permission filter at drag time because
  checkboxes render on every row while `draggable` doesn't, so a Staff
  multi-select can legitimately contain files that user can't move.
- Drop targets are any element carrying `data-folder-id` (sidebar tree
  nodes, the Root sentinel, subfolder cards); `_canDropOn()` / the shared
  `dragover` listener repaints highlighting and refuses the drop
  (`dataTransfer.dropEffect = 'none'`) for a folder-into-its-own-subtree
  drop before it ever reaches the server.
- **Internal move vs external upload are disambiguated by
  `_isExternalFileDrag()`**, which checks `ev.dataTransfer.types` for a
  native `Files` payload. Internal drags carry a `text/plain` payload
  instead (`"id,id,id"` for files, `"folder:<id>"` for a folder) — dropping
  those onto the panel background (not a folder target) is a no-op, while
  an external OS file drag anywhere in the panel opens the upload overlay
  and starts `uploadFiles()`. `_resetDragState()` is the single place that
  unwinds every drag artifact (highlight classes, the drag ghost element,
  the overlay, `fileDragDepth`) — extend it rather than adding a parallel
  cleanup path if you touch this code.
- The "Move to…" modal (`openMoveModal()` / `confirmMove()`) is the
  keyboard/click-accessible alternative to dragging — same two endpoints,
  same blocked-target set (`_moveBlocked`, mirroring the server's
  `_is_descendant` guard so a folder's own subtree is greyed out in the
  picker, not just rejected after the fact).

**Related read endpoints:** `GET /api/files/folder/<id>/stats` (and the
no-id `.../folder/stats` variant) return `{file_count, total_bytes,
subfolder_count}` for a subtree — used to show folder sizes without
loading every file; `GET /api/files/recent` lists the most recently
uploaded files across all folders (used by the Recent Uploads panel).

---

## 8. Windows service installation

### Install — [install-service.bat](install-service.bat) (Run as Admin)

Registers two services via NSSM:

1. **`MeterWorklog`** — runs Waitress with the Flask app:
   ```
   python -m waitress --host=0.0.0.0 --port=5050 \
     --channel-timeout=3600 --max-request-body-size=104857600 app:app
   ```
   Env vars are passed to NSSM via `AppEnvironmentExtra` (DB, SECRET_KEY,
   NGROK_DOMAIN [dormant], CF_TUNNEL_DOMAIN, WORKER_DOMAIN,
   TAILSCALE_DOMAIN). Logs rotate at 5 MB into `logs\app.log` and
   `logs\app-error.log`. `--max-request-body-size` is 100 MB to match
   `FILE_UPLOAD_MAX_MB` and Cloudflare's proxied-body cap (§9a).

2. **`MeterWorklog-cloudflared`** — runs `deployer\cloudflared.exe tunnel
   run --token %CF_TUNNEL_TOKEN%`. Depends on the app service
   (`DependOnService`). The tunnel is created once in the Cloudflare Zero
   Trust dashboard (Networks → Tunnels, token-based/remotely-managed) — the
   token is the only secret needed locally, no `credentials.json` to
   provision per machine. In the Worker topology this tunnel is the
   **Worker → Flask** path only; the public-hostname route is removed once
   the Worker is live (§9a).
   (**`MeterWorklog-ngrok`** is the deprecated predecessor — the script no
   longer installs/starts it, but if it's still registered from a prior
   install it's left alone as a same-second rollback: `nssm start
   MeterWorklog-ngrok`. See §13.)

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
> 4. **It does not download `deployer\cloudflared.exe`** — fetch the
>    Windows binary from Cloudflare's GitHub releases and place it there
>    manually, same as the existing vendored `ngrok.exe`/`nssm.exe`.
> 5. The script's hardcoded `SET` defaults for `SECRET_KEY`, `DB_SERVER`,
>    `CF_TUNNEL_TOKEN`, `CF_TUNNEL_DOMAIN` near the top of
>    [install-service.bat](install-service.bat) are blank by design —
>    real values come from `.env` (see the loader block right below the
>    defaults). Never fill these in as literal `SET` values in source.

### Uninstall — [uninstall-service.bat](uninstall-service.bat) (Run as Admin)

Stops + removes the app, cloudflared, and (dormant, if present) ngrok NSSM
services, and runs `tailscale serve reset`.

### Local dev — [dev.bat](dev.bat)

Opens two cmd windows that together mirror production:

1. **Flask origin** on `APP_PORT` (read from `.env`, default 5050) with
   `FLASK_DEBUG=true`.
2. **`wrangler dev`** on **8787**, serving `dist/` and proxying `/api/*` to
   Flask. It passes `--var ORIGIN_URL:http://localhost:%APP_PORT%`, which
   overrides `wrangler.jsonc`'s fallback so `.env`'s `APP_PORT` stays the
   single source of truth for the Flask port.

**Browse `http://localhost:8787`**, not the Flask port — 8787 is the
topology that ships. Flask's own HTML routes still work on `APP_PORT` if
you need to bypass the Worker.

`dist/` is a gitignored artifact, so the script runs `npm run build` for you
if `dist/index.html` is missing. It does **not** detect a *stale* `dist/` —
re-run `npm run build` yourself after editing `templates/` or `static/`.

### Required external tools

- **NSSM** (`nssm.exe`) — copy to `C:\Windows\System32\` once.
- **cloudflared** — vendored at `deployer\cloudflared.exe`.
- **ngrok v3** (dormant/deprecated) — vendored at `deployer\ngrok.exe`.
- **Tailscale** (optional) — installed system-wide.
- **ODBC Driver 17 for SQL Server** — installed system-wide.
- **Node.js / npm** — build-time only (Tailwind §6a, static render §6b,
  `wrangler` §9a). Nothing Node-based runs at request time on this box.

---

## 9. Public URL / Cloudflare Tunnel domain

> **Read §9a first.** In the Worker topology the browser talks to the
> *Worker's* hostname, and the tunnel carries Worker→Flask traffic only.
> This section is the tunnel setup that §9a builds on; a public-hostname
> route on the tunnel is needed to bootstrap and to roll back, but is
> removed once the Worker is live.

- Create the tunnel and a public-hostname route (→ `localhost:%APP_PORT%`)
  in the Cloudflare Zero Trust dashboard (Networks → Tunnels), then set
  `CF_TUNNEL_TOKEN` and `CF_TUNNEL_DOMAIN` (e.g. `mwl.yourdomain.com`) in
  `.env`. This requires a domain already on Cloudflare DNS — the tunnel
  route auto-creates the proxied CNAME, no manual DNS edit needed.
- The app's CSRF origin check trusts `https://$CF_TUNNEL_DOMAIN/` and
  `https://$WORKER_DOMAIN/` explicitly, plus whatever
  `X-Forwarded-Host`/`X-Forwarded-Proto` say — see
  [app/__init__.py](app/__init__.py), `verify_api_csrf_origin()`.
- `SESSION_COOKIE_SECURE` flips to `True` automatically when
  `CF_TUNNEL_DOMAIN`, `WORKER_DOMAIN`, `NGROK_DOMAIN` (dormant), or
  `TAILSCALE_DOMAIN` is set, so the cookie isn't silently dropped by the
  browser over HTTPS.
- ngrok (`NGROK_AUTHTOKEN`/`NGROK_DOMAIN`) is deprecated but kept dormant
  in both `install-service.bat` and `app/__init__.py` as a rollback path
  — see §13.

### Dashboard walkthrough: creating the tunnel + getting the token

One-time manual setup, done by a human in a browser (not automatable from
this repo). Uses the **token-based, remotely-managed** tunnel flow — no
`credentials.json` file to provision per machine, matching ngrok's old
single-secret simplicity.

1. Go to `https://one.dash.cloudflare.com/` (Zero Trust dashboard — may be
   labeled "Access" on older accounts). First visit may ask for a team
   name + plan; **Free** covers Tunnels, no payment needed.
2. **Networks → Tunnels → Create a tunnel.**
3. Connector type: **Cloudflared** (not "WARP Connector").
4. Name it, e.g. `meterworklog-prod`. **Save tunnel.**
5. The next screen shows an "Install and run a connector" command per OS,
   e.g. `cloudflared.exe service install <TOKEN>`. **Don't run that
   command** — `deployer\cloudflared.exe` is already vendored in this repo
   and NSSM runs it (`tunnel run --token ...`) instead of using
   cloudflared's own service installer, so it stays managed the same way
   as every other service (`nssm status`/`restart`/logs). Just **copy the
   token** (everything after `service install `). If you navigate away,
   the token is still retrievable from the tunnel's own settings.
6. Still in the wizard (or under the tunnel's **Public Hostname** tab if
   revisiting): **Add a public hostname.**
   - Subdomain: e.g. `mwl`.
   - Domain: pick from the dropdown — only domains already on Cloudflare
     DNS in this account will appear here.
   - Path: blank.
   - Service → Type: `HTTP`, URL: `localhost:5050` (match your actual
     `APP_PORT`/`PORT` if different from the default).
   - **Save hostname** (or **Save tunnel** to finish the wizard).
   Cloudflare auto-creates the proxied CNAME for the chosen hostname — no
   manual DNS step.
7. Paste the results into `.env`:
   ```
   CF_TUNNEL_TOKEN=<token from step 5>
   CF_TUNNEL_DOMAIN=mwl.yourdomain.com
   ```
8. Re-run `install-service.bat` as Administrator, then verify per the
   rollout checklist before stopping the dormant ngrok service (§8, §13).

---

## 9a. Cloudflare Worker edge (Wrangler)

The browser no longer talks to Flask. A Worker sits in front:

```
browser ──► Worker (mwl-timesheet)
              ├── /api/*  ──► VPC Service ──► cloudflared tunnel ──► Flask :5050 ──► MSSQL
              └── everything else ──► static assets from dist/  (§6b)
```

**Both** halves are served on **one hostname**, so the browser stays
same-origin: no CORS headers, no `credentials: 'include'`, no
`SameSite=None`, no CSRF tokens. `api()` in
[static/app/core.js](static/app/core.js) keeps using relative `/api/...`
paths, unchanged.

### Why the Python backend is NOT on Workers

The original ask was for Workers to host the backend too. It is not
buildable — verified against Cloudflare's docs, not assumed:

| Route | Blocker |
|---|---|
| Hyperdrive | Supports **PostgreSQL and MySQL only**. No SQL Server. |
| Python Workers | Pyodide/WASM. `threading` is explicitly non-functional ([db.py](db.py) uses `threading.local()`), and `pyodbc` is a C extension needing a native ODBC driver manager that does not exist for Workers. |
| Hand-rolled TDS over Workers VPC | VPC `connect()` is **plaintext TCP**; TDS login requires TLS. |

So `db.py`, pyodbc, MSSQL, and every blueprint's business logic are
**untouched**. The Worker is an edge/proxy layer only.

### Files

- [worker/index.ts](worker/index.ts) — the whole Worker, ~30 lines. Non-`/api/*`
  → `env.ASSETS`. `/api/*` → sets `X-Forwarded-Host`/`X-Forwarded-Proto`
  (derived from the incoming request, so `wrangler dev` over plain HTTP still
  produces a matching origin) and forwards to `env.ORIGIN` (production VPC
  binding), falling back to `env.ORIGIN_URL` (dev plain fetch), else 503.
- [wrangler.jsonc](wrangler.jsonc) — `assets.directory = ./dist/`,
  `run_worker_first: ["/api/*"]`, `env.production.vpc_services[0]`.
- [scripts/render-static.mjs](scripts/render-static.mjs) — builds `dist/` (§6b).

Two config subtleties, both deliberate:

- **`not_found_handling` is left at its default (404).** This SPA does
  client-side *tab* routing under `/`, not path routing, so
  `single-page-application` fallback would only mask real 404s.
- **`vars` is not inherited by named environments.** `--env production`
  therefore warns *"vars exists at the top level, but not on
  env.production"*. **Leave it that way** — it is what stops the dev-only
  `ORIGIN_URL` plain-fetch path from ever existing in production. Production
  must reach Flask through the VPC binding.

### Wiring the origin (one-time, manual)

Create a **Workers VPC Service** against the *existing* tunnel, so Flask
needs no public hostname at all:

```cmd
npx wrangler vpc service create mwl-flask-origin ^
  --type http --tunnel-id <MeterWorklog tunnel id> ^
  --ipv4 127.0.0.1 --http-port 5050
```

`--ipv4` rather than `--hostname`: cloudflared resolves this from the same
box Flask runs on, and `--hostname` additionally requires `--resolver-ips`.
Paste the returned id into `env.production.vpc_services[0].service_id` in
`wrangler.jsonc` (currently `019ffb7d-713f-71f1-b9a2-2c21e71def73`).
Creating it needs the **Connectivity Directory Admin** role; binding it
needs **Bind**.

> **`--tunnel-id` must be the tunnel `cloudflared` actually registered.**
> If the tunnel is ever recreated (new `CF_TUNNEL_TOKEN`), the VPC Service
> keeps pointing at the dead one and every `/api/*` call fails with
> `destination_unavailable` — while `nssm status` and the Zero Trust
> dashboard both look healthy, because the *tunnel* is fine, it's just not
> the one being addressed. Cross-check `npx wrangler vpc service get <id>`
> against `tunnelID=` in `logs\cloudflared-error.log`, and repoint with
> `npx wrangler vpc service update <id> …` (same flags as `create`, plus
> `--name`). This bit us once on the first production cutover.

> **Register an `http_port` only, and know what that implies.** A VPC
> Service picks the origin port from the **scheme** of the URL the Worker
> fetches — `https://` selects `https_port`, and with none registered the
> request dies as `port_not_open`. Waitress speaks plaintext on 5050, so
> `worker/index.ts` rewrites the URL to `http://`. That in turn makes Flask
> see `X-Forwarded-Proto: http`, which is why `WORKER_DOMAIN` is mandatory
> rather than optional — see *Deploy* below.

> Workers VPC is in **public beta** — free on all Workers plans, but the API
> may change. If it turns out to be unavailable on this account, the
> fallback is a plain `fetch()` to `CF_TUNNEL_DOMAIN` plus a shared-secret
> header that Flask requires. That is **strictly weaker** — it keeps the
> origin publicly routable.

### Deploy

```cmd
npm run build                              REM css + dist/
npx wrangler deploy --env production --dry-run
npx wrangler deploy --env production
```

Set `WORKER_DOMAIN` in `.env` to the hostname the browser will use
(`mwl-timesheet-production.<account>.workers.dev` while staging, or the custom
domain) and re-run `install-service.bat` so Flask trusts that origin.

> **`WORKER_DOMAIN` is required in production, not belt-and-braces.** Leave it
> blank and GETs work while every non-GET `/api/*` returns
> `403 CSRF validation failed` — a confusing half-working app. Two independent
> reasons, either one sufficient:
>
> 1. **Waitress strips the forwarded headers.** Waitress 3.x defaults to
>    `trusted_proxy=None` + `clear_untrusted_proxy_headers=True`, so it deletes
>    every `X-Forwarded-*` header before Flask is invoked. The Worker sets them
>    faithfully and Flask never sees them. That layer of
>    `verify_api_csrf_origin()` is therefore **inert in production** — it only
>    fires under the dev server and in tests. (Keep the Waitress default; it is
>    what stops a client forging `X-Forwarded-Host`.)
> 2. **Even unstripped, the scheme wouldn't match.** A VPC Service picks the
>    origin port *by URL scheme* and ours registers an `http_port` only, so
>    `worker/index.ts` must rewrite the URL to `http://` (otherwise
>    `port_not_open`) — making the forwarded proto `http` while the browser's
>    Origin is `https`. `_is_same_origin()` compares schemes strictly.
>
> `WORKER_DOMAIN` sidesteps both by trusting **both** schemes for that host
> explicitly. Same reasoning applies to `CF_TUNNEL_DOMAIN` and
> `TAILSCALE_DOMAIN`: behind Waitress the explicit `*_DOMAIN` vars are the
> *only* working trust layer besides `request.host_url`.
>
> Give it as a **bare hostname** — no scheme, no trailing slash.
> `_domain_env()` in [app/\_\_init\_\_.py](app/__init__.py) strips both now, but
> the bare form is what the rest of the tooling assumes
> (`install-service.bat` builds `APP_BASE_URL=https://%WORKER_DOMAIN%`).

**Only after end-to-end verification** on the real hostname: remove the
tunnel's public-hostname route, so Flask is reachable exclusively by the
Worker. That removal is both the security win and the rollback lever —
re-add the route to revert instantly. The NSSM services are untouched
throughout, so the pre-Worker deployment stays viable the whole time.

### Upload cap — 100 MB, and why

Requests reach Flask *through* Cloudflare, whose proxied request-body limit
is **100 MB on Free/Pro** (200 MB Business, 500 MB Enterprise). Anything
larger dies at the edge with a 413 that Flask never sees, so raising
`FILE_UPLOAD_MAX_MB` alone does nothing. The stack is aligned at 100 MB:

| Setting | Value |
|---|---|
| `FILE_UPLOAD_MAX_MB` | `100` |
| `WAITRESS_MAX_REQUEST_BODY` | `104857600` |
| Cloudflare proxied body (Free/Pro) | 100 MB |

`GET /api/files/stats` reports the effective cap as `max_upload_bytes`
([app/files.py](app/files.py) `_storage_snapshot()`), and
[static/app/files.js](static/app/files.js) filters oversized files client-side
with a named error before uploading — so users get a real message instead of
an opaque edge 413.

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
CF_TUNNEL_TOKEN=<connector-token>    # from Cloudflare Zero Trust dashboard (Tunnels)
CF_TUNNEL_DOMAIN=mwl.yourdomain.com  # public hostname routed to the tunnel
WORKER_DOMAIN=mwl-timesheet.<account>.workers.dev  # hostname the browser uses (§9a)
TAILSCALE_DOMAIN=<machine>.<tailnet>.ts.net   # optional
# ngrok (DEPRECATED — dormant rollback path only, see §13):
NGROK_AUTHTOKEN=<your-token>
NGROK_DOMAIN=<your-subdomain>.ngrok-free.dev

# ── Server tuning ───────────────────────────────────────────────────────
APP_PORT=5050                        # used by install-service.bat + dev.bat
PORT=5050                            # legacy alias read by app.py — keep equal to APP_PORT
FLASK_DEBUG=                         # set "true" only for dev.bat; never in prod
SESSION_COOKIE_SECURE=               # blank → auto-on when CF_TUNNEL_DOMAIN, WORKER_DOMAIN, NGROK_DOMAIN, or TAILSCALE_DOMAIN set
WAITRESS_CHANNEL_TIMEOUT=3600
WAITRESS_MAX_REQUEST_BODY=104857600  # bytes; MUST be ≥ FILE_UPLOAD_MAX_MB * 1024 * 1024

# ── File / avatar storage ───────────────────────────────────────────────
# Strongly recommended: separate drive from code (see §10a).
# NOTE: install-service.bat currently ships with `D:\MWLStorage\files` and
#       `D:\MWLStorage\avatar` (singular!) as built-in defaults. Override
#       in .env to the canonical paths below and align both ends.
FILE_STORAGE_DIR=D:\MeterWorklog_Storage\files
AVATAR_STORAGE_DIR=D:\MeterWorklog_Storage\avatars
FILE_UPLOAD_MAX_MB=100               # Flask MAX_CONTENT_LENGTH — capped by Cloudflare, see §9a
FILE_STORAGE_CAP_MB=20480            # total quota across all files
FILE_MIN_FREE_MB=8192                # stop uploads if free space < this

# ── Super_Ultimate_ADMIN login throttling ───────────────────────────────
SUPER_ADMIN_MAX_LOGIN_ATTEMPTS=3
SUPER_ADMIN_LOGIN_WINDOW_MINUTES=15
SUPER_ADMIN_LOCKOUT_MINUTES=30
SUPER_ADMIN_UNLOCK_TOKEN_MINUTES=30
SUPER_ADMIN_UNLOCK_EMAIL_COOLDOWN_SECONDS=300

# ── Email — Brevo (required for the "Forgot password?" reset-link flow) ─
# Preferred transport: Brevo HTTPS API. Falls back to SMTP STARTTLS
# (smtp-relay.brevo.com:587) when BREVO_API_KEY is empty. Both env-name
# generations are accepted (SMTP_USER/SMTP_PASS/SMTP_FROM win over the
# older SMTP_USERNAME/SMTP_PASSWORD/MAIL_FROM if both are set).
BREVO_API_KEY=...
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM='"MML Password Reset" <you@example.com>'
SMTP_SECURITY=starttls               # starttls | ssl
RESET_TOKEN_TTL_MINUTES=60           # optional, default shown
RESET_EMAIL_COOLDOWN_SECONDS=300     # optional, default shown
SUPER_ADMIN_UNLOCK_EMAIL=...         # destination for unlock-link emails (unlock flow itself is unimplemented — see §13)
APP_BASE_URL=https://mwl.yourdomain.com   # used to build reset URLs; blank = auto-derived from CF_TUNNEL_DOMAIN (or NGROK_DOMAIN fallback), else derived from the request
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
- **Frontend module convention** (revised): pick eager or lazy.
  - **Eager** → add a `<script defer src="…?v={{ static_v(…) }}">` tag
    to [templates/index.html](templates/index.html) in the right
    dependency slot. Use this when the module is needed on first paint.
  - **Lazy** → register the module name in `STATIC_V` in
    [static/app/core.js](static/app/core.js) and call
    `loadModuleOnce('<name>')` from `showTab()`. Use this for tabs that
    aren't visible until the user clicks into them.
- **Time math** for daily aggregates uses
  `((max(end) - min(start)) - lunch_overlap) / 60`
  with lunch = 12:00–13:00. See `get_dashboard()` and
  `get_projects_summary()` in [app/worklogs.py](app/worklogs.py).
- **Decorators stack in order**: `@blueprint.route(...)` →
  `@login_required` → `@elevated_required`/`@admin_required` →
  function definition.
- **Frontend filename convention**: hyphenated (`projects-summary.js`,
  not `projectsSummary.js`).
- **Add a new tab**:
  1. Nav button + view div in [templates/index.html](templates/index.html).
  2. New module in `static/app/<name>.js`.
  3. **Eager** load → add a `<script defer src="/static/app/<name>.js?v={{ static_v('app/<name>.js') }}">`
     tag in [templates/index.html](templates/index.html) (head section);
     **lazy** load → add `<name>` to `STATIC_V` in
     [static/app/core.js](static/app/core.js) and call
     `loadModuleOnce('<name>')` from `showTab()`.
  4. Add the name to `showTab()`'s tab list, the `allowedTabs` Set, and
     the `if (name === ...)` data-loading branch in
     [static/app/core.js](static/app/core.js).
  5. If admin-only, gate the nav button in `initializeApp()` and add a
     guard at the top of `showTab()`.
- **Add a new API route**: pick the right blueprint (or create one),
  decorate with `@login_required` (+ `@elevated_required` if
  cross-employee), use parameterized SQL, return `jsonify(...)`. Don't
  forget to register the new blueprint in `app/__init__.py` if creating
  one.

---

## 12. Operational tips

- Service logs: `logs\app.log`, `logs\app-error.log`, `logs\cloudflared.log`
  (and `logs\ngrok.log` if the dormant ngrok service was ever started)
  (rotated at 5 MB).
- `nssm status MeterWorklog`, `nssm restart MeterWorklog`,
  `nssm stop MeterWorklog`.
- After editing `.env`: re-run `install-service.bat` (it writes env vars
  into the NSSM service config) **or** edit via `nssm edit MeterWorklog`.
- Port 5050 in use → set `APP_PORT` in `.env` and re-run install script.
  Note: `app.py` currently reads `PORT` (not `APP_PORT`); keep both equal
  in `.env` until that is unified.
- File upload fails with no Flask log entry → three candidates, in order:
  `FILE_STORAGE_DIR` does not exist; `WAITRESS_MAX_REQUEST_BODY` is smaller
  than `FILE_UPLOAD_MAX_MB * 1024 * 1024` (Waitress rejects before Flask
  sees the request); or the file is over Cloudflare's proxied-body cap and
  died at the edge (§9a) — check the Worker's logs (`npx wrangler tail`),
  not Flask's.
- Page renders but every asset 404s → `dist/` is missing or stale. Run
  `npm run build` and redeploy the Worker (§6b, §9a). Flask's own routes on
  `APP_PORT` are unaffected, which is a useful way to isolate this.
- Bootstrapping the first admin: register normally, then in SSMS run
  `UPDATE users SET role='Super_Ultimate_ADMIN' WHERE username='...';`

---

## 12a. Pulling new code onto an existing deployment

A plain `git pull` is not sufficient. **Two** gitignored build artifacts do
not come down with it — `static/tailwind.css` (§6a) and the whole of
`dist/` (§6b) — and the Worker is deployed separately from the origin box.
Full sequence for updating an already-installed host:

```cmd
git pull origin main

REM Only if requirements.txt changed:
.venv\Scripts\pip install -r requirements.txt

REM Only the first time ever on this host (Tailwind CLI + wrangler):
npm install

REM Regenerates static/tailwind.css AND dist/. Run after every pull that
REM touched templates/*.html, static/**, or tailwind.config.js:
npm run build

REM Origin (Flask) — picks up Python/template/.env changes:
nssm restart MeterWorklog

REM Edge (Worker) — ships the new dist/ and worker/index.ts:
npx wrangler deploy --env production
```

**Both halves are needed.** They fail in different, distinguishable ways:

| Skipped | Symptom |
|---|---|
| `npm run build` | Pages render with stale/missing styling, or assets 404 — there is no CDN fallback anymore. |
| `nssm restart MeterWorklog` | `/api/*` still runs the old Python and the old `.env`. |
| `wrangler deploy` | The edge still serves the **previous** `dist/` — new frontend code simply never reaches users, even though it built fine locally. |

See [SKILL.md §3a](SKILL.md) for the operational runbook version, including
what an unbuilt/stale `tailwind.css` looks like in the browser.

---

## 13. Known drift / TODOs (as of 2026-05-18 code review)

These are real issues caught by the project-wide code review. Docs were
updated to flag them; code fixes are still pending and intentionally
out-of-scope for that review.

> **Security:** see [SECURITY.md](SECURITY.md) for the 2026-08-07 audit
> (login/auth, password storage, database, file share), the team-member
> guide, and the developer security rules. Its **Part 0** lists three
> CRITICAL items that outrank everything in the table below.

| # | Where | Issue | Severity |
|---|-------|-------|----------|
| 1 | [install-service.bat](install-service.bat):~28 | `SECRET_KEY`/`DB_SERVER` still hardcoded non-blank `SET` defaults; will leak into NSSM env if `.env` is missing that key. **PARTIALLY FIXED** — the previously-leaked `NGROK_AUTHTOKEN`/`NGROK_DOMAIN` defaults are now blank, and `CF_TUNNEL_TOKEN`/`CF_TUNNEL_DOMAIN` were added blank from the start. Still rotate `SECRET_KEY` and blank its default for prod. | Critical |
| 2 | [app/worklogs.py](app/worklogs.py) `update_worklog()` | `member_id` from JSON is **not** `int()`-coerced (unlike `create_worklog()`); auth comparison mixes str/int. | Critical |
| 3 | [app/core.py](app/core.py) `/api/settings/worklog-visibility` | Uses `@admin_required` (Super_Ultimate_ADMIN only); should be `@elevated_required` so Admin/Leader can toggle. | High |
| 4 | install-service.bat | Does not create `FILE_STORAGE_DIR` / `AVATAR_STORAGE_DIR`; first upload fails. Add `mkdir` calls. | High |
| 5 | install-service.bat defaults | Storage paths drift from §10a (`D:\MWLStorage\…` and `avatar` singular vs `D:\MeterWorklog_Storage\…` and `avatars`). Pick one and align. | High |
| 6 | db.init_db() / docs | `init_db2.sql` is **not** auto-applied. Either delete it or document that it requires manual `sqlcmd -i`. | High |
| 7 | [uninstall-service.bat](uninstall-service.bat) | Looks for nssm in `C:\Windows\System32\` while install-service.bat ships one at `deployer\nssm.exe`; standardize the location. | Medium |
| 16 | [install-service.bat](install-service.bat), [app/__init__.py](app/__init__.py) | ngrok → Cloudflare Tunnel migration in progress: `NGROK_*` handling (SET defaults, findstr loop, `AppEnvironmentExtra`, CSRF trusted-origin block, `SESSION_COOKIE_SECURE` check) is intentionally left **dormant** (present but no longer installed/started) as a rollback path. Follow-up cleanup once Cloudflare Tunnel is confirmed stable: delete all `NGROK_*` handling from both files, drop the ngrok section from `.env.example`, `nssm remove MeterWorklog-ngrok confirm` on the deploy machine. | Low |
| 8 | [.env.example](.env.example) | Missing ~20 vars the app actually reads (all `SUPER_ADMIN_*`, all `SMTP_*`, `MAIL_FROM`, `APP_BASE_URL`, `PORT`, `FLASK_DEBUG`, `FILE_STORAGE_DIR`). | Medium |
| 9 | [app/auth.py](app/auth.py) `/api/employee-lookup` | Intentionally public; rate-limiting TODO never landed — employee enumeration possible. | Medium |
| 10 | [app/avatars.py](app/avatars.py) | Returns raw exception text to clients on error paths (e.g. line 151). Sanitize for prod. | Medium |
| 11 | [static/app.js.bak](static/app.js.bak) | 1226-line legacy monolith superseded by modular split. Delete or `.gitignore`. | Low |
| 12 | `logintest/` | Undocumented, duplicates SETUP.txt content, `.gitignore` already excludes it → committed files are stale. Clean up. | Low |
| 13 | ~~[requirements.txt](requirements.txt)~~ | ~~`cachetools>=5.3` lacks an upper bound.~~ **FIXED 2026-07-30** — pinned `<6.0`. | Resolved |
| 14 | ~~[.gitignore](.gitignore)~~ | ~~Malformed `. e n v` (spaced characters) — does nothing, just clutter.~~ **FIXED 2026-07-30** — also replaced ~1537 lines of individually-listed `/frontend/node_modules/*` paths (leftover from a past session) with clean directory-level patterns. | Resolved |
| 15 | Frontend `esc()` / `_psEsc()` | Duplicate HTML-escape helpers in `worklogs.js` and `projects-summary.js` — consolidate into `core.js`. | Low |
| 17 | ~~"Frontend, no build step"~~ | ~~This guide claimed the frontend had no build step.~~ **RETIRED 2026-08-13** — it has one now: `npm run build` = `build:css` (§6a) + `build:static` (§6b, `templates/` → `dist/`). Anything that says otherwise is stale. `dist/` must be rebuilt **and** the Worker redeployed after frontend changes (§12a). | Resolved |
| 18 | `templates/Login.dc.html`, [static/app/support.js](static/app/support.js) | `Login.dc.html` is served by **no route**, and it is the only thing referencing `support.js`. Both are therefore dead — `support.js` is not in `index.html`'s `<script defer>` list nor in `STATIC_V`. Note `render-static.mjs`'s `PAGES` map deliberately excludes `Login.dc.html`, so this dead weight never reaches `dist/`. Delete both, or wire `Login.dc.html` to a route if it was meant to replace `login.html`. | Low |
| 19 | ~~[wrangler.jsonc](wrangler.jsonc)~~ | ~~`service_id` is still the literal `REPLACE_WITH_VPC_SERVICE_ID`.~~ **FIXED 2026-08-13** — VPC Service `mwl-flask-origin` created and its id (`019ffb7d-713f-71f1-b9a2-2c21e71def73`) is in place; production deploys and reaches Flask. | Resolved |

**2026-08-13 note:** the deployment moved to a **Cloudflare Worker edge**
(§9a) — the Worker serves the pre-rendered SPA from `dist/` and proxies
`/api/*` to the unchanged Flask/pyodbc/MSSQL origin over the existing
tunnel. Workers **cannot** host the Python backend (Hyperdrive is
PostgreSQL/MySQL only; Pyodide can't load pyodbc; VPC `connect()` is
plaintext TCP vs TDS's required TLS) — see §9a for the full rationale
before anyone re-proposes it. Upload cap dropped 5120 MB → 100 MB to match
Cloudflare's proxied-body limit.

**2026-07-30 note:** the CDN Tailwind link was replaced with a local purge
build (§6a) and the jsdelivr/Google Fonts payload was trimmed (Syne + DM
Mono now lazy-load with the Projects Summary tab instead of loading on
every page). `frontend/` and `static/react/` — an untracked Vite/React
prototype that had been left in this working tree — were confirmed to
contain zero unique files (pure `node_modules` cache + build output, both
regenerable from the `dev_frontend` branch) and were removed from `main`'s
working tree; see [12a](#12a-pulling-new-code-onto-an-existing-deployment)
if you also work on `dev_frontend` on this machine.
