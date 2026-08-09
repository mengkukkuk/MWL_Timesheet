# SECURITY.md — MeterWorklog (MWL)

Security guide for **team members** (Part 1) and **developers** (Parts 2–4).

Audit date: **2026-08-07** · Scope: login/auth, password storage, database access, file share.

> Slide-deck version of this material — request flow diagrams per domain —
> is at [security-workflow.html](security-workflow.html) (open in a browser; self-contained, offline).

---

## Part 0 — Fix these three before anything else

| # | What | Where | Why it matters |
|---|------|-------|----------------|
| 1 | `SECRET_KEY` hardcoded (a dictionary word) | [install-service.bat:23](install-service.bat) | Flask signs the session cookie with this. Anyone who knows it can **forge a Super_Ultimate_ADMIN session** without a password. |
| 2 | ngrok authtoken hardcoded | [install-service.bat:24](install-service.bat) | Lets a third party bind the public domain and MITM all traffic. |
| 3 | Super_Ultimate_ADMIN seeded with a committed password hash | [init_db.sql:354-360](init_db.sql) | A known, offline-crackable admin account exists on every fresh database. |

**All three have been in git since the initial commit `5516f91`.** Rotating the values is not enough on its own — they remain in history. Minimum response:

1. Generate a new `SECRET_KEY` (`python -c "import secrets; print(secrets.token_hex(32))"`), put it **only** in `.env`, blank the `SET` defaults in `install-service.bat`.
2. Revoke the ngrok token in the ngrok dashboard and issue a new one — `.env` only.
3. Change the seeded admin's password, or delete the account if unused, and remove the `INSERT` from `init_db.sql`.
4. Restart: `nssm restart MeterWorklog`. Rotating `SECRET_KEY` invalidates every existing session — everyone re-logs in. That is intended.

> Good news: `.env` itself is correctly ignored ([.gitignore:160](.gitignore)) and **has never been committed** — verified against git history.

---

# Part 1 — For team members

You do not need to read any code to follow this part.

## 1.1 What MWL holds

MWL stores personal data covered by Thailand's **PDPA**: names, employee IDs, departments, positions, job grades, profile photos, and a day-by-day record of what each person worked on. Treat exports and screenshots the same way you would treat an HR file.

## 1.2 Your password

- **Never reuse** your MWL password anywhere else.
- Passwords are stored **hashed with scrypt**, not encrypted and not in plain text. Nobody — including admins — can read your password out of the database. This is correct and intentional.
- There is **no minimum length or complexity rule enforced by the app today.** Until that is added, the strength of your password is entirely on you. Use a passphrase of 4+ unrelated words, or a password manager.

## 1.3 If you get locked out

After **5 failed logins in 15 minutes** your account locks for **5 minutes**. Super admins lock after 3 attempts for 30 minutes. Just wait it out — the lock clears on its own.

If you did not cause those failed attempts, **tell your admin.** Someone may be guessing your password.

## 1.4 Forgot your password

1. Login page → **"Forgot password?"** → enter your **username**.
2. The page always says the same thing whether or not the account exists. This is deliberate — it stops outsiders from probing which usernames are real. It does **not** mean the request failed.
3. If an email address is on file, you get a reset link. It expires in **60 minutes** and works **once**.
4. No email on file? Ask an Admin or Leader to add one via **Settings → Users**.
5. **Super_Ultimate_ADMIN accounts cannot self-reset** by design.

**Never forward a reset link to anyone.** Whoever opens it first takes over the account.

## 1.5 File Share — read this carefully

> **The File Share is shared with everyone who can log in.** It is not personal storage.

- Any logged-in user can **list and download any file**, regardless of who uploaded it. There is no per-user or per-department permission.
- The **only** access control is the **"Classified"** flag. Classified items are hidden from `Staff` and return "not found" to them. Admins, Leaders, and Super Admins still see everything.
- So: mark anything sensitive **Classified**, and understand that this only hides it from Staff — not from other elevated users.
- **Do not upload** payroll data, ID card scans, contracts, credentials, or personal documents. Use the proper HR channel.
- **Do not upload `.html` or `.svg` files you did not create.** Opening one can run attacker-controlled script inside your logged-in MWL session.
- Uploads are capped at 5 GB each, drawn from a shared pool (600 GB as the service is currently installed). Deleting large files you no longer need is a favour to everyone.

## 1.6 Profile photos

- Max 2 MB, JPEG/PNG/GIF/WebP only. The file's actual contents are checked, not just its name — renaming a `.exe` to `.jpg` will be rejected.
- Only **you** can change your own photo. The only exception is a Super Admin.

## 1.7 General habits

- **Log out on shared machines.** Closing the tab is not logging out.
- MWL is reachable from outside the office over ngrok/Tailscale. Assume the login page is being probed continuously.
- **Report immediately** to your Admin if you see: a lockout you didn't cause, a worklog you didn't write, a file that vanished, or an unexpected password-reset email.

---

# Part 2 — For developers

Rules to follow when changing this codebase. These reflect what the code already does well; keep it that way.

## 2.1 SQL — always parameterize

Every query goes through [db.py](db.py) `query()` / `execute()`, which pass a params tuple to pyodbc `?` placeholders. **The audit found zero SQL injection vulnerabilities.** Do not be the first.

```python
# CORRECT
db.query("SELECT * FROM users WHERE username = ?", (username,))

# NEVER
db.query(f"SELECT * FROM users WHERE username = '{username}'")
```

Dynamic **structure** (not values) appears in a few places and is safe only because the inputs are code-controlled:

- `IN ({placeholders})` — [app/files.py:643](app/files.py), [app/files.py:860](app/files.py): placeholders are generated `?` marks, values still bound.
- `TOP {limit}` — [app/files.py:889](app/files.py): `limit` is clamped to 1–100 first.
- Column names built by f-string — [app/auth.py:352-368](app/auth.py) `_upsert_security_state()`: safe today because callers pass fixed kwargs, but **there is no whitelist guard.** If you extend this function, add one.

## 2.2 Secrets live in `.env`, nowhere else

No secret may appear in `.bat`, `.sql`, `.py`, or any tracked file. `SECRET_KEY` is already fail-fast at [app/__init__.py:87-92](app/__init__.py) — keep it that way; never add a fallback default.

## 2.3 Decorators are not authorization

`@login_required` / `@elevated_required` / `@admin_required` ([app/auth.py:91-130](app/auth.py)) gate the *route*. They do **not** check that the requester owns the *row*. For anything scoped to one employee you need both.

```python
@worklogs_bp.route('/api/worklogs/<int:wid>', methods=['PUT'])
@login_required
def update_worklog(wid):
    if session['role'] not in ELEVATED_ROLES:
        row = db.query("SELECT EmployeeID FROM worklogs WHERE id=?", (wid,), fetchone=True)
        if not row or str(row['EmployeeID']).strip() != str(session['member_id']).strip():
            return jsonify({'error': 'Permission denied'}), 403
```

**Never let a feature flag short-circuit an authorization check.** The current bug is exactly this — see §3.2.

## 2.4 Normalize `EmployeeID` types

`dbo.Employee.EmployeeID` is **NVARCHAR**, `session['member_id']` holds it, and different endpoints read the query param with and without `type=int`. Comparing `int != str` is always `True` — the check silently passes.

**Rule:** coerce both sides identically at the boundary. Prefer `str(x).strip()` on both, since the DB column is nvarchar and may carry padding.

```python
# WRONG — one side int, other side str
employee_id = request.args.get('member_id', type=int)
if employee_id != session.get('member_id'): ...

# CORRECT
employee_id = str(request.args.get('member_id') or '').strip()
if employee_id != str(session.get('member_id') or '').strip(): ...
```

## 2.5 Error messages

Never return exception text to the client. Log the detail, return something generic.

```python
# WRONG — leaks paths, driver internals, SQL fragments
except Exception as e:
    return jsonify({'error': str(e)}), 500

# CORRECT
except Exception:
    app.logger.exception('file download failed')
    return jsonify({'error': 'An error occurred. Please try again.'}), 500
```

Existing offenders: [app/files.py:499](app/files.py), [app/files.py:733](app/files.py), [app/files.py:781](app/files.py), [app/avatars.py:154](app/avatars.py), [app/avatars.py:179](app/avatars.py).

## 2.6 The `esc()` trap — read before touching any frontend file

`esc()` in [static/app/worklogs.js:473-477](static/app/worklogs.js) is:

```js
function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;   // HTML text-node serialization
}
```

Serializing a **text node** escapes only `&`, `<`, `>`, and U+00A0. It does **not** escape `"` or `'`. That makes it safe in exactly one context:

| Context | `esc()` safe? | Use instead |
|---|---|---|
| Text between tags — `<td>${esc(x)}</td>` | **Yes** | — |
| Quoted attribute — `title="${esc(x)}"` | **No** — `"` passes through and breaks out of the attribute | `_psEsc()` |
| Inline handler — `onclick="f('${esc(x)}')"` | **No** — `'` passes through and breaks into JS | Don't build handlers from data; use `addEventListener` |
| Raw JSON in a handler — `onclick='f(${JSON.stringify(x)})'` | **No** — no escaping at all | Same as above |

`_psEsc()` in [static/app/projects-summary.js](static/app/projects-summary.js) is the version that also handles quotes. **Consolidate on it in `core.js`** and delete the duplicate — this is drift item #15 in CLAUDE.md.

**Preferred pattern:** stop generating markup with interpolated data. Render the element, then attach data via `dataset` and behaviour via `addEventListener`.

## 2.7 File upload defenses (already in place — preserve them)

- Stored blobs are named by **UUID** on disk, never by the user's filename ([app/files.py:398](app/files.py) `_storage_paths_for_new`).
- Every path resolution goes through `os.path.realpath` + a prefix check against the storage root ([app/files.py:409](app/files.py) `_resolve_blob_path`) — this is what blocks traversal. Do not bypass it.
- Avatars are validated by **magic bytes**, not extension or `Content-Type` ([app/avatars.py:47](app/avatars.py) `_sniff`).
- Downloads default to `Content-Disposition: attachment`. The `?inline=1` branch at [app/files.py:545](app/files.py) is the exception — see §3.3.

## 2.8 Checklist for every new endpoint

- [ ] `@login_required` present (plus `@elevated_required` / `@admin_required` if cross-employee)
- [ ] Row-ownership check for non-elevated users — independent of any feature flag
- [ ] `EmployeeID` normalized on **both** sides of every comparison
- [ ] All SQL values bound as params; any dynamic identifier whitelisted
- [ ] Errors generic to the client, detailed in the server log
- [ ] No secret, path, or internal identifier in the response body
- [ ] Frontend rendering uses the correct escaper for its context (§2.6)
- [ ] Writes `EmployeeID`, leaves legacy `member_id` NULL

---

# Part 3 — Audit findings

## 3.0 What is already done well

Do not "fix" these — they are correct.

| Area | Status |
|---|---|
| **SQL injection** | **Clean.** All values parameterized through `db.py`. No string-concatenated user input anywhere. |
| **Password hashing** | **scrypt (N=32768, r=8, p=1)** via Werkzeug 3.1.8 — current, memory-hard, correct. Not MD5/SHA1, not reversible encryption. |
| **Password reset** | Only the SHA-256 **hash** of the token is stored; raw token never persisted or logged. Single-use, TTL, resend cooldown, uniform generic 200 responses, and a `no-referrer` standalone page that scrubs the token from the URL. Genuinely well built. |
| **Anti-enumeration on login** | Account status is checked **after** password verification ([app/auth.py:205-217](app/auth.py)) so timing/response don't reveal which usernames exist. |
| **Path traversal** | `realpath` + prefix check, UUID blob names. Blocked. |
| **Avatar validation** | Magic-byte sniffing, 2 MB cap, self-or-super-admin write model (PDPA-aligned). |
| **Login throttling** | Per-username sliding window with lockout; stricter tier for Super Admin. |
| **Classified items** | Return **404**, not 403 — no existence disclosure to Staff. |
| **Session cookies** | `HttpOnly` + `SameSite=Lax`, auto-`Secure` when a public domain is configured ([app/__init__.py:95-110](app/__init__.py)). Tokens are not in `localStorage`. |
| **CSRF** | Origin/Referer validated on every non-GET `/api/*` ([app/__init__.py:201](app/__init__.py)). Appropriate for a same-origin SPA. |
| **`.env` hygiene** | Ignored and never committed — verified against full git history. |
| **Dependencies** | Flask 3.1.3, Werkzeug 3.1.8, Waitress 3.0.2, pyodbc 5.3.0 — all current, no known advisories. |
| **User admin guards** | No self-delete; Super Admin protected; Leader cannot modify Admin ([app/users.py](app/users.py)). Clean. |

## 3.1 CRITICAL — committed secrets

Covered in Part 0. Severity is CRITICAL because item 1 alone permits **complete authentication bypass**: with the signing key, an attacker mints a cookie asserting any `user_id` and `role` without ever touching the login endpoint. Login throttling, password strength, and lockouts are all irrelevant to that path.

## 3.2 HIGH — `_worklog_open` short-circuits authorization (IDOR)

Three endpoints in [app/worklogs.py](app/worklogs.py) guard cross-employee reads like this:

```python
# lines 28-41, get_worklogs
employee_id = request.args.get('member_id')        # str
if (not app_pkg._worklog_open
        and session.get('role') not in ELEVATED_ROLES
        and employee_id != session.get('member_id')):
    return jsonify({'error': 'Permission denied'}), 403
```

Two independent defects:

**(a) The flag disables the check.** `_worklog_open` is a *business* toggle meaning "the submission window is open." When it is `True`, `not _worklog_open` is `False` and the whole `and` chain short-circuits — **every Staff user can read every other employee's worklogs and dashboard** by changing the `member_id` query parameter. A write-period flag must never appear in a read-authorization expression.

**(b) Type confusion.** `get_dashboard` ([app/worklogs.py:521-533](app/worklogs.py)) reads the param with `type=int` while `session['member_id']` holds the NVARCHAR value — `int != str` is unconditionally `True`, so the ownership comparison never matches even when the flag is off.

**Fix:** split the concerns. Authorization first, unconditionally; the flag governs only whether writes are accepted.

```python
requested = str(request.args.get('member_id') or '').strip()
own = str(session.get('member_id') or '').strip()
if session.get('role') not in ELEVATED_ROLES and requested != own:
    return jsonify({'error': 'Permission denied'}), 403
```

**Related, same file:** `update_worklog` ([app/worklogs.py:380-394](app/worklogs.py)) correctly verifies the *existing* row's owner at line 387 — but then takes `member_id` straight from the request body at line 394 without validating it against that owner, and uses it in the overlap query at lines 427-428. A Staff user can edit their own row while reassigning it to another employee. Validate the incoming `member_id` against the row owner, or ignore it entirely for non-elevated users. (This is CLAUDE.md drift item #2, still open.)

## 3.3 HIGH — stored XSS, three sinks

Worklog and project text is attacker-controllable by any authenticated user and renders in **every** viewer's browser, including admins. Payload persists in the database.

| # | Location | Sink |
|---|---|---|
| 1 | [static/app/worklogs.js:203](static/app/worklogs.js) | `onclick='editWorklog(${JSON.stringify(w)})'` — the whole worklog object is interpolated raw into an inline handler. `JSON.stringify` escapes for *JSON*, not for HTML attributes; a `'` or `</script` in any field breaks out. **Most severe of the three.** |
| 2 | [static/app/worklogs.js:212](static/app/worklogs.js) | `title="${esc(w.project_description \|\| w.project \|\| '')}"` — `esc()` does not escape `"`, so the attribute is escapable. |
| 3 | [static/app/settings.js:172,183,187](static/app/settings.js) | `onclick="openChangeRoleModal(${u.id}, '${esc(u.username)}', '${u.role}')"` — `esc()` inside single quotes (doesn't escape `'`), and `${u.role}` has **no escaping at all**. |

**Amplifier:** there is **no Content-Security-Policy header** (§3.5), so nothing blocks injected inline script from executing or exfiltrating.

**Second vector:** [app/files.py:545](app/files.py) — `?inline=1` serves any file with its stored MIME type instead of forcing a download. Upload an `.html` or `.svg`, share the inline link, and it executes same-origin against the victim's session. Restrict inline rendering to a safe MIME allowlist (images and PDF), or serve user files from a separate origin.

## 3.4 Database access — clean

| Check | Result |
|---|---|
| Parameterized queries throughout | Pass |
| String-concatenated user input in SQL | None found |
| Dynamic identifiers | 4 sites, all code-controlled — see §2.1 |
| Credentials in source | None — env vars, Windows Auth by default |
| Connection handling | Thread-local, validated, auto-reconnect ([db.py](db.py)) |
| Least privilege | **Not verified** — confirm the service account is not `sysadmin`/`db_owner` (see §4.1) |

The one fragility worth tracking: `_upsert_security_state()` builds column names by f-string. It is safe as written, but it is the single place where a careless future edit turns into injection. Add a column whitelist.

## 3.5 MEDIUM

1. **No security headers.** [app/__init__.py:66-84](app/__init__.py) sets only `Cache-Control` and `Vary`. Missing: `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Strict-Transport-Security`. CSP in particular would have blunted §3.3.
2. **Raw exceptions returned to clients** — [app/files.py:499,733,781](app/files.py), [app/avatars.py:154,179](app/avatars.py). Leaks filesystem paths and driver internals.
3. **Public, unthrottled employee enumeration** — [app/auth.py:226](app/auth.py) `/api/employee-lookup` has no auth by design (used by the registration form), and the rate-limiting TODO at line 235 was never implemented. The full employee directory can be walked.
4. **File share has no per-user permissions** — [app/files.py:702](app/files.py) `bulk_download` even documents it: *"No permission filter — any logged-in user can download any file."* "Classified" is a single Staff-vs-elevated bit, not access control.
5. **No password policy** — no minimum length, complexity, or breach check at registration or reset.
6. **No rate limiting on any API endpoint** except login. Password reset has a cooldown; nothing else is bounded.
7. **Audit log is spoofable** — `_log_security_event` ([app/auth.py:383](app/auth.py)) records the IP from `X-Forwarded-For`, which the client controls. Behind ngrok/Tailscale you must take the *last* hop from a trusted proxy, not the first value.
8. **Config drift between the installer and the docs** — four values disagree, and the first one has a direct security consequence: an operator following the documented hardening applies the ACL lockdown to the **wrong drive**, leaving real user files unprotected.

   | Item | CLAUDE.md says | [install-service.bat](install-service.bat) sets |
   |---|---|---|
   | Storage root | `D:\MeterWorklog_Storage` | `E:\MeterWorklog_Storage` (:40-41) |
   | Database name | `MeterWorklog` | `MWLTimesheet` (:20) |
   | ngrok binary | `ngrokv3\ngrok.exe` | `deployer\ngrok.exe` (:14) |
   | Storage pool cap | 20480 MB (code default) | 614400 MB (:43) |

## 3.6 LOW

1. `SameSite=Lax` could be `Strict` — the app has no cross-site entry flows.
2. No session idle timeout or absolute lifetime; sessions persist until the cookie expires or `SECRET_KEY` rotates.
3. Successful logins are not written to the security event log — only failures. Halves the value of the log during an incident.
4. `cachetools>=7.1.6` in [requirements.txt](requirements.txt) has no upper bound; `pytest` and `pytest-mock` are unpinned. (CLAUDE.md drift #13 claims this was fixed and pinned `<6.0` — **the doc is stale**, the file says otherwise.)
5. Duplicate escape helpers `esc()` / `_psEsc()` — consolidate into `core.js` (CLAUDE.md drift #15).
6. [static/app.js.bak](static/app.js.bak) — 1226-line legacy monolith still tracked. Delete.
7. `logintest/` contains stale committed SQL helpers that duplicate SETUP.txt. Clean up.

---

# Part 4 — Operations

## 4.1 Remediation backlog, in order

| # | Action | Sev |
|---|---|-----|
| 1 | Rotate `SECRET_KEY`; blank the `install-service.bat` default | CRITICAL |
| 2 | Revoke + reissue the ngrok authtoken; blank the default | CRITICAL |
| 3 | Change or remove the seeded admin; drop the `INSERT` from `init_db.sql` | CRITICAL |
| 4 | Remove `_worklog_open` from all three read-authorization checks | HIGH |
| 5 | Normalize `EmployeeID` to `str().strip()` on both sides everywhere | HIGH |
| 6 | Fix the three XSS sinks; consolidate on a quote-safe escaper | HIGH |
| 7 | Validate `member_id` in `update_worklog` against the row owner | HIGH |
| 8 | Add security headers, CSP first | MEDIUM |
| 9 | Replace raw exception responses with generic messages | MEDIUM |
| 10 | Rate-limit `/api/employee-lookup` (and ideally all `/api/*`) | MEDIUM |
| 11 | Restrict `?inline=1` to an image/PDF MIME allowlist | MEDIUM |
| 12 | Add a password policy (12+ chars minimum) | MEDIUM |
| 13 | Align storage paths between `install-service.bat` and CLAUDE.md §10a | MEDIUM |

## 4.2 Deployment hardening

- Storage **must** live outside the project root, on a separate volume, so a redeploy cannot delete user data.
- Lock the storage ACL to the service account only (run as Administrator, and **use the path that `install-service.bat` actually sets** — see §3.5 item 8):

  ```batch
  :: NOTE: the installer currently sets E:\ — use the path it actually configures,
  :: not the D:\ path CLAUDE.md §10a documents. Confirm with: nssm get MeterWorklog AppEnvironmentExtra
  icacls "E:\MeterWorklog_Storage" /reset
  icacls "E:\MeterWorklog_Storage" /grant:r "NT AUTHORITY\SYSTEM:(OI)(CI)F"
  icacls "E:\MeterWorklog_Storage" /inheritance:r
  icacls "E:\MeterWorklog_Storage"
  ```

- The installer does **not** create the storage directories — `mkdir` them before the first upload or uploads fail with no Flask log entry.
- Keep `WAITRESS_MAX_REQUEST_BODY` ≥ `FILE_UPLOAD_MAX_MB * 1024 * 1024`, or Waitress rejects uploads before Flask ever sees them.
- `FLASK_DEBUG` must be empty in production. Debug mode exposes the Werkzeug console.
- Verify the SQL Server login used by the app is **not** `sysadmin` or `db_owner`. Grant only `SELECT/INSERT/UPDATE/DELETE` on the `MeterWorklog` schema.
- Confirm `SESSION_COOKIE_SECURE` resolved to `True` in production — it auto-enables only when `NGROK_DOMAIN` or `TAILSCALE_DOMAIN` is set.

## 4.3 Backups

Files, database, and code have different value and different recovery paths — back them up separately.

- **Database** — nightly, tested restores. This is the irreplaceable asset.
- **Storage** (`E:\MeterWorklog_Storage\` as installed) — nightly to NAS/external, 30+ day retention.
- **Code** — git; rebuildable, lowest priority.

Stop the service before restoring files, re-verify ACLs after, then restart and check `logs\app.log` and `logs\app-error.log`.

## 4.4 Incident response

1. **Suspected session forgery or leaked `SECRET_KEY`** → rotate `SECRET_KEY` immediately and restart. Every session dies; everyone re-logs in.
2. **Suspected account compromise** → set the user's `status` to `Declined` in `users`, then investigate.
3. **Reading the audit log** → `user_security_state` and the security event log are the starting points, but treat the recorded IP as untrusted (§3.5 item 7), and remember **successful logins are not recorded** (§3.6 item 3).
4. **Service logs** — `logs\app.log`, `logs\app-error.log`, `logs\ngrok.log`, rotated at 5 MB. Pull them before they roll.

## 4.5 Pre-commit checklist

- [ ] `git diff --cached` reviewed for keys, tokens, passwords, connection strings
- [ ] No new secret in any `.bat`, `.sql`, or `.py`
- [ ] All new SQL parameterized
- [ ] Row-ownership checks on any employee-scoped endpoint, independent of feature flags
- [ ] Frontend rendering uses the context-correct escaper (§2.6)
- [ ] No `console.log` or debug output left behind
- [ ] No raw exception text returned to clients

---

*Findings verified by direct source review on 2026-08-07. No secret values are reproduced in this document — every finding is cited by file and line. Re-audit after the Part 0 items are closed.*
