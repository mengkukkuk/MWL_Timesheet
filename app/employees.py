"""Employee directory CRUD against dbo.Employee.

This blueprint replaces the local `members` table as the source of truth for
the Settings → Team Members panel. The rest of the app still uses the
`members` table during the phased migration (see MIGRATION_PLAN.md).

API contract: the JSON shape mimics the legacy /api/members shape so the
existing settings.js render code works with minimal changes:
    {id, name, department, staff_id, position, level, jg}

`id` is populated with the business key `EmployeeID` (NOT the surrogate
`Employee.ID`) — that's what the rest of the world refers to as "Employee ID"
and what users type into the create-account form.
"""
from flask import Blueprint
from flask import jsonify
from flask import request

import app as app_pkg

from .auth import elevated_required
from .auth import login_required
from .cache import cached_list
from .cache import invalidate

employees_bp = Blueprint('employees', __name__)

# Field length caps — match dbo.Employee column definitions
MAX_NAME_LEN  = 150
MAX_DEPT_LEN  = 100
MAX_POS_LEN   = 100
MAX_LEVEL_LEN = 10
MAX_JG_LEN    = 20


def _avatar_url(r):
    """Return None when no avatar; else the API path with a cache-busting
    `?v=<epoch>` so updates invalidate the browser cache automatically."""
    if not r.get('AvatarPath'):
        return None
    ts = r.get('AvatarUpdatedAt')
    v = int(ts.timestamp()) if ts is not None else 0
    return f"/api/avatars/{r['EmployeeID']}?v={v}"


def _row_to_dto(r):
    """Shape an Employee row for the frontend. Stays compatible with the
    existing settings.js renderer (which expects id/name/department/staff_id/position)."""
    return {
        'id':         r['EmployeeID'],          # business key surfaces as `id`
        'name':       r['EmployeeName'],
        'department': r['Department'],
        'staff_id':   str(r['EmployeeID']),     # alias for legacy renderer
        'position':   r['Position'],
        'level':      r['Level'],
        'jg':         r['JG'],
        'avatar_url': _avatar_url(r),
    }


def _validate_employee_id(raw):
    """Return (employee_id_str, error_str). employee_id_str is None on error.

    EmployeeID is a varchar(5) business key, not an integer — validate shape
    (digits, non-empty) without coercing to int, so the value round-trips as
    a plain string on both DB engines (MSSQL implicitly casts str==int, but
    Postgres raises 42883 on that comparison).
    """
    if raw is None or str(raw).strip() == '':
        return None, 'Employee ID is required'
    eid = str(raw).strip()
    if not eid.isdigit():
        return None, 'Employee ID must be a number'
    if int(eid) <= 0:
        return None, 'Employee ID must be positive'
    return eid, None


def _load_employees():
    """Build the employee DTO list. Pulled out so cached_list can call it lazily."""
    rows = app_pkg.db.query(
        """SELECT EmployeeID AS "EmployeeID", EmployeeName AS "EmployeeName",
                  Department AS "Department", Position AS "Position",
                  Level AS "Level", JG AS "JG",
                  AvatarPath AS "AvatarPath", AvatarUpdatedAt AS "AvatarUpdatedAt"
           FROM Employee
           ORDER BY EmployeeName"""
    )
    return [_row_to_dto(r) for r in rows]


def _invalidate_employee_caches():
    """dbo.Employee feeds BOTH /api/employees and /api/members — drop both."""
    invalidate('employees:')
    invalidate('members:')


@employees_bp.route('/api/employees', methods=['GET'])
@login_required
def list_employees():
    return jsonify(cached_list('employees:list', _load_employees))


@employees_bp.route('/api/employees', methods=['POST'])
@elevated_required
def create_employee():
    data = request.json or {}
    name      = (data.get('name') or '').strip()
    dept      = (data.get('department') or '').strip()
    position  = (data.get('position') or '').strip()
    level     = (data.get('level') or '').strip()
    jg        = (data.get('jg') or '').strip()
    # The frontend re-uses the "staff_id" field name to carry the EmployeeID
    raw_eid   = data.get('staff_id') or data.get('employee_id')

    if not name:
        return jsonify({'error': 'Name is required'}), 400
    if len(name) > MAX_NAME_LEN:
        return jsonify({'error': f'Name must be {MAX_NAME_LEN} characters or fewer'}), 400
    if dept and len(dept) > MAX_DEPT_LEN:
        return jsonify({'error': f'Department must be {MAX_DEPT_LEN} characters or fewer'}), 400
    if position and len(position) > MAX_POS_LEN:
        return jsonify({'error': f'Position must be {MAX_POS_LEN} characters or fewer'}), 400
    if level and len(level) > MAX_LEVEL_LEN:
        return jsonify({'error': f'Level must be {MAX_LEVEL_LEN} characters or fewer'}), 400
    if jg and len(jg) > MAX_JG_LEN:
        return jsonify({'error': f'JG must be {MAX_JG_LEN} characters or fewer'}), 400

    eid, err = _validate_employee_id(raw_eid)
    if err:
        return jsonify({'error': err}), 400

    # Reject duplicate EmployeeID (UQ_Employee_EmpID would also catch
    # we want a clean 409 instead of a generic DB error).
    existing = app_pkg.db.query(
        "SELECT EmployeeID FROM Employee WHERE EmployeeID=?",
        (eid,),
        fetchone=True,
    )
    if existing:
        return jsonify({'error': f'EmployeeID {eid} already exists'}), 409

    app_pkg.db.execute(
        """INSERT INTO Employee
               (EmployeeID, EmployeeName, Department, Position, Level, JG, CreateAt)
           VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)""",
        (eid, name, dept or None, position or None, level or None, jg or None),
    )
    _invalidate_employee_caches()
    return jsonify({
        'id': eid,
        'name': name,
        'department': dept or None,
        'staff_id': str(eid),
        'position': position or None,
        'level': level or None,
        'jg': jg or None,
    }), 201


@employees_bp.route('/api/employees/<eid>', methods=['PUT'])
@elevated_required
def update_employee(eid):
    """Update mutable fields. EmployeeID itself is immutable (it's a stable
    business key referenced by users and worklogs)."""
    eid = eid.strip()
    existing = app_pkg.db.query(
        "SELECT EmployeeID FROM Employee WHERE EmployeeID=?",
        (eid,),
        fetchone=True,
    )
    if not existing:
        return jsonify({'error': 'employee not found'}), 404

    data = request.json or {}
    name      = (data.get('name') or '').strip()
    dept      = (data.get('department') or '').strip()
    position  = (data.get('position') or '').strip()
    level     = (data.get('level') or '').strip()
    jg        = (data.get('jg') or '').strip()

    if not name:
        return jsonify({'error': 'Name is required'}), 400
    if len(name) > MAX_NAME_LEN:
        return jsonify({'error': f'Name must be {MAX_NAME_LEN} characters or fewer'}), 400
    if dept and len(dept) > MAX_DEPT_LEN:
        return jsonify({'error': f'Department must be {MAX_DEPT_LEN} characters or fewer'}), 400
    if position and len(position) > MAX_POS_LEN:
        return jsonify({'error': f'Position must be {MAX_POS_LEN} characters or fewer'}), 400
    if level and len(level) > MAX_LEVEL_LEN:
        return jsonify({'error': f'Level must be {MAX_LEVEL_LEN} characters or fewer'}), 400
    if jg and len(jg) > MAX_JG_LEN:
        return jsonify({'error': f'JG must be {MAX_JG_LEN} characters or fewer'}), 400

    app_pkg.db.execute(
        """UPDATE Employee
              SET EmployeeName=?, Department=?, Position=?, Level=?, JG=?, UpdateAt=CURRENT_TIMESTAMP
            WHERE EmployeeID=?""",
        (name, dept or None, position or None, level or None, jg or None, eid),
    )
    _invalidate_employee_caches()
    return jsonify({
        'id': eid,
        'name': name,
        'department': dept or None,
        'staff_id': str(eid),
        'position': position or None,
        'level': level or None,
        'jg': jg or None,
    })


@employees_bp.route('/api/employees/<eid>', methods=['DELETE'])
@elevated_required
def delete_employee(eid):
    eid = eid.strip()
    existing = app_pkg.db.query(
        "SELECT EmployeeID FROM Employee WHERE EmployeeID=?",
        (eid,),
        fetchone=True,
    )
    if not existing:
        return jsonify({'error': 'employee not found'}), 404

    # Soft safety check: warn if any user account is linked to this EmployeeID.
    # We don't BLOCK the delete — admin owns the decision — but surface the count.
    linked = app_pkg.db.query(
        "SELECT COUNT(*) AS n FROM users WHERE EmployeeID=?",
        (eid,),
        fetchone=True,
    )
    linked_count = (linked or {}).get('n', 0)

    app_pkg.db.execute("DELETE FROM Employee WHERE EmployeeID=?", (eid,))
    _invalidate_employee_caches()

    return jsonify({
        'ok': True,
        'linked_member_rows': linked_count,
        'warning': (
            f'{linked_count} member row(s) still reference this EmployeeID. '
            'Consider cleaning them up via Settings → Users.'
        ) if linked_count else None,
    })
