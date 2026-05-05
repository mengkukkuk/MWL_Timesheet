"""Projects blueprint — post-migration: assignments stored as EmployeeID arrays.

`projects.main_members` and `projects.support_members` now hold JSON arrays of
EmployeeID integers (e.g. `"[33546, 33547]"`). All assignment logic operates
in EmployeeID space; resolving display names (Thai EmployeeName) for the
project-roles UI is done via JOIN to dbo.Employee on the way out.
"""
from flask import Blueprint
from flask import jsonify
from flask import request
from flask import session

import app as app_pkg

from .auth import elevated_required
from .auth import login_required
from .constants import ELEVATED_ROLES
from .helpers import format_member_ids
from .helpers import parse_member_ids

projects_bp = Blueprint('projects', __name__)
PROJECT_MEMBER_COLUMN_WHITELIST = {'main': 'main_members', 'support': 'support_members'}


@projects_bp.route('/api/projects', methods=['GET'])
@login_required
def get_projects():
    rows = app_pkg.db.query(
        "SELECT id, name, main_members, support_members FROM projects ORDER BY name"
    )
    return jsonify(rows)


@projects_bp.route('/api/projects', methods=['POST'])
@elevated_required
def create_project():
    data = request.json or {}
    name = data.get('name', '').strip()
    if not name:
        return jsonify({'error': 'Project name is required'}), 400
    if len(name) > 200:
        return jsonify({'error': 'Project name must be 200 characters or fewer'}), 400
    project_id = app_pkg.db.execute(
        "INSERT INTO projects (name) OUTPUT INSERTED.id VALUES (?)",
        (name,),
    )
    return jsonify({'id': project_id, 'name': name}), 201


@projects_bp.route('/api/projects/<int:pid>', methods=['DELETE'])
@elevated_required
def delete_project(pid):
    app_pkg.db.execute("DELETE FROM projects WHERE id=?", (pid,))
    return jsonify({'ok': True})


@projects_bp.route('/api/members/<int:mid>/project-roles', methods=['GET'])
@login_required
def get_member_project_roles(mid):
    """Given an EmployeeID, return the {main, support} projects they belong to.

    Path param `mid` is an EmployeeID (post-migration the rest of the app refers
    to employees as `member_id` for backward compat).
    """
    # Validate the employee exists in HR
    emp = app_pkg.db.query(
        "SELECT EmployeeID, EmployeeName FROM dbo.Employee WHERE EmployeeID=?",
        (mid,), fetchone=True,
    )
    if not emp:
        return jsonify({'error': 'member not found'}), 404

    projects = app_pkg.db.query(
        "SELECT id, name, main_members, support_members FROM projects ORDER BY name"
    )

    def has_member(col_value, target_eid):
        ids = parse_member_ids(col_value)
        # IDs may be ints (new format) or strings (legacy un-migrated). Compare loosely.
        for raw in ids:
            try:
                if int(raw) == target_eid:
                    return True
            except (TypeError, ValueError):
                continue
        return False

    main_list = [
        {'id': p['id'], 'name': p['name']}
        for p in projects if has_member(p['main_members'], mid)
    ]
    support_list = [
        {'id': p['id'], 'name': p['name']}
        for p in projects if has_member(p['support_members'], mid)
    ]
    return jsonify({'main': main_list, 'support': support_list})


def _modify_project_member(pid, employee_id, role_type, action):
    """Shared body for assign/unassign. action ∈ {'add', 'remove'}."""
    if role_type not in ('main', 'support'):
        return jsonify({'error': 'type must be main or support'}), 400
    if (session['role'] not in ELEVATED_ROLES
            and session.get('member_id') != employee_id):
        return jsonify({'error': 'permission denied'}), 403

    # Validate Employee exists
    emp = app_pkg.db.query(
        "SELECT EmployeeID FROM dbo.Employee WHERE EmployeeID=?",
        (employee_id,), fetchone=True,
    )
    if not emp:
        return jsonify({'error': 'member not found'}), 404

    column_name = PROJECT_MEMBER_COLUMN_WHITELIST[role_type]
    project = app_pkg.db.query(
        f"SELECT {column_name} FROM projects WHERE id=?",
        (pid,), fetchone=True,
    )
    if not project:
        return jsonify({'error': 'project not found'}), 404

    # Normalise current list to ints
    current = []
    for raw in parse_member_ids(project[column_name]):
        try:
            current.append(int(raw))
        except (TypeError, ValueError):
            continue

    if action == 'add':
        if employee_id not in current:
            current.append(employee_id)
    else:  # remove
        current = [eid for eid in current if eid != employee_id]

    app_pkg.db.execute(
        f"UPDATE projects SET {column_name}=? WHERE id=?",
        (format_member_ids(current), pid),
    )
    return jsonify({'ok': True})


@projects_bp.route('/api/projects/<int:pid>/assign', methods=['POST'])
@login_required
def assign_project_role(pid):
    data = request.json or {}
    employee_id = data.get('member_id')   # frontend still uses key `member_id`; value is EmployeeID
    role_type = data.get('type')
    if employee_id is None:
        return jsonify({'error': 'member_id is required'}), 400
    return _modify_project_member(pid, int(employee_id), role_type, 'add')


@projects_bp.route('/api/projects/<int:pid>/unassign', methods=['POST'])
@login_required
def unassign_project_role(pid):
    data = request.json or {}
    employee_id = data.get('member_id')
    role_type = data.get('type')
    if employee_id is None:
        return jsonify({'error': 'member_id is required'}), 400
    return _modify_project_member(pid, int(employee_id), role_type, 'remove')
