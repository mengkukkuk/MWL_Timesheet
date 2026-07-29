import os
import threading

from datetime import timedelta
from flask import Flask
from flask import jsonify
from flask import request
from flask_compress import Compress
from urllib.parse import urlparse

import db

from .constants import ASSIGNABLE_ROLES
from .constants import ELEVATED_ROLES
from .constants import PROJECT_MEMBER_COLUMNS
from .constants import ROLE_ADMIN
from .constants import ROLE_LEADER
from .constants import ROLE_STAFF
from .constants import ROLE_SUPER_ADMIN
from .exports import MONTH_NAMES
from .exports import generate_excel_bytes
from .helpers import format_members
from .helpers import parse_members
from .helpers import parse_time

BASE_DIR = os.path.dirname(os.path.dirname(__file__))

_worklog_open = False
_login_lock = threading.Lock()
_db_init_lock = threading.Lock()
_failed_logins = {}
MAX_LOGIN_ATTEMPTS = 5
LOGIN_WINDOW = timedelta(minutes=15)
LOGIN_LOCKOUT = timedelta(minutes=5)

app = Flask(
    __name__,
    template_folder=os.path.join(BASE_DIR, 'templates'),
    static_folder=os.path.join(BASE_DIR, 'static'),
)

# ── Response compression ──────────────────────────────────────────────────────
# Gzip everything we serve over text-based MIME types (HTML, JSON, JS, CSS).
# Cuts /api/* JSON and /static/* asset payloads by ~70-80% with negligible CPU.
Compress(app)


def _static_version(filename):
    """Return mtime epoch for a file under static/, used as a cache-busting
    query string in templates so updated files invalidate browser caches
    automatically without a build step.

    Usage in Jinja: <link href="/static/style.css?v={{ static_v('style.css') }}">
    Returns 0 if the file does not exist (the URL still works; cache is just
    not busted on that request)."""
    full = os.path.join(BASE_DIR, 'static', filename.lstrip('/'))
    try:
        return int(os.path.getmtime(full))
    except OSError:
        return 0


app.jinja_env.globals['static_v'] = _static_version


# ── Vite manifest bridge ──────────────────────────────────────────────────────
# The React islands (login + dashboard) are built by Vite into static/react/
# with hashed filenames and a manifest. vite_asset('login'|'dashboard') reads
# that manifest and returns {'css': [urls], 'js': [urls]} for the entry, so the
# Jinja templates can inject the correct hashed tags. The parsed manifest is
# cached in module scope; set VITE_DEV=1 to force a re-read on every call while
# iterating locally. This is the only Vite-related backend change — no route or
# API logic is touched.
_VITE_MANIFEST_PATH = os.path.join(BASE_DIR, 'static', 'react', '.vite', 'manifest.json')
_VITE_BASE = '/static/react/'
_vite_manifest_cache = None


def _load_vite_manifest():
    global _vite_manifest_cache
    if _vite_manifest_cache is not None and not os.getenv('VITE_DEV'):
        return _vite_manifest_cache
    import json
    try:
        with open(_VITE_MANIFEST_PATH, encoding='utf-8') as fh:
            _vite_manifest_cache = json.load(fh)
    except (OSError, ValueError):
        _vite_manifest_cache = {}
    return _vite_manifest_cache


def _vite_asset(entry):
    """Resolve a Vite entry name ('login' | 'dashboard' | 'app') to its hashed
    asset URLs. Returns {'js': [...], 'css': [...]} with the entry chunk, its
    imported (shared) chunks, and all associated CSS, de-duplicated and in
    load order."""
    manifest = _load_vite_manifest()
    key = f'{entry}.html'
    node = manifest.get(key)
    if not node:
        # Manifest keys are the entry's *source file* (rollupOptions.input
        # value), not its input key — these only coincide by naming
        # convention (e.g. dashboard -> dashboard.html). The 'app' entry's
        # source is frontend/index.html (Vite's dev-server root file), so it
        # needs a fallback lookup by the manifest node's own `name` field.
        for candidate_key, candidate in manifest.items():
            if candidate.get('isEntry') and candidate.get('name') == entry:
                key, node = candidate_key, candidate
                break
    if not node:
        return {'js': [], 'css': []}
    js, css, seen = [], [], set()

    def add_chunk(chunk_key):
        if chunk_key in seen:
            return
        seen.add(chunk_key)
        chunk = manifest.get(chunk_key)
        if not chunk:
            return
        for imported in chunk.get('imports', []):
            add_chunk(imported)
        for css_file in chunk.get('css', []):
            url = _VITE_BASE + css_file
            if url not in css:
                css.append(url)
        if chunk.get('file'):
            js.append(_VITE_BASE + chunk['file'])

    add_chunk(key)
    return {'js': js, 'css': css}


app.jinja_env.globals['vite_asset'] = _vite_asset


@app.after_request
def _add_static_cache_headers(response):
    """Cache-Control for static assets and read-mostly API endpoints.

    /static/react/* and any /static/* URL carrying a ?v= cache-busting query
    (style.css, tailwind.css via static_v()) — long-cache (1y, immutable);
    the URL changes whenever the content does, so a year-long cache is safe.
    Other /static/* files (e.g. mwllogo.png, referenced bare with no ?v=) get
    a much shorter cache instead — marking an unversioned URL "immutable" for
    a year would strand a stale copy in every browser if that file is ever
    replaced, since nothing ever busts its URL.
    /api/avatars/* — private 1-day cache; URLs already carry ?v=<ts>.
    /api/members, /api/projects (GET) — short 60s private cache to absorb
    repeat hits from the SPA during a single page session. Server-side
    in-process TTL cache (app.cache) provides the deeper invalidatable
    layer; this header just trims repeat round-trips."""
    path = request.path
    if path.startswith('/static/react/') or (path.startswith('/static/') and 'v' in request.args):
        response.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    elif path.startswith('/static/'):
        response.headers['Cache-Control'] = 'public, max-age=86400, stale-while-revalidate=604800'
    elif path.startswith('/api/avatars/'):
        response.headers['Cache-Control'] = 'private, max-age=86400'
    elif path in ('/api/members', '/api/projects') and request.method == 'GET':
        response.headers['Cache-Control'] = 'private, max-age=60'
    response.headers.setdefault('Vary', 'Accept-Encoding')
    return response


_secret = os.getenv('SECRET_KEY')
if not _secret:
    raise RuntimeError(
        "SECRET_KEY environment variable is not set. "
        "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
    )

app.secret_key = _secret
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
# Cookie 'Secure' flag — explicit env wins; otherwise auto: ON when any HTTPS-fronted
# deployment is configured (NGROK_DOMAIN or TAILSCALE_DOMAIN), OFF for plain-HTTP LAN /
# raw Tailscale device IPs (so the session cookie isn't silently dropped by the browser).
_secure_env = os.getenv('SESSION_COOKIE_SECURE', '').strip().lower()
if _secure_env in ('true', '1', 'yes'):
    app.config['SESSION_COOKIE_SECURE'] = True
elif _secure_env in ('false', '0', 'no'):
    app.config['SESSION_COOKIE_SECURE'] = False
else:
    _has_https_front = bool(
        os.getenv('NGROK_DOMAIN', '').strip()
        or os.getenv('TAILSCALE_DOMAIN', '').strip()
    )
    app.config['SESSION_COOKIE_SECURE'] = _has_https_front

# File Share: caps & paths
# Per-upload limit — blocks one huge request.
_max_mb = int(os.getenv('FILE_UPLOAD_MAX_MB', '5120'))
app.config['MAX_CONTENT_LENGTH'] = _max_mb * 1024 * 1024
# File-share storage — can be moved to separate drive for backups/performance.
# Override with FILE_STORAGE_DIR env var if needed.
app.config['FILE_STORAGE_DIR'] = os.getenv('FILE_STORAGE_DIR') \
    or os.path.join(BASE_DIR, 'storage', 'files')
# Profile avatars — separate root from the file-share so backups/permissions
# can be managed independently. Override with AVATAR_STORAGE_DIR if needed.
app.config['AVATAR_STORAGE_DIR'] = os.getenv('AVATAR_STORAGE_DIR') \
    or os.path.join(BASE_DIR, 'storage', 'avatars')
# Global cap — total of SUM(files.size_bytes). Default 10 GB.
app.config['FILE_STORAGE_CAP_BYTES'] = int(os.getenv('FILE_STORAGE_CAP_MB', '20480')) * 1024 * 1024
# Free-disk floor — refuse uploads when free space on the storage volume drops below this.
app.config['FILE_MIN_FREE_BYTES'] = int(os.getenv('FILE_MIN_FREE_MB', '8192')) * 1024 * 1024

# Super Admin security thresholds
app.config['SUPER_ADMIN_MAX_ATTEMPTS']      = int(os.getenv('SUPER_ADMIN_MAX_LOGIN_ATTEMPTS', '3'))
app.config['SUPER_ADMIN_WINDOW']            = timedelta(minutes=int(os.getenv('SUPER_ADMIN_LOGIN_WINDOW_MINUTES', '15')))
app.config['SUPER_ADMIN_LOCKOUT']           = timedelta(minutes=int(os.getenv('SUPER_ADMIN_LOCKOUT_MINUTES', '30')))
app.config['SUPER_ADMIN_TOKEN_TTL']         = timedelta(minutes=int(os.getenv('SUPER_ADMIN_UNLOCK_TOKEN_MINUTES', '30')))
app.config['SUPER_ADMIN_EMAIL_COOLDOWN']    = int(os.getenv('SUPER_ADMIN_UNLOCK_EMAIL_COOLDOWN_SECONDS', '300'))

# SMTP / mail
app.config['SMTP_HOST']                     = os.getenv('SMTP_HOST', 'smtp.gmail.com')
app.config['SMTP_PORT']                     = int(os.getenv('SMTP_PORT', '587'))
app.config['SMTP_USERNAME']                 = os.getenv('SMTP_USERNAME', '')
app.config['SMTP_PASSWORD']                 = os.getenv('SMTP_PASSWORD', '')
app.config['MAIL_FROM']                     = os.getenv('MAIL_FROM', '')
app.config['SUPER_ADMIN_UNLOCK_EMAIL']      = os.getenv('SUPER_ADMIN_UNLOCK_EMAIL', '')
app.config['APP_BASE_URL']                  = os.getenv('APP_BASE_URL', '').rstrip('/')

def _is_same_origin(source_url, target_url):
    try:
        source = urlparse(source_url)
        target = urlparse(target_url)
    except ValueError:
        return False
    return source.scheme == target.scheme and source.netloc == target.netloc


@app.before_request
def ensure_db():
    if not getattr(app, '_db_initialized', False):
        with _db_init_lock:
            if getattr(app, '_db_initialized', False):
                return
            global _worklog_open
            try:
                db.init_db()
            except Exception as exc:
                print(f"DB init note: {exc}")
            try:
                row = db.query("SELECT value FROM settings WHERE [key]='worklog_open'", fetchone=True)
                if row:
                    _worklog_open = row['value'] == '1'
            except Exception as exc:
                print(f"Settings load note: {exc}")

            # Diagnostics: Check avatar storage directory on startup
            try:
                avatar_dir = app.config.get('AVATAR_STORAGE_DIR')
                app.logger.info(f"Avatar storage directory configured: {avatar_dir}")
                if os.path.exists(avatar_dir):
                    app.logger.info(f"Avatar storage directory exists")
                    try:
                        test_write = os.access(avatar_dir, os.W_OK)
                        if test_write:
                            app.logger.info(f"Avatar storage directory is writable")
                        else:
                            app.logger.warning(f"Avatar storage directory is NOT writable - permission denied")
                    except Exception as e:
                        app.logger.warning(f"Could not verify write permission for avatar storage: {e}")
                else:
                    app.logger.info(f"Avatar storage directory does not exist yet (will be created on first upload)")
            except Exception as exc:
                app.logger.error(f"Error checking avatar storage directory: {exc}", exc_info=True)

            app._db_initialized = True


@app.before_request
def verify_api_csrf_origin():
    if request.method in ('GET', 'HEAD', 'OPTIONS'):
        return None
    if not request.path.startswith('/api/'):
        return None

    # ── Build the set of trusted origins ────────────────────────────────────
    # When running behind ngrok / a reverse proxy / `tailscale serve`, the raw
    # request.host_url is always the local socket (e.g. http://localhost:5000/)
    # which never matches the browser's Origin header. We resolve this with
    # four layers:
    #
    #  1. X-Forwarded-Host    — set by ngrok and `tailscale serve`.
    #  2. NGROK_DOMAIN env    — explicit trust from .env, works even if the
    #                           proxy rewrites Host back to localhost.
    #  3. TAILSCALE_DOMAIN    — explicit trust for the tailnet HTTPS domain,
    #                           e.g. mypc.tail1234a.ts.net.
    #  4. request.host_url    — plain LAN / localhost access.

    forwarded_proto = request.headers.get('X-Forwarded-Proto', request.scheme)
    forwarded_host  = request.headers.get('X-Forwarded-Host') or request.host
    proxy_host_url  = f"{forwarded_proto}://{forwarded_host}/"
    trusted = {request.host_url, proxy_host_url}

    #trusted = {request.host_url}


    ngrok_domain = os.getenv('NGROK_DOMAIN', '').strip()
    if ngrok_domain:
        trusted.add(f"https://{ngrok_domain}/")
        trusted.add(f"http://{ngrok_domain}/")

    tailscale_domain = os.getenv('TAILSCALE_DOMAIN', '').strip()
    if tailscale_domain:
        # tailscale serve is HTTPS-only on the public side, but accept both for safety
        trusted.add(f"https://{tailscale_domain}/")
        trusted.add(f"http://{tailscale_domain}/")

    def _trusted(url):
        return any(_is_same_origin(url, t) for t in trusted)

    origin  = request.headers.get('Origin')
    referer = request.headers.get('Referer')

    if origin:
        if _trusted(origin):
            return None
        return jsonify({'error': 'CSRF validation failed'}), 403

    if referer and _trusted(referer):
        return None

    return jsonify({'error': 'CSRF validation failed'}), 403


from werkzeug.exceptions import RequestEntityTooLarge  # noqa: E402


@app.errorhandler(RequestEntityTooLarge)
def _upload_too_large(_exc):
    mb = app.config.get('MAX_CONTENT_LENGTH', 0) // (1024 * 1024)
    return jsonify({'error': f'File exceeds maximum size of {mb} MB'}), 413

from .allowance import allowance_bp  # noqa: E402
from .auth import auth_bp  # noqa: E402
from .avatars import avatars_bp  # noqa: E402
from .core import core_bp  # noqa: E402
from .employees import employees_bp  # noqa: E402
from .exports import export_bp  # noqa: E402
from .files import files_bp  # noqa: E402
from .members import members_bp  # noqa: E402
from .projects import projects_bp  # noqa: E402
from .skills import skills_bp  # noqa: E402
from .users import users_bp  # noqa: E402
from .worklogs import worklogs_bp  # noqa: E402

app.register_blueprint(auth_bp)
app.register_blueprint(avatars_bp)
app.register_blueprint(users_bp)
app.register_blueprint(core_bp)
app.register_blueprint(members_bp)
app.register_blueprint(employees_bp)
app.register_blueprint(projects_bp)
app.register_blueprint(skills_bp)
app.register_blueprint(worklogs_bp)
app.register_blueprint(allowance_bp)
app.register_blueprint(export_bp)
app.register_blueprint(files_bp)
