"""Legacy /api/members blueprint — now backed by dbo.Employee.

Post-migration, this blueprint is kept ONLY for the GET endpoint, which the
rest of the frontend (`loadMembers()` in core.js) still calls to populate the
global `members` array. The shape mimics the legacy contract but the `id`
field is now `EmployeeID` (the business key), so all downstream queries by
member_id/employee_id resolve against dbo.Employee directly.

POST/PUT/DELETE here are deliberately disabled — admin CRUD now goes through
/api/employees (employees_bp) instead.
"""
from flask import Blueprint
from flask import jsonify

import app as app_pkg

from .auth import login_required
from .cache import cached_list

members_bp = Blueprint('members', __name__)


def _avatar_url(row):
    """Build a cache-busted avatar endpoint URL from Employee avatar fields."""
    if not row.get('AvatarPath'):
        return None
    ts = row.get('AvatarUpdatedAt')
    version = int(ts.timestamp()) if ts is not None else 0
    return f"/api/avatars/{row['id']}?v={version}"


def _load_members():
    """Build the team roster list. Pulled out so cached_list can call it lazily."""
    rows = app_pkg.db.query(
        """SELECT EmployeeID  AS id,
                  EmployeeName AS name,
                  Department  AS department,
                  EmployeeID  AS staff_id,
                  Position    AS position,
                  Level       AS level,
                  JG          AS jg,
                  AvatarPath  AS "AvatarPath",
                  AvatarUpdatedAt AS "AvatarUpdatedAt"
           FROM Employee
           ORDER BY EmployeeName"""
    )
    for row in rows:
        row['avatar_url'] = _avatar_url(row)
        row.pop('AvatarPath', None)
        row.pop('AvatarUpdatedAt', None)
    return rows


@members_bp.route('/api/members', methods=['GET'])
@login_required
def get_members():
    """Return the team roster shaped like legacy /api/members.

    `id` = `EmployeeID` (business key — used as the worklog/skill member_id).
    Result is memoized in app.cache for 5 minutes; invalidation is driven by
    write paths in employees.py (POST/PUT/DELETE /api/employees).
    """
    return jsonify(cached_list('members:list', _load_members))


@members_bp.route('/api/members', methods=['POST'])
@members_bp.route('/api/members/<int:mid>', methods=['PUT', 'DELETE'])
@login_required
def members_write_disabled(mid=None):
    """Member writes are no longer allowed here — use /api/employees instead.

    Returns 410 Gone with a hint so any forgotten frontend caller surfaces
    a clean error instead of silently succeeding against the dead members table.
    """
    return jsonify({
        'error': 'This endpoint is deprecated. Use /api/employees for member management.',
        'replacement': '/api/employees',
    }), 410
