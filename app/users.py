from flask import Blueprint
from flask import jsonify
from flask import request
from flask import session
from werkzeug.security import generate_password_hash

import app as app_pkg

from .auth import admin_required
from .auth import elevated_required
from .auth import login_required
from .constants import ASSIGNABLE_ROLES
from .constants import ROLE_ADMIN
from .constants import ROLE_LEADER
from .constants import ROLE_SUPER_ADMIN
from .helpers import EMAIL_RE
from .helpers import cascade_delete_employee

users_bp = Blueprint('users', __name__)


@users_bp.route('/api/me', methods=['GET'])
@login_required
def api_me():
    # session['member_id'] now stores the user's EmployeeID (post-migration).
    # The key name is preserved for frontend backward-compat.
    return jsonify({
        'id': session['user_id'],
        'username': session['username'],
        'role': session['role'],
        'member_id': session['member_id'],
    })


@users_bp.route('/api/users', methods=['GET'])
@elevated_required
def get_users():
    # Display the linked employee's name from the HR-authoritative table.
    rows = app_pkg.db.query(
        """SELECT u.id, u.username, u.role,
                  u.EmployeeID AS member_id,            -- alias for frontend compat
                  u.status,
                  u.email,
                  e.EmployeeName AS member_name,
                  e.Department AS "Department",
                  e.Position AS "Position"
           FROM users u
           LEFT JOIN Employee e ON u.EmployeeID = e.EmployeeID
           ORDER BY u.role, u.username""",
    )
    return jsonify(rows or [])


# ── Account approvals ──

@users_bp.route('/api/users/pending', methods=['GET'])
@elevated_required
def list_pending_users():
    """Pending registrations awaiting approval. Includes employee preview for context."""
    rows = app_pkg.db.query(
        """SELECT u.id, u.username, u.created_at,
                  u.EmployeeID AS member_id,                  -- alias for frontend compat
                  e.EmployeeName AS member_name,
                  e.Department    AS department,
                  u.EmployeeID    AS staff_id,
                  e.Position      AS position
           FROM users u
           LEFT JOIN Employee e ON u.EmployeeID = e.EmployeeID
           WHERE u.status = 'Pending'
           ORDER BY u.created_at ASC""",
    )
    return jsonify(rows or [])


@users_bp.route('/api/users/pending/count', methods=['GET'])
@elevated_required
def pending_users_count():
    """Lightweight count for UI badge polling."""
    row = app_pkg.db.query(
        "SELECT COUNT(*) AS c FROM users WHERE status = 'Pending'",
        fetchone=True,
    )
    return jsonify({'count': int(row['c']) if row else 0})


@users_bp.route('/api/users/<int:uid>/approve', methods=['POST'])
@elevated_required
def approve_user(uid):
    target = app_pkg.db.query(
        "SELECT id, status, role FROM users WHERE id=?", (uid,), fetchone=True
    )
    if not target:
        return jsonify({'error': 'User not found'}), 404
    if target['role'] == ROLE_SUPER_ADMIN:
        return jsonify({'error': 'Super admin cannot be re-approved'}), 403
    if uid == session['user_id']:
        return jsonify({'error': 'Cannot approve your own account'}), 400
    if target['status'] == 'Active':
        return jsonify({'ok': True, 'already_active': True})
    app_pkg.db.execute(
        """UPDATE users
              SET status='Active', reviewed_by=?, reviewed_at=CURRENT_TIMESTAMP
              WHERE id=?""",
        (session['user_id'], uid),
    )
    return jsonify({'ok': True, 'status': 'Active'})


@users_bp.route('/api/users/<int:uid>/decline', methods=['POST'])
@elevated_required
def decline_user(uid):
    """Mark account as Declined (kept for audit, never logs in)."""
    target = app_pkg.db.query(
        "SELECT id, status, role FROM users WHERE id=?", (uid,), fetchone=True
    )
    if not target:
        return jsonify({'error': 'User not found'}), 404
    if target['role'] == ROLE_SUPER_ADMIN:
        return jsonify({'error': 'Super admin cannot be declined'}), 403
    if uid == session['user_id']:
        return jsonify({'error': 'Cannot decline your own account'}), 400
    app_pkg.db.execute(
        """UPDATE users
              SET status='Declined', reviewed_by=?, reviewed_at=CURRENT_TIMESTAMP
              WHERE id=?""",
        (session['user_id'], uid),
    )
    return jsonify({'ok': True, 'status': 'Declined'})


@users_bp.route('/api/users/<int:uid>/role', methods=['PUT'])
@admin_required
def change_user_role(uid):
    data = request.json or {}
    new_role = data.get('role', '').strip()
    if new_role not in ASSIGNABLE_ROLES:
        return jsonify({'error': 'Invalid role'}), 400
    target = app_pkg.db.query("SELECT role FROM users WHERE id=?", (uid,), fetchone=True)
    if not target:
        return jsonify({'error': 'User not found'}), 404
    if target['role'] == ROLE_SUPER_ADMIN:
        return jsonify({'error': 'Cannot change Super Admin role'}), 403
    if uid == session['user_id']:
        return jsonify({'error': 'Cannot change your own role'}), 400
    app_pkg.db.execute("UPDATE users SET role=? WHERE id=?", (new_role, uid))
    return jsonify({'ok': True})


@users_bp.route('/api/users/<int:uid>/password', methods=['PUT'])
@admin_required
def reset_user_password(uid):
    data = request.json or {}
    password = data.get('password', '')
    if len(password) < 8:
        return jsonify({'error': 'Password must be at least 8 characters'}), 400
    target = app_pkg.db.query("SELECT id FROM users WHERE id=?", (uid,), fetchone=True)
    if not target:
        return jsonify({'error': 'User not found'}), 404
    app_pkg.db.execute(
        "UPDATE users SET password_hash=? WHERE id=?",
        (generate_password_hash(password), uid),
    )
    return jsonify({'ok': True})


@users_bp.route('/api/users/<int:uid>/email', methods=['PUT'])
@elevated_required
def set_user_email(uid):
    """Set or clear a user's email (used for password-reset links)."""
    data = request.json or {}
    email = (data.get('email') or '').strip()
    if email and (len(email) > 255 or not EMAIL_RE.match(email)):
        return jsonify({'error': 'Invalid email address'}), 400

    target = app_pkg.db.query("SELECT role FROM users WHERE id=?", (uid,), fetchone=True)
    if not target:
        return jsonify({'error': 'User not found'}), 404
    if target['role'] == ROLE_SUPER_ADMIN and uid != session['user_id']:
        return jsonify({'error': "Cannot edit a Super admin's email"}), 403
    if session['role'] == ROLE_LEADER and target['role'] == ROLE_ADMIN:
        return jsonify({'error': "Insufficient privileges to edit an Admin's email"}), 403

    app_pkg.db.execute("UPDATE users SET email=? WHERE id=?", (email or None, uid))
    return jsonify({'ok': True, 'email': email or None})


@users_bp.route('/api/users/<int:uid>', methods=['DELETE'])
@elevated_required
def delete_user(uid):
    if uid == session['user_id']:
        return jsonify({'error': 'Cannot delete your own account'}), 400

    target = app_pkg.db.query(
        'SELECT role, EmployeeID AS "EmployeeID" FROM users WHERE id=?', (uid,), fetchone=True
    )
    if not target:
        return jsonify({'error': 'User not found'}), 404
    if target['role'] == ROLE_SUPER_ADMIN:
        return jsonify({'error': 'Super admin cannot be deleted'}), 403
    if session['role'] == ROLE_LEADER and target['role'] == ROLE_ADMIN:
        return jsonify({'error': 'Insufficient privileges to delete an Admin'}), 403

    employee_id = target['EmployeeID']
    app_pkg.db.execute("DELETE FROM users WHERE id=?", (uid,))
    if employee_id:
        cascade_delete_employee(app_pkg.db, employee_id)

    # Frontend expects `member_id` key — keep contract; value is EmployeeID
    return jsonify({'ok': True, 'member_id': employee_id})
