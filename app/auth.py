import hashlib
import json
import secrets

from datetime import datetime
from datetime import timedelta
from functools import wraps

from flask import Blueprint
from flask import current_app
from flask import jsonify
from flask import redirect
from flask import render_template
from flask import request
from flask import session
from werkzeug.security import check_password_hash
from werkzeug.security import generate_password_hash

import app as app_pkg

from .constants import ELEVATED_ROLES
from .constants import ROLE_STAFF
from .constants import ROLE_SUPER_ADMIN
from .helpers import EMAIL_RE
from .mail import MailError
from .mail import build_reset_email
from .mail import send_email

auth_bp = Blueprint('auth', __name__)
FAILED_LOGINS_DB_KEY = 'failed_logins'


def _load_failed_logins_from_db():
    row = app_pkg.db.query(
        "SELECT value FROM settings WHERE [key]=?",
        (FAILED_LOGINS_DB_KEY,),
        fetchone=True,
    )
    if not row or not row.get('value'):
        return {}

    raw = json.loads(row['value'])
    parsed = {}
    for key, value in raw.items():
        if not isinstance(value, dict):
            continue
        count = int(value.get('count', 0))
        window_start_raw = value.get('window_start')
        locked_until_raw = value.get('locked_until')
        if not window_start_raw:
            continue
        try:
            window_start = datetime.fromisoformat(window_start_raw)
            locked_until = datetime.fromisoformat(locked_until_raw) if locked_until_raw else None
        except ValueError:
            continue
        parsed[key] = {
            'count': count,
            'window_start': window_start,
            'locked_until': locked_until,
        }
    return parsed


def _save_failed_logins_to_db():
    payload = {}
    for key, value in app_pkg._failed_logins.items():
        payload[key] = {
            'count': int(value.get('count', 0)),
            'window_start': value['window_start'].isoformat(),
            'locked_until': value['locked_until'].isoformat() if value.get('locked_until') else None,
        }
    raw = json.dumps(payload, separators=(',', ':'))
    existing = app_pkg.db.query(
        "SELECT [key] FROM settings WHERE [key]=?",
        (FAILED_LOGINS_DB_KEY,),
        fetchone=True,
    )
    if existing:
        app_pkg.db.execute(
            "UPDATE settings SET value=? WHERE [key]=?",
            (raw, FAILED_LOGINS_DB_KEY),
        )
    else:
        app_pkg.db.execute(
            "INSERT INTO settings ([key], value) VALUES (?, ?)",
            (FAILED_LOGINS_DB_KEY, raw),
        )


def login_required(view):
    @wraps(view)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            if request.path.startswith('/api/'):
                return jsonify({'error': 'login required'}), 401
            return redirect('/login')
        return view(*args, **kwargs)

    return decorated


def admin_required(view):
    @wraps(view)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            if request.path.startswith('/api/'):
                return jsonify({'error': 'login required'}), 401
            return redirect('/login')
        if session.get('role') != ROLE_SUPER_ADMIN:
            return jsonify({'error': 'admin access required'}), 403
        return view(*args, **kwargs)

    return decorated


def elevated_required(view):
    @wraps(view)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            if request.path.startswith('/api/'):
                return jsonify({'error': 'login required'}), 401
            return redirect('/login')
        if session.get('role') not in ELEVATED_ROLES:
            return jsonify({'error': 'admin access required'}), 403
        return view(*args, **kwargs)

    return decorated


@auth_bp.route('/login')
def login_page():
    if 'user_id' in session:
        return redirect('/')
    return render_template('login.html')


@auth_bp.route('/api/login', methods=['POST'])
def api_login():
    data = request.json or {}
    username = data.get('username', '').strip()
    password = data.get('password', '')
    if not username or not password:
        return jsonify({'error': 'Username and password required'}), 400

    key = username.lower()
    now = datetime.now()

    with app_pkg._login_lock:
        app_pkg._failed_logins = _load_failed_logins_from_db()
        record = app_pkg._failed_logins.get(key)

        if record and record.get('locked_until') and now < record['locked_until']:
            remaining = int((record['locked_until'] - now).total_seconds())
            mins, secs = divmod(remaining, 60)
            time_str = f"{mins}m {secs}s" if mins else f"{secs}s"
            return jsonify({
                'error': f"Too many failed attempts. Try again in {time_str}.",
                'locked_for_seconds': remaining,
            }), 429

        if record and (now - record['window_start']) > app_pkg.LOGIN_WINDOW:
            del app_pkg._failed_logins[key]
            _save_failed_logins_to_db()

    user = app_pkg.db.query(
        # `member_id` aliased from EmployeeID — the value we put into the session.
        # Frontend session/api/me contract continues to use the key `member_id`.
        "SELECT id, username, password_hash, role, "
        "       EmployeeID AS member_id, status "
        "FROM users WHERE username=?",
        (username,),
        fetchone=True,
    )
    password_ok = bool(user and check_password_hash(user['password_hash'], password))

    with app_pkg._login_lock:
        app_pkg._failed_logins = _load_failed_logins_from_db()
        if not password_ok:
            if key not in app_pkg._failed_logins:
                app_pkg._failed_logins[key] = {'count': 0, 'window_start': now, 'locked_until': None}
            app_pkg._failed_logins[key]['count'] += 1
            _save_failed_logins_to_db()

            if app_pkg._failed_logins[key]['count'] >= app_pkg.MAX_LOGIN_ATTEMPTS:
                app_pkg._failed_logins[key]['locked_until'] = now + app_pkg.LOGIN_LOCKOUT
                _save_failed_logins_to_db()
                remaining = int(app_pkg.LOGIN_LOCKOUT.total_seconds())
                return jsonify({
                    'error': (
                        f"Account locked after {app_pkg.MAX_LOGIN_ATTEMPTS} failed attempts. "
                        "Try again in 5 minutes."
                    ),
                    'locked_for_seconds': remaining,
                }), 429

            attempts_left = app_pkg.MAX_LOGIN_ATTEMPTS - app_pkg._failed_logins[key]['count']
            return jsonify({
                'error': f"Invalid username or password. {attempts_left} attempt(s) remaining."
            }), 401

        app_pkg._failed_logins.pop(key, None)
        _save_failed_logins_to_db()

    # Gate by approval status — checked AFTER password verification so we don't
    # leak account existence to unauthenticated callers (no enumeration channel).
    status = (user.get('status') or 'Active') if isinstance(user, dict) else 'Active'
    if status == 'Pending':
        return jsonify({
            'error': 'pending_approval',
            'message': 'Your account is awaiting approval by an administrator.',
        }), 403
    if status == 'Declined':
        return jsonify({
            'error': 'declined',
            'message': 'Your account has been declined. Please contact an administrator.',
        }), 403

    session['user_id'] = user['id']
    session['username'] = user['username']
    session['role'] = user['role']
    session['member_id'] = user['member_id']
    return jsonify({'ok': True, 'role': user['role'], 'member_id': user['member_id']})


@auth_bp.route('/api/employee-lookup/<emp_id>', methods=['GET'])
def api_employee_lookup(emp_id):
    """Public endpoint used by the registration form to preview an EmployeeID
    before submitting. Returns minimal HR data (name/department/position).
    Returns 404 if EmployeeID isn't in dbo.Employee.

    NOTE: this endpoint is intentionally public (no auth) because it's used on
    the registration page before the user has a session. To prevent enumeration
    abuse, it returns ONLY the basic profile fields and is rate-limited at the
    proxy layer (TODO: add rate limiting).
    """
    emp_id = emp_id.strip()
    if not emp_id:
        return jsonify({'error': 'invalid EmployeeID'}), 400
    row = app_pkg.db.query(
        "SELECT EmployeeID, EmployeeName, Department, Position FROM dbo.Employee WHERE EmployeeID=?",
        (emp_id,),
        fetchone=True,
    )
    if not row:
        return jsonify({'error': 'not_found'}), 404
    # Also flag if this EmployeeID is already linked to an existing user
    # (so the form can warn early instead of waiting for register to fail).
    taken = app_pkg.db.query(
        "SELECT id FROM users WHERE EmployeeID=? AND status<>'Declined'",
        (emp_id,),
        fetchone=True,
    )
    return jsonify({
        'employee_id': row['EmployeeID'],
        'name':        row['EmployeeName'],
        'department':  row['Department'] or '',
        'position':    row['Position'] or '',
        'taken':       bool(taken),
    })


@auth_bp.route('/api/register', methods=['POST'])
def api_register():
    """Registration is now driven by EmployeeID:
    user supplies username + password + EmployeeID; name/department/position
    are pulled from dbo.Employee (the HR-authoritative table). The legacy
    name/department/position payload fields are still accepted as a fallback
    for callers that haven't been updated yet, but EmployeeID is preferred.
    """
    data = request.json or {}
    username = data.get('username', '').strip()
    password = data.get('password', '')
    email = (data.get('email') or '').strip()

    # New-style: EmployeeID is the source of truth
    raw_emp = data.get('employee_id', '')
    employee_id = None
    if raw_emp != '' and raw_emp is not None:
        employee_id = str(raw_emp).strip() or None

    # Legacy fallback (still supported until full migration completes)
    legacy_name       = data.get('name', '').strip()
    legacy_department = data.get('department', '').strip()
    legacy_staff_id   = data.get('staff_id', '').strip()
    legacy_position   = data.get('position', '').strip()

    if not username or not password:
        return jsonify({'error': 'Username and password are required'}), 400
    if len(username) > 50:
        return jsonify({'error': 'Username must be 50 characters or fewer'}), 400
    if len(password) < 8:
        return jsonify({'error': 'Password must be at least 8 characters'}), 400
    # Email is optional (used for password reset), but must look valid when given
    if email and (len(email) > 255 or not EMAIL_RE.match(email)):
        return jsonify({'error': 'Invalid email address'}), 400

    # Resolve member profile fields
    if employee_id is not None:
        emp = app_pkg.db.query(
            "SELECT EmployeeID, EmployeeName, Department, Position FROM dbo.Employee WHERE EmployeeID=?",
            (employee_id,),
            fetchone=True,
        )
        if not emp:
            return jsonify({'error': 'EmployeeID not found in HR records'}), 404
        # Reject if this EmployeeID is already claimed by an active or pending user
        already_linked = app_pkg.db.query(
            "SELECT id, status FROM users WHERE EmployeeID=?",
            (employee_id,),
            fetchone=True,
        )
        if already_linked and already_linked.get('status') != 'Declined':
            return jsonify({'error': 'This EmployeeID is already linked to another account'}), 409
    else:
        # Legacy fallback removed — EmployeeID is now mandatory.
        return jsonify({'error': 'EmployeeID is required'}), 400

    existing = app_pkg.db.query("SELECT id FROM users WHERE username=?", (username,), fetchone=True)
    if existing:
        return jsonify({'error': 'Username already taken'}), 409

    # Post-migration: users.EmployeeID is authoritative. members.id is no longer
    # written for new accounts (members table is read-only legacy storage).
    app_pkg.db.execute(
        "INSERT INTO users (username, password_hash, role, EmployeeID, status, email) VALUES (?, ?, ?, ?, ?, ?)",
        (username, generate_password_hash(password), ROLE_STAFF, employee_id, 'Pending', email or None),
    )
    return jsonify({
        'ok': True,
        'pending': True,
        'message': 'Account created. An administrator must approve it before you can log in.',
    }), 201


# ── Email-based password reset ──────────────────────────────────────────────
# Flow: POST /api/forgot-password (username) → email a single-use link →
# GET /reset-password (page) → POST /api/reset-password/verify (UX check) →
# POST /api/reset-password/confirm (token + new password).
# Only a sha256 of the token is stored (user_security_state.reset_token_hash).

GENERIC_FORGOT_RESPONSE = {
    'ok': True,
    'message': 'If the account exists and has an email on file, a reset link has been sent.',
}


def _token_hash(token):
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def _upsert_security_state(user_id, **cols):
    """INSERT or UPDATE the user_security_state row for user_id with cols."""
    assignments = ', '.join(f'{col}=?' for col in cols)
    existing = app_pkg.db.query(
        "SELECT user_id FROM user_security_state WHERE user_id=?",
        (user_id,), fetchone=True,
    )
    if existing:
        app_pkg.db.execute(
            f"UPDATE user_security_state SET {assignments}, updated_at=GETDATE() WHERE user_id=?",
            (*cols.values(), user_id),
        )
    else:
        col_names = ', '.join(cols)
        placeholders = ', '.join('?' for _ in cols)
        app_pkg.db.execute(
            f"INSERT INTO user_security_state (user_id, {col_names}) VALUES (?, {placeholders})",
            (user_id, *cols.values()),
        )


def _base_url():
    """Public base URL for links in emails — APP_BASE_URL, else derived like the CSRF hook."""
    configured = current_app.config.get('APP_BASE_URL')
    if configured:
        return configured
    scheme = request.headers.get('X-Forwarded-Proto', request.scheme)
    host = request.headers.get('X-Forwarded-Host') or request.host
    return f'{scheme}://{host}'


def _log_security_event(user_id, username, event_type):
    try:
        ip = (request.headers.get('X-Forwarded-For', '').split(',')[0].strip()
              or request.remote_addr)
        app_pkg.db.execute(
            """INSERT INTO security_events (user_id, username, event_type, ip_address, user_agent)
               VALUES (?, ?, ?, ?, ?)""",
            (user_id, username, event_type, ip, (request.user_agent.string or '')[:500]),
        )
    except Exception:
        # Auditing must never break the user-facing flow.
        current_app.logger.warning('failed to write security_events row', exc_info=True)


@auth_bp.route('/api/forgot-password', methods=['POST'])
def api_forgot_password():
    data = request.json or {}
    username = data.get('username', '').strip()
    if not username:
        return jsonify({'error': 'Username is required'}), 400

    # Everything below returns the same generic 200 — never reveal whether the
    # account exists, has an email, is inactive, or is cooling down.
    user = app_pkg.db.query(
        """SELECT u.id, u.username, u.role, u.status, u.email,
                  s.last_reset_email_sent_at
           FROM users u
           LEFT JOIN user_security_state s ON s.user_id = u.id
           WHERE u.username = ?""",
        (username,), fetchone=True,
    )
    if (not user or not user.get('email') or user.get('status') != 'Active'
            or user.get('role') == ROLE_SUPER_ADMIN):
        return jsonify(GENERIC_FORGOT_RESPONSE)

    cooldown = current_app.config['RESET_EMAIL_COOLDOWN_SECONDS']
    last_sent = user.get('last_reset_email_sent_at')
    if last_sent and (datetime.now() - last_sent).total_seconds() < cooldown:
        return jsonify(GENERIC_FORGOT_RESPONSE)

    ttl_minutes = current_app.config['RESET_TOKEN_TTL_MINUTES']
    token = secrets.token_urlsafe(32)
    _upsert_security_state(
        user['id'],
        reset_token_hash=_token_hash(token),
        reset_token_expires_at=datetime.now() + timedelta(minutes=ttl_minutes),
        last_reset_email_sent_at=datetime.now(),
    )
    reset_url = f'{_base_url()}/reset-password?token={token}'
    subject, html_body, text_body = build_reset_email(user['username'], reset_url, ttl_minutes)
    try:
        send_email(user['email'], subject, html_body, text_body)
        _log_security_event(user['id'], user['username'], 'password_reset_requested')
    except MailError as exc:
        current_app.logger.warning('password-reset email send failed: %s', exc)
    return jsonify(GENERIC_FORGOT_RESPONSE)


@auth_bp.route('/reset-password')
def reset_password_page():
    return render_template('reset_password.html')


def _find_user_by_reset_token(token):
    return app_pkg.db.query(
        """SELECT s.user_id, u.username
           FROM user_security_state s
           JOIN users u ON u.id = s.user_id
           WHERE s.reset_token_hash = ?
             AND s.reset_token_expires_at > GETDATE()
             AND u.status = 'Active'
             AND u.role <> ?""",
        (_token_hash(token), ROLE_SUPER_ADMIN), fetchone=True,
    )


@auth_bp.route('/api/reset-password/verify', methods=['POST'])
def api_reset_password_verify():
    token = (request.json or {}).get('token', '')
    if not token:
        return jsonify({'valid': False})
    return jsonify({'valid': bool(_find_user_by_reset_token(token))})


@auth_bp.route('/api/reset-password/confirm', methods=['POST'])
def api_reset_password_confirm():
    data = request.json or {}
    token = data.get('token', '')
    password = data.get('password', '')
    if len(password) < 8:
        return jsonify({'error': 'Password must be at least 8 characters'}), 400

    match = _find_user_by_reset_token(token) if token else None
    if not match:
        return jsonify({'error': 'invalid_or_expired'}), 400

    app_pkg.db.execute(
        "UPDATE users SET password_hash=? WHERE id=?",
        (generate_password_hash(password), match['user_id']),
    )
    # Single-use: burn the token.
    app_pkg.db.execute(
        """UPDATE user_security_state
           SET reset_token_hash=NULL, reset_token_expires_at=NULL, updated_at=GETDATE()
           WHERE user_id=?""",
        (match['user_id'],),
    )
    # A successful reset also clears any login lockout for that username.
    with app_pkg._login_lock:
        app_pkg._failed_logins = _load_failed_logins_from_db()
        if app_pkg._failed_logins.pop(match['username'].lower(), None) is not None:
            _save_failed_logins_to_db()
    _log_security_event(match['user_id'], match['username'], 'password_reset_completed')
    return jsonify({'ok': True})


@auth_bp.route('/api/logout', methods=['POST'])
def api_logout():
    session.clear()
    return jsonify({'ok': True})
