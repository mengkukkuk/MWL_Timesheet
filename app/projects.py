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
from .cache import cached_list
from .cache import invalidate
from .constants import ELEVATED_ROLES
from .helpers import format_member_ids
from .helpers import parse_member_ids

projects_bp = Blueprint('projects', __name__)
PROJECT_MEMBER_COLUMN_WHITELIST = {'main': 'main_members', 'support': 'support_members'}

def _load_projects():
    """Build the projects list. Pulled out so cached_list can call it lazily."""
    return app_pkg.db.query(
        'SELECT id, name, Description AS "Description", main_members, support_members '
        'FROM projects ORDER BY name'
    )

def _load_projects_description():
    """Load project description, Department and status"""
    return app_pkg.db.query(
        'SELECT Projectcode AS "Projectcode", Description AS "Description", '
        '       ProjectDepartment AS "ProjectDepartment", Status AS "Status" '
        'FROM ProjectAndBudget ORDER BY ProjectDepartment'
    )


@projects_bp.route('/api/projects', methods=['GET'])
@login_required
def get_projects():
    return jsonify(cached_list('projects:list', _load_projects))

@projects_bp.route('/api/description', methods=['GET'])
@login_required
def get_projects_description():
    return jsonify(cached_list('projects_description:list', _load_projects_description))

#Improve for add project description, status, department, budget
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
        "INSERT INTO projects (name) {OUTPUT_ID} VALUES (?) {RETURNING_ID}",
        (name,),
    )
    invalidate('projects:')
    return jsonify({'id': project_id, 'name': name}), 201


@projects_bp.route('/api/projects/<int:pid>', methods=['DELETE'])
@elevated_required
def delete_project(pid):
    app_pkg.db.execute("DELETE FROM projects WHERE id=?", (pid,))
    invalidate('projects:')
    return jsonify({'ok': True})


@projects_bp.route('/api/members/<mid>/project-roles', methods=['GET'])
@login_required
def get_member_project_roles(mid):
    """Given an EmployeeID, return the {main, support} projects they belong to.

    Path param `mid` is an EmployeeID (post-migration the rest of the app refers
    to employees as `member_id` for backward compat).
    """
    mid = mid.strip()
    # Validate the employee exists in HR
    emp = app_pkg.db.query(
        "SELECT EmployeeID, EmployeeName FROM Employee WHERE EmployeeID=?",
        (mid,), fetchone=True,
    )
    if not emp:
        return jsonify({'error': 'member not found'}), 404

    # Push the membership filter into SQL via a lateral JSON-array expansion so
    # we only return rows the employee actually belongs to, instead of fetching
    # every project and filtering in Python. The expanded value column is text
    # on both engines — compare directly.
    sql = f"""
        SELECT id, name, 'main' AS role_type
        FROM projects
        {app_pkg.db.json_members('main_members')}
        WHERE main_members IS NOT NULL AND j.value = ?
        UNION ALL
        SELECT id, name, 'support' AS role_type
        FROM projects
        {app_pkg.db.json_members('support_members')}
        WHERE support_members IS NOT NULL AND j.value = ?
        ORDER BY name
    """
    rows = app_pkg.db.query(sql, (mid, mid))
    main_list, support_list = [], []
    for r in rows:
        entry = {'id': r['id'], 'name': r['name']}
        (main_list if r['role_type'] == 'main' else support_list).append(entry)
    return jsonify({'main': main_list, 'support': support_list})


def _modify_project_member(pid, employee_id, role_type, action):
    """Shared body for assign/unassign. action ∈ {'add', 'remove'}."""
    if role_type not in ('main', 'support'):
        return jsonify({'error': 'type must be main or support'}), 400
    # Normalise both sides of the self-assign check: session['member_id'] holds
    # the NVARCHAR EmployeeID (string) and may still carry legacy trailing
    # whitespace on older logins, while `employee_id` is already str-stripped
    # by the caller. Compare as stripped strings so staff can assign themselves.
    sess_mid = session.get('member_id')
    sess_mid_str = str(sess_mid).strip() if sess_mid is not None else None
    if (session['role'] not in ELEVATED_ROLES
            and sess_mid_str != employee_id):
        return jsonify({'error': 'permission denied'}), 403

    # Validate Employee exists
    emp = app_pkg.db.query(
        "SELECT EmployeeID FROM Employee WHERE EmployeeID=?",
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

    # Normalise current list to strings (EmployeeID is NVARCHAR)
    current = []
    for raw in parse_member_ids(project[column_name]):
        val = str(raw).strip()
        if val:
            current.append(val)

    if action == 'add':
        if employee_id not in current:
            current.append(employee_id)
    else:  # remove
        current = [eid for eid in current if eid != employee_id]

    app_pkg.db.execute(
        f"UPDATE projects SET {column_name}=? WHERE id=?",
        (format_member_ids(current), pid),
    )
    invalidate('projects:')
    return jsonify({'ok': True})


@projects_bp.route('/api/projects/<int:pid>/assign', methods=['POST'])
@login_required
def assign_project_role(pid):
    data = request.json or {}
    employee_id = data.get('member_id')   # frontend still uses key `member_id`; value is EmployeeID
    role_type = data.get('type')
    if employee_id is None:
        return jsonify({'error': 'member_id is required'}), 400
    return _modify_project_member(pid, str(employee_id).strip(), role_type, 'add')


@projects_bp.route('/api/projects/<int:pid>/unassign', methods=['POST'])
@login_required
def unassign_project_role(pid):
    data = request.json or {}
    employee_id = data.get('member_id')
    role_type = data.get('type')
    if employee_id is None:
        return jsonify({'error': 'member_id is required'}), 400
    return _modify_project_member(pid, str(employee_id).strip(), role_type, 'remove')
