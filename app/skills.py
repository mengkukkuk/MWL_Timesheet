"""Member skills CRUD.

Each member can have unlimited named skills with a level 1-5.
Permissions: any member (or elevated) can edit their own skills;
elevated roles can edit anyone's.
"""
from flask import Blueprint
from flask import jsonify
from flask import request
from flask import session

import app as app_pkg

from .auth import login_required
from .constants import ELEVATED_ROLES

skills_bp = Blueprint('skills', __name__)

MAX_NAME_LEN = 120


def _can_edit(member_id):
    if session.get('role') in ELEVATED_ROLES:
        return True
    # Compare as stripped strings: member_id here is the NVARCHAR EmployeeID
    # (string), same as session['member_id'] — and old sessions may still
    # carry the legacy trailing-whitespace pad. Normalise both sides so staff
    # can edit their own skills.
    sess = session.get('member_id')
    if sess is None or member_id is None:
        return False
    return str(sess).strip() == str(member_id).strip()


def _validate_payload(data):
    """Return (name, level) or (error_message, None)."""
    name = (data.get('name') or '').strip()
    if not name:
        return 'Skill name is required', None
    if len(name) > MAX_NAME_LEN:
        return f'Skill name must be {MAX_NAME_LEN} characters or fewer', None
    try:
        level = int(data.get('level'))
    except (TypeError, ValueError):
        return 'Skill level must be an integer', None
    if level < 1 or level > 5:
        return 'Skill level must be between 1 and 5', None
    return name, level


@skills_bp.route('/api/skills', methods=['GET'])
@login_required
def get_all_skills():
    """Return all skills keyed by EmployeeID. Frontend continues to use the
    key name `member_id` opaquely — the value here is EmployeeID."""
    rows = app_pkg.db.query(
        'SELECT id, EmployeeID AS "EmployeeID", name, level FROM member_skills '
        'WHERE EmployeeID IS NOT NULL ORDER BY level DESC, name'
    )
    grouped = {}
    for row in rows:
        grouped.setdefault(row['EmployeeID'], []).append({
            'id': row['id'],
            'name': row['name'],
            'level': row['level'],
        })
    return jsonify(grouped)


@skills_bp.route('/api/members/<mid>/skills', methods=['GET'])
@login_required
def get_member_skills(mid):
    """Path param `mid` is an EmployeeID."""
    mid = mid.strip()
    emp = app_pkg.db.query(
        "SELECT EmployeeID FROM Employee WHERE EmployeeID=?",
        (mid,), fetchone=True,
    )
    if not emp:
        return jsonify({'error': 'member not found'}), 404
    rows = app_pkg.db.query(
        "SELECT id, name, level FROM member_skills WHERE EmployeeID=? ORDER BY level DESC, name",
        (mid,),
    )
    return jsonify(rows)


@skills_bp.route('/api/members/<mid>/skills', methods=['POST'])
@login_required
def create_member_skill(mid):
    """Path param `mid` is an EmployeeID."""
    mid = mid.strip()
    if not _can_edit(mid):
        return jsonify({'error': 'permission denied'}), 403

    emp = app_pkg.db.query(
        "SELECT EmployeeID FROM Employee WHERE EmployeeID=?",
        (mid,), fetchone=True,
    )
    if not emp:
        return jsonify({'error': 'member not found'}), 404

    data = request.json or {}
    result, level = _validate_payload(data)
    if level is None:
        return jsonify({'error': result}), 400
    name = result

    existing = app_pkg.db.query(
        "SELECT id FROM member_skills WHERE EmployeeID=? AND name=?",
        (mid, name),
        fetchone=True,
    )
    if existing:
        return jsonify({'error': 'Skill with this name already exists for the member'}), 409

    # EmployeeID is authoritative. The legacy member_id column is nullable after
    # migration and must not receive EmployeeID values because it used to FK to
    # members.id, which is a different key space.
    skill_id = app_pkg.db.execute(
        "INSERT INTO member_skills (member_id, EmployeeID, name, level) "
        "{OUTPUT_ID} VALUES (?, ?, ?, ?) {RETURNING_ID}",
        (None, mid, name, level),
    )
    return jsonify({'id': skill_id, 'member_id': mid, 'name': name, 'level': level}), 201


@skills_bp.route('/api/skills/<int:sid>', methods=['PUT'])
@login_required
def update_skill(sid):
    skill = app_pkg.db.query(
        'SELECT id, EmployeeID AS "EmployeeID", name FROM member_skills WHERE id=?', (sid,), fetchone=True,
    )
    if not skill:
        return jsonify({'error': 'skill not found'}), 404
    if not _can_edit(skill['EmployeeID']):
        return jsonify({'error': 'permission denied'}), 403

    data = request.json or {}
    result, level = _validate_payload(data)
    if level is None:
        return jsonify({'error': result}), 400
    name = result

    # Prevent rename collisions on (EmployeeID, name)
    if name != skill['name']:
        clash = app_pkg.db.query(
            "SELECT id FROM member_skills WHERE EmployeeID=? AND name=? AND id<>?",
            (skill['EmployeeID'], name, sid),
            fetchone=True,
        )
        if clash:
            return jsonify({'error': 'Skill with this name already exists for the member'}), 409

    app_pkg.db.execute(
        "UPDATE member_skills SET name=?, level=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
        (name, level, sid),
    )
    return jsonify({
        'id': sid, 'member_id': skill['EmployeeID'], 'name': name, 'level': level
    })


@skills_bp.route('/api/skills/<int:sid>', methods=['DELETE'])
@login_required
def delete_skill(sid):
    skill = app_pkg.db.query(
        'SELECT id, EmployeeID AS "EmployeeID" FROM member_skills WHERE id=?', (sid,), fetchone=True,
    )
    if not skill:
        return jsonify({'error': 'skill not found'}), 404
    if not _can_edit(skill['EmployeeID']):
        return jsonify({'error': 'permission denied'}), 403

    app_pkg.db.execute("DELETE FROM member_skills WHERE id=?", (sid,))
    return jsonify({'ok': True})
