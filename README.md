# MeterWorklog (MWL)

Internal time-tracking / worklog web app: per-employee daily work entries,
monthly hour aggregation, project/skill management, file sharing, and Excel
timesheet export. Deployed as a Windows service on a single on-prem machine,
exposed via ngrok and/or Tailscale Serve.

For full architecture, conventions, and operational details, see:

- [CLAUDE.md](CLAUDE.md) — project guide for Claude Code (architecture, DB
  schema, frontend structure, conventions)
- [AGENTS.md](AGENTS.md) — equivalent guide for Codex
- [SKILL.md](SKILL.md) — deployment/operations playbook (install, restart,
  rebuild, troubleshooting)

## Tech stack

| Layer      | Choice                                                          |
| ---------- | ---------------------------------------------------------------- |
| Web server | Flask 3.1 (dev) + Waitress 3.0 (prod, via NSSM)                  |
| Database   | Microsoft SQL Server (Express) via pyodbc + ODBC 17              |
| Frontend   | Hybrid: vanilla JS SPA (Tailwind CDN) migrating to React 19 + TypeScript islands built with Vite, glued together by react-router |
| Auth       | Server-side sessions (Flask `session`, signed cookie)            |
| Excel export | `openpyxl` against template workbooks in `templates/`          |
| Service host | NSSM (`nssm.exe`)                                               |
| Public URL | ngrok reserved domain and/or Tailscale Serve                     |

## Repository layout

```
app/            Flask blueprints (auth, worklogs, employees, projects, files, ...)
frontend/       React/TypeScript source, built by Vite into static/react/
static/
  app/          Remaining vanilla JS modules (per-tab logic)
  react/        Vite build output (git-ignored, generated)
templates/      app.html (SPA shell), login.html, Excel export templates
db.py           pyodbc connection wrapper
init_db.sql     Full schema, auto-applied on first request
```

See [CLAUDE.md §3](CLAUDE.md) for the full annotated tree.

## Local development

### Backend

```bash
.venv\Scripts\pip install -r requirements.txt
dev.bat   # starts Flask (debug, port 5123) + ngrok in separate windows
```

### Frontend

```bash
cd frontend
npm install
npm run dev     # Vite dev server on :5173, proxies /api to Flask on :5123
```

**Important:** the Flask app only ever serves the **built** output in
`static/react/`. To see frontend changes reflected when hitting the Flask app
directly (port 5123), you must build:

```bash
cd frontend
npm run build
```

## Tests

```bash
.venv\Scripts\pytest tests/ -q
```

## Deployment

Production install/uninstall, environment variables, storage/backup strategy,
and troubleshooting live in [SKILL.md](SKILL.md).
