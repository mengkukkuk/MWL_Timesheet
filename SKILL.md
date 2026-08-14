---
name: mwl-deploy
description: Operational guide for the MeterWorklog (MWL) stack — the Cloudflare Worker edge (Wrangler) that serves the static SPA and proxies /api/* to the on-prem Flask origin, installing/managing the Windows services via NSSM, the Cloudflare Tunnel, Tailscale Serve, the npm build, running the dev server, and bootstrapping the database. Activate when the user is deploying, restarting, troubleshooting, or configuring the MWL stack on Windows.
triggers:
  - install service
  - uninstall service
  - nssm
  - cloudflare tunnel
  - cloudflared
  - wrangler
  - worker deploy
  - tailscale serve
  - waitress
  - meterworklog deploy
  - dev.bat
  - bootstrap admin
  - pull main
  - npm run build
  - build:css
  - tailwind build
---

# MeterWorklog Deployment Skill

Operational playbook for running this Flask + SQL Server app behind a Cloudflare Worker on a Windows host. For architectural / code-level guidance see [CLAUDE.md](CLAUDE.md).

## 1. What gets deployed

**Two** halves, deployed separately. Missing either one is the most common cause of "I pushed but nothing changed" — see §3a.

### Edge — a Cloudflare Worker (`wrangler deploy`)

Serves the pre-rendered SPA from `dist/` and proxies `/api/*` to Flask through the tunnel. Everything is on **one hostname**, so the browser stays same-origin (no CORS, no cookie games).

```
browser ──► Worker ──┬── /api/*  ──► VPC Service ──► tunnel ──► Flask :5050 ──► MSSQL
                     └── else    ──► static assets (dist/)
```

> **The Worker does not run Python.** It cannot — Hyperdrive is PostgreSQL/MySQL only, Pyodide can't load `pyodbc`, and Workers VPC `connect()` is plaintext TCP while TDS needs TLS. The backend stays exactly where it is. Full rationale in [CLAUDE.md §9a](CLAUDE.md) — read it before re-proposing this.

### Origin — two Windows services managed by **NSSM**

| Service | Process | Purpose |
|---|---|---|
| `MeterWorklog` | `.venv\Scripts\python.exe -m waitress ... app:app` | Waitress WSGI server on `0.0.0.0:5050` |
| `MeterWorklog-cloudflared` | `deployer\cloudflared.exe tunnel run --token <CF_TUNNEL_TOKEN>` | Cloudflare Tunnel, **Worker → Flask** path (depends on the app service) |

`MeterWorklog-ngrok` is the **deprecated** predecessor. The installer no longer creates or starts it, but if it is still registered from an older install it is deliberately left alone as a same-second rollback (`nssm start MeterWorklog-ngrok`).

Plus an **idempotent Tailscale Serve** mapping (`https://443 → http://localhost:5050`) when Tailscale is installed — an authenticated `*.ts.net` URL that bypasses the Worker entirely.

Logs land in `<app>\logs\` (rotated at 5 MB):
- `app.log` / `app-error.log`
- `cloudflared.log` / `cloudflared-error.log`
- `ngrok.log` / `ngrok-error.log` (only if the dormant service was ever started)

Worker logs are **not** on this box — use `npx wrangler tail`.

## 2. Prerequisites (one-time per host)

1. **Python 3.11+** with `py -m venv .venv` then `.venv\Scripts\pip install -r requirements.txt`.
2. **Microsoft ODBC Driver 17 for SQL Server** — must match `DB_DRIVER` in `.env`.
3. **NSSM** at `C:\Windows\System32\nssm.exe` (download from https://nssm.cc/download). Both `install-service.bat` and `uninstall-service.bat` look there.
4. **cloudflared** — already vendored at `<app>\deployer\cloudflared.exe`. Create the tunnel in the Cloudflare Zero Trust dashboard (Networks → Tunnels, **token-based**) and copy the connector token; see [CLAUDE.md §9](CLAUDE.md) for the click-by-click walkthrough. Do **not** run cloudflared's own `service install` — NSSM manages it.
5. **Tailscale** (optional) — install from https://tailscale.com/download/windows and `tailscale up`. HTTPS must be enabled in the tailnet admin panel before `tailscale serve` will work.
6. **Node.js 18+ with npm** — **build-time only**, no Node process runs at
   request time on this box. It produces **two** gitignored artifacts:
   ```cmd
   npm install
   npm run build      REM = build:css + build:static
   ```
   - `static/tailwind.css` — the purged Tailwind build ([CLAUDE.md §6a](CLAUDE.md)). Without it every page renders unstyled; there is no CDN fallback.
   - `dist/` — `templates/*.html` rendered to plain static HTML plus a copy of `static/` ([CLAUDE.md §6b](CLAUDE.md)). This is what the Worker serves. Without it, `wrangler dev` / a deploy 404s every page.

   Neither comes down with `git pull`. Run this on every host, before the first login.
7. **Wrangler + a Cloudflare account** with Workers enabled. `npm install` pulls wrangler in as a devDependency; authenticate once with `npx wrangler login` and confirm with `npx wrangler whoami`.
8. **`.env`** at repo root. The **full** key list is in
   [CLAUDE.md §10](CLAUDE.md). Minimum required:
   ```env
   SECRET_KEY=<random-long-string>
   DB_SERVER=localhost\SQLEXPRESS
   DB_NAME=MeterWorklog
   DB_DRIVER={ODBC Driver 17 for SQL Server}
   DB_TRUST_CERT=yes
   CF_TUNNEL_TOKEN=<connector token from the Zero Trust dashboard>
   CF_TUNNEL_DOMAIN=<mwl.yourdomain.com>      # tunnel hostname
   WORKER_DOMAIN=<the hostname the browser uses>
   TAILSCALE_DOMAIN=<host>.<tailnet>.ts.net   # informational only
   APP_PORT=5050
   PORT=5050                                  # legacy alias read by app.py
   # Storage (highly recommended — separate drive)
   FILE_STORAGE_DIR=D:\MeterWorklog_Storage\files
   AVATAR_STORAGE_DIR=D:\MeterWorklog_Storage\avatars
   # Uploads — capped by Cloudflare, see §7
   WAITRESS_CHANNEL_TIMEOUT=3600
   WAITRESS_MAX_REQUEST_BODY=104857600
   FILE_UPLOAD_MAX_MB=100
   # Optional — SMTP for password-reset / admin-unlock emails:
   # SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
   # SMTP_FROM, SUPER_ADMIN_UNLOCK_EMAIL, APP_BASE_URL
   ```
   `install-service.bat` reads these via `findstr` — keep `KEY=value` with no surrounding spaces or quotes.

   `WORKER_DOMAIN` is the hostname the **browser** uses: `mwl-timesheet-production.<account>.workers.dev` while staging, or your custom domain once attached. It adds that origin to Flask's CSRF allow-list. Give it as a **bare hostname** — a `https://` prefix or trailing slash is stripped now, but the bare form is what the rest of the tooling assumes.

   > **Do not leave it blank on the VPC path.** A VPC Service selects the origin port by URL *scheme*, and ours registers an `http_port` only, so the Worker rewrites the URL to `http://` — which means Flask sees `X-Forwarded-Proto: http`, and the browser's `https://…` Origin no longer matches. `WORKER_DOMAIN` trusts both schemes for that host and is what closes the gap. Without it, GETs work but every non-GET `/api/*` returns `403 CSRF validation failed`.

   > **WARNING:** [install-service.bat](install-service.bat) ships with a
   > **hardcoded** default for `SECRET_KEY` and `DB_SERVER` near the top of
   > the file. They are overridden by `.env`, but they are in source
   > control. Treat anything committed there as exposed: rotate it, replace
   > the defaults with blanks, and rely on `.env` as the only source of
   > truth. (`CF_TUNNEL_TOKEN`, `CF_TUNNEL_DOMAIN`, `WORKER_DOMAIN`, and the
   > `NGROK_*` pair are already blank by design — keep them that way.)

## 3. Database bootstrap

Schema lives in `init_db.sql`; `db.init_db()` runs it batch-by-batch (split on `\nGO\n`). Trigger it once after the DB is created — typical sequence:

```cmd
sqlcmd -S localhost\SQLEXPRESS -E -Q "CREATE DATABASE MeterWorklog"
.venv\Scripts\python.exe -c "from db import init_db; init_db()"
```

The first user to register through `/register` is auto-promoted to `Super_Ultimate_ADMIN` if no admins exist (see `app/auth.py`). After that, role changes go through Settings → Users.

If `init_db.sql` has migration batches that already ran, expect `[init_db] SQL batch #N FAILED` warnings — these are non-fatal idempotency complaints and the script continues.

> **`init_db2.sql` is NOT auto-applied.** It is an older / alternate
> schema variant kept in the repo for reference; `db.init_db()` only
> runs `init_db.sql`. If you need DDL from it after pulling new code,
> apply it manually:
> ```cmd
> sqlcmd -S localhost\SQLEXPRESS -d MeterWorklog -E -i init_db2.sql
> ```

## 3a. Pulling new code onto an existing deployment

Routine update sequence for a host that's **already installed and running**. This is the checklist for "I just did `git pull` on `main`, now what":

```cmd
git pull origin main
```

Then, depending on what changed (running all of these unconditionally is always safe, just slower):

1. **`requirements.txt` changed:**
   ```cmd
   .venv\Scripts\pip install -r requirements.txt
   ```

2. **`package.json`, `tailwind.config.js`, any `templates/*.html`, or any
   `static/**` file changed:**
   ```cmd
   npm install
   npm run build
   ```
   This regenerates **both** gitignored artifacts — `static/tailwind.css` and `dist/`. Neither comes down with `git pull` and there is no CDN fallback. Skipping it means stale/missing CSS and a `dist/` that still contains the *old* frontend. It's a couple of seconds; just run it.

3. **`init_db.sql` gained new migration batches:** no action needed —
   `db.init_db()` re-applies it automatically (idempotent) on the next
   request after the service restarts. **`init_db2.sql` changed:** apply
   manually, it is never auto-run:
   ```cmd
   sqlcmd -S localhost\SQLEXPRESS -d MeterWorklog -E -i init_db2.sql
   ```

4. **Restart the origin** (after the steps above, so it picks up new code, new CSS, and any `.env` change):
   ```cmd
   nssm restart MeterWorklog
   ```
   `MeterWorklog-cloudflared` / Tailscale Serve do not need restarting for code-only changes.

5. **Deploy the edge** — this is the step that is easy to forget and silently ships nothing:
   ```cmd
   npx wrangler deploy --env production
   ```

6. **Smoke test:** open the Worker hostname, confirm the login page renders styled, sign in, and confirm the dashboard loads data (that last part proves `/api/*` → tunnel → Flask → MSSQL is intact).

**Which step did I skip?** They fail distinguishably:

| Skipped | Symptom |
|---|---|
| `npm run build` | Unstyled or stale-looking pages; assets 404 |
| `nssm restart MeterWorklog` | `/api/*` runs old Python / old `.env` |
| `npx wrangler deploy` | Frontend changes never appear, even though the build succeeded locally |

## 4. Install the origin services

From an **elevated** cmd prompt in the repo root:

```cmd
install-service.bat
```

What it does (verbatim from the script):
1. Auto-detects `APP_DIR` from the `.bat` location.
2. Loads overrides from `.env` (`SECRET_KEY`, `DB_*`, `CF_TUNNEL_*`, `WORKER_DOMAIN`, `TAILSCALE_DOMAIN`, Waitress tuning).
3. Creates `<app>\logs\`.
4. `nssm install MeterWorklog` → Waitress with `--channel-timeout` and `--max-request-body-size` from env, app entrypoint `app:app`.
5. Sets `AppEnvironmentExtra` so the service has DB + secret + domain env vars (note: it does **not** propagate every variable from `.env` — only the ones explicitly listed; if you add a new env var the app needs at runtime, edit the script).
6. `nssm install MeterWorklog-cloudflared` (`tunnel run --token …`) with `DependOnService MeterWorklog`.
7. Starts both services.
8. Runs `tailscale serve --bg --https=443 http://localhost:5050` — survives reboots, safe to re-run.

**Post-install checklist (manual — the installer does NOT do these):**

```cmd
REM 1. Create storage directories (installer does NOT create them)
mkdir D:\MeterWorklog_Storage\files
mkdir D:\MeterWorklog_Storage\avatars

REM 2. (Production) Lock down ACLs — see CLAUDE.md §10a for full commands
icacls "D:\MeterWorklog_Storage" /reset
icacls "D:\MeterWorklog_Storage" /grant:r "NT AUTHORITY\SYSTEM:(OI)(CI)F"
icacls "D:\MeterWorklog_Storage" /inheritance:r

REM 3. (If applicable) Apply init_db2.sql manually
REM    sqlcmd -S <server> -d MeterWorklog -E -i init_db2.sql

REM 4. Build the frontend — static/tailwind.css and dist/ are gitignored
REM    and won't exist on a fresh clone. See CLAUDE.md §6a / §6b.
npm install
npm run build

REM 5. Confirm both services are running
nssm status MeterWorklog
nssm status MeterWorklog-cloudflared

REM 6. Deploy the edge (see §4a first — the VPC service must exist)
npx wrangler deploy --env production
```

## 4a. Wire and deploy the Worker edge

One-time, then `wrangler deploy` for every subsequent release.

1. **Create the VPC Service** against the *existing* tunnel, so Flask needs no public hostname:
   ```cmd
   npx wrangler vpc service create mwl-flask-origin ^
     --type http --tunnel-id <MeterWorklog tunnel id> ^
     --ipv4 127.0.0.1 --http-port 5050
   ```
   `--ipv4` rather than `--hostname`: cloudflared resolves this from the same box Flask runs on, and `--hostname` additionally requires `--resolver-ips`. Creating it needs the **Connectivity Directory Admin** role; binding it needs **Bind**.

   `--tunnel-id` must be the tunnel the running `cloudflared` actually registered — grep `tunnelID=` in `logs\cloudflared-error.log`. If it's recreated later (new `CF_TUNNEL_TOKEN`), the service silently points at a dead tunnel and `/api/*` fails with `destination_unavailable` (§9).

   Keep it `--http-port` only: the scheme of the URL the Worker fetches selects the port, and `worker/index.ts` fetches `http://` for exactly this reason.

2. **Paste the returned id** into `env.production.vpc_services[0].service_id` in [wrangler.jsonc](wrangler.jsonc).

3. **Build and deploy:**
   ```cmd
   npm run build
   npx wrangler deploy --env production --dry-run
   npx wrangler deploy --env production
   ```

4. **Set `WORKER_DOMAIN`** in `.env` to the hostname the browser will use — a **bare hostname**, no `https://`, no trailing `/` — then re-run `install-service.bat` **as Administrator** so Flask trusts that origin. This is required on the VPC path, not optional; skip it and GETs work while every POST 403s (§9).

5. **Verify end-to-end on the real hostname** — login, dashboard data, a file upload, an Excel export.

6. **Only then: remove the tunnel's public-hostname route** in the Zero Trust dashboard, so Flask is reachable exclusively by the Worker. That removal is both the security win and the **rollback lever** — re-add the route to revert instantly. The NSSM services are untouched throughout, so the pre-Worker deployment stays viable the whole time.

> Two `wrangler` behaviours that look like bugs but are not:
> - `--env production` warns *"vars exists at the top level, but not on env.production"*. **Leave it.** That is what stops the dev-only `ORIGIN_URL` plain-fetch path from existing in production.
> - Workers VPC is in **public beta**. Free on all Workers plans, but the API may change. If it is unavailable on the account, the fallback is a plain `fetch()` to `CF_TUNNEL_DOMAIN` plus a shared-secret header — strictly weaker, since it keeps the origin publicly routable.

## 5. Run in dev mode (no service)

```cmd
dev.bat
```

Spawns two console windows:
- **Flask** on `APP_PORT` from `.env` (default 5050), `FLASK_DEBUG=true`.
- **`wrangler dev`** on **8787**, serving `dist/` and proxying `/api/*` to Flask via `--var ORIGIN_URL:http://localhost:%APP_PORT%`.

**Browse `http://localhost:8787`** — that is the topology that ships. Flask's own HTML routes still answer on `APP_PORT` if you need to bypass the Worker to isolate a problem.

`dev.bat` runs `npm run build` for you only if `dist/index.html` is **missing**. It does not detect a *stale* `dist/` — re-run `npm run build` yourself after editing `templates/` or `static/`, then reload.

## 6. Day-to-day operations

```cmd
nssm status   MeterWorklog
nssm restart  MeterWorklog
nssm stop     MeterWorklog-cloudflared
nssm start    MeterWorklog-cloudflared
nssm edit     MeterWorklog            REM GUI editor for service config
```

Tail origin logs:
```cmd
powershell Get-Content -Wait -Tail 50 logs\app.log
powershell Get-Content -Wait -Tail 50 logs\app-error.log
powershell Get-Content -Wait -Tail 50 logs\cloudflared.log
```

Tail **edge** logs (not on this box):
```cmd
npx wrangler tail --env production
npx wrangler deployments list --env production
npx wrangler rollback --env production
```

Tailscale Serve inspection:
```cmd
"C:\Program Files\Tailscale\tailscale.exe" serve status
"C:\Program Files\Tailscale\tailscale.exe" serve reset
```

## 7. Updating config / code

- **Python / backend change** → `nssm restart MeterWorklog`. No Worker deploy needed; the tunnel keeps running.
- **Frontend change** (`templates/`, `static/`) → `npm run build` **then** `npx wrangler deploy --env production`. A service restart alone does nothing for users on the Worker hostname.
- **`worker/index.ts` or `wrangler.jsonc` change** → `npx wrangler deploy --env production`.
- **`.env` change** → re-run `install-service.bat` (it re-applies `AppEnvironmentExtra`) **or** edit via `nssm edit MeterWorklog` → *Environment* tab, then restart.
- **New tunnel token / hostname** → update `CF_TUNNEL_TOKEN` / `CF_TUNNEL_DOMAIN` in `.env`, then re-run the installer (this rewrites `AppParameters` for the cloudflared service).
- **Bigger uploads** → **you probably can't.** Requests reach Flask *through* Cloudflare, whose proxied request-body limit is **100 MB on Free/Pro** (200 MB Business, 500 MB Enterprise). Raising `FILE_UPLOAD_MAX_MB` and `WAITRESS_MAX_REQUEST_BODY` above that does nothing — the request dies at the edge with a 413 Flask never sees. Keep the three aligned:

  | Setting | Value |
  |---|---|
  | `FILE_UPLOAD_MAX_MB` | `100` |
  | `WAITRESS_MAX_REQUEST_BODY` | `104857600` |
  | Cloudflare proxied body (Free/Pro) | 100 MB |

  The SPA reads the effective cap from `/api/files/stats` and rejects oversized files client-side with a real message, so users don't hit the opaque edge 413.

## 8. Uninstall

```cmd
uninstall-service.bat
```

Stops + removes the app, cloudflared, and (if present) the dormant ngrok NSSM services, and runs `tailscale serve reset`. The `.venv`, `logs\`, `.env`, and vendored binaries are left in place so you can re-install without re-downloading anything.

This does **not** touch the Worker. To remove that too:
```cmd
npx wrangler delete --env production
```

## 9. Troubleshooting

**First question: edge or origin?** Hit the Flask port directly (or the tailnet URL) — if it works there but not on the Worker hostname, the problem is the Worker/`dist/`/tunnel, not the app.

| Symptom | Most likely cause | Fix |
|---|---|---|
| `ERROR: Run as Administrator!` from installer | Non-elevated shell | Right-click cmd → *Run as administrator* |
| `nssm.exe not found at C:\Windows\System32\nssm.exe` | NSSM not installed | Copy `nssm.exe` (64-bit) into `C:\Windows\System32\` |
| App service starts then immediately stops | Bad `.env` (DB unreachable, SECRET_KEY missing) | Check `logs\app-error.log`; fix env; `nssm restart MeterWorklog` |
| `pyodbc.InterfaceError ... IM002` | ODBC driver name mismatch | Verify driver string with `odbcad32.exe` → *Drivers* tab; align `DB_DRIVER` in `.env` |
| `pyodbc.Error: ... Login failed` | Service running under wrong user (LocalSystem) and SQL only allows Windows auth from a specific account | Either switch SQL to mixed mode and set `DB_USER`/`DB_PASSWORD`, or set the service's *Log On* user via `nssm edit` |
| `[init_db] SQL batch #N FAILED` | Batch already applied | Usually safe — only a problem if the failure is on a brand-new batch the app actually needs |
| **Every page 404s on the Worker hostname** | `dist/` was missing or stale at deploy time | `npm run build` then `npx wrangler deploy --env production` |
| **Frontend change deployed but users still see the old UI** | Built locally, never deployed | `npx wrangler deploy --env production` — §3a step 5 |
| **`/api/*` returns 503 `No origin configured`** | Neither the VPC binding nor `ORIGIN_URL` resolved | Production: `service_id` in `wrangler.jsonc` is unset or wrong, or the binding lacks **Bind** permission (§4a). Dev: Flask isn't running on `APP_PORT` |
| **`/api/*` returns 500 `error code: 1101`** | The Worker script threw. The real message is visible **only** via `npx wrangler tail --env production --format json` — never in the browser | Tail first, then match the reason against the two rows below |
| ↳ tail says `port_not_open … failed to build target strategy: https` | A VPC Service selects the origin port by URL **scheme**, and ours registers an `http_port` only | The Worker must rewrite the URL to `http://` before `env.ORIGIN.fetch()` — already done in [worker/index.ts](worker/index.ts). If you ever add an `https_port`, keep both ends in sync |
| ↳ tail says `destination_unavailable` | The VPC Service is bound to a **different tunnel** than the one `cloudflared` actually registered (e.g. the tunnel was recreated and `CF_TUNNEL_TOKEN` rotated) | Compare `npx wrangler vpc service get <service_id>` against `tunnelID=` in `logs\cloudflared-error.log`; repoint with `npx wrangler vpc service update <service_id> --name mwl-flask-origin --type http --tunnel-id <live id> --ipv4 127.0.0.1 --http-port <APP_PORT>` |
| `/api/*` 502/504 through the Worker, Flask fine locally | Tunnel down, or VPC service points at the wrong port | `nssm status MeterWorklog-cloudflared`; check `logs\cloudflared.log`; confirm the VPC service's `--http-port` matches `APP_PORT` |
| Cloudflared service running but hostname unreachable | Token wrong/revoked, or no public-hostname route on the tunnel | `nssm edit MeterWorklog-cloudflared` → check `AppParameters`; verify the tunnel is *Healthy* in the Zero Trust dashboard |
| `tailscale serve` non-zero exit | Not logged in, HTTPS feature disabled, port 443 in use | `tailscale status`, enable HTTPS in admin panel, free port 443 |
| **413 / connection reset on uploads over ~100 MB** | Cloudflare's proxied-body cap — the request never reaches Flask | Not fixable by raising limits (§7). Check `npx wrangler tail`, not `app.log` |
| 413 on uploads *under* 100 MB | `WAITRESS_MAX_REQUEST_BODY` too low | Raise it to ≥ `FILE_UPLOAD_MAX_MB * 1024 * 1024`, restart app service |
| **GETs work but every POST/PUT/DELETE returns `403 CSRF validation failed`** | Origin not in the allow-list, and the fallback you'd expect doesn't exist: **Waitress strips all `X-Forwarded-*` headers** (`trusted_proxy=None` + `clear_untrusted_proxy_headers=True` by default), so the Worker's forwarded-host trust layer is inert in production. The explicit `WORKER_DOMAIN` is what closes the gap, as a **bare hostname** | Set `WORKER_DOMAIN=host.example.workers.dev` (no `https://`, no trailing `/`) in `.env`, then re-run `install-service.bat` **as Administrator** — `nssm restart` alone reloads Python but *not* `.env`. See `verify_api_csrf_origin()` / `_domain_env()` in [app/__init__.py](app/__init__.py) |
| File upload fails immediately, nothing in `app.log` | `FILE_STORAGE_DIR` or `AVATAR_STORAGE_DIR` doesn't exist, or write-denied | `mkdir` the paths from `.env`; verify `icacls` grants SYSTEM `(OI)(CI)F` |
| Random 500s after pulling new code | `init_db.sql` ran but `init_db2.sql` (or a hand-rolled migration) hasn't | Apply migration manually: `sqlcmd … -i init_db2.sql` |
| Page loads as plain unstyled HTML | `static/tailwind.css` missing (fresh clone, never built) or stale | `npm install` (first time) `&& npm run build`, then redeploy the Worker |
| `npm run build:static` throws *"still contains Jinja syntax"* | Someone added real Jinja (`{{ }}` / `{% %}`) to a template — only `static_v()` is supported by the static build | Remove it, or move that data behind `/api/*`. See [CLAUDE.md §6b](CLAUDE.md) |
| `npm run build:static` throws *"static/tailwind.css is missing"* | `build:css` never ran | `npm run build` (runs both, in order) |
| `'tailwindcss' is not recognized` running `npm run build:css` | `npm install` was never run in this repo root, or Node/npm isn't installed | Install Node.js 18+, then `npm install` from the repo root (not a subfolder) |
| All users logged out / "Invalid session" after redeploy | `SECRET_KEY` was rotated; signed cookies are no longer valid | Expected — users must log in again. Keep `SECRET_KEY` stable across restarts |

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
| [wrangler.jsonc](wrangler.jsonc) | Worker config — `dist/` assets, `/api/*` routing, production VPC binding |
| [worker/index.ts](worker/index.ts) | The edge itself: static assets + `/api/*` proxy with `X-Forwarded-*` |
| [scripts/render-static.mjs](scripts/render-static.mjs) | Renders `templates/*.html` → `dist/` (§3a, [CLAUDE.md §6b](CLAUDE.md)) |
| [package.json](package.json) / [tailwind.config.js](tailwind.config.js) | `npm run build` = Tailwind purge build + static render |
| [install-service.bat](install-service.bat) | Installs both NSSM services + Tailscale Serve |
| [uninstall-service.bat](uninstall-service.bat) | Removes the services + resets Tailscale Serve |
| [dev.bat](dev.bat) | Launches Flask + `wrangler dev` in two console windows (browse 8787) |
| [.env](.env) | Runtime config, read by both `install-service.bat` and the app at startup |
| [db.py](db.py) | Connection (`get_connection`) + migration runner (`init_db`) |
| [init_db.sql](init_db.sql) | Schema, executed batch-by-batch on `\nGO\n` |
| [init_db2.sql](init_db2.sql) | Alternate/older variant — **NOT auto-applied**; manual `sqlcmd -i` only |
| [app/__init__.py](app/__init__.py) | Flask app factory, CSRF/origin check, blueprint registration |
| [app/cache.py](app/cache.py) | In-process TTLCache for list endpoints (no Redis needed) |
| `deployer/` | Vendored binaries: `cloudflared.exe`, `ngrok.exe` (dormant), `nssm.exe` |
| `dist/` | **Gitignored** build output served by the Worker — rebuild, never edit |
| [logs/](logs) | Origin service stdout/stderr (auto-rotated at 5 MB). Worker logs: `wrangler tail` |
