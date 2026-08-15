"""Allowance blueprint — daily allowance entries per employee, per project.

Table: Allowance
    [ID (PK identity), log_date, EmployeeID, ProjectCode, Description, type,
     createdAt, updatedAt, IsEditRow]

Semantics:
    - `Description` is the human-readable project name (matches Worklogs).
    - `ProjectCode` is the mapped code, resolved from ProjectAndBudget on
      INSERT/UPDATE (same pattern as worklogs.py).
    - `type` is one of {'Normal', 'Special'}.
    - `IsEditRow` is a BIT row-lock flag:
          * 1 (default) → row is editable
          * 0           → row is locked. PUT/DELETE return 403.
            The frontend hides edit/delete UI but the API also enforces this.
"""

import calendar
from datetime import date, datetime

from flask import Blueprint
from flask import jsonify
from flask import request
from flask import session

import app as app_pkg

from .auth import login_required
from .constants import ELEVATED_ROLES

allowance_bp = Blueprint('allowance', __name__)
VALID_TYPES = {'Normal', 'Special'}


def _serialize_row(row):
    """Normalize a DB row dict for JSON output."""
    if row.get('log_date'):
        if isinstance(row['log_date'], (date, datetime)):
            row['log_date'] = row['log_date'].strftime('%Y-%m-%d')
        else:
            row['log_date'] = str(row['log_date'])
    for ts_col in ('createdAt', 'updatedAt'):
        v = row.get(ts_col)
        if v is None:
            continue
        if isinstance(v, datetime):
            row[ts_col] = v.isoformat(sep=' ', timespec='seconds')
        else:
            row[ts_col] = str(v)
    if row.get('IsEditRow') is not None:
        # cast bit → int so JS can do `Number(a.IsEditRow) === 1`
        try:
            row['IsEditRow'] = int(row['IsEditRow'])
        except (TypeError, ValueError):
            row['IsEditRow'] = 1
    return row


# ────────────────────────────────────────────────────────────────────────────
# GET /api/allowance?member_id=<EmployeeID>&year=Y&month=M
# ────────────────────────────────────────────────────────────────────────────
@allowance_bp.route('/api/allowance', methods=['GET'])
@login_required
def get_allowance():
    employee_id = request.args.get('member_id')   # value is EmployeeID (string)
    year  = request.args.get('year',  type=int, default=date.today().year)
    month = request.args.get('month', type=int, default=date.today().month)

    if not employee_id:
        return jsonify({'error': 'member_id required'}), 400

    # Same visibility rule as worklogs: when worklog_open is false, non-elevated
    # users can only see their own data.
    if (not app_pkg._worklog_open
            and session.get('role') not in ELEVATED_ROLES
            and employee_id != session.get('member_id')):
        return jsonify({'error': 'Permission denied'}), 403

    first_day = date(year, month, 1)
    last_day  = date(year, month, calendar.monthrange(year, month)[1])

    rows = app_pkg.db.query(
        """
        SELECT ID AS "ID", log_date, EmployeeID AS "EmployeeID",
               ProjectCode AS "ProjectCode", Description AS "Description", type,
               CreateAt AS "CreateAt", UpdateAt AS "UpdateAt", IsEditRow AS "IsEditRow"
        FROM Allowance
        WHERE EmployeeID = ? AND log_date BETWEEN ? AND ?
        ORDER BY log_date
        """,
        (employee_id, first_day, last_day),
    )

    return jsonify([_serialize_row(r) for r in rows])

def _is_holiday(log_date) -> bool:
    """Return True if log_date (YYYY-MM-DD string or date) is in holiday or saturday/sunday"""
    row = app_pkg.db.query(
        'SELECT 1 AS hit FROM holiday WHERE "date"=?',
        (log_date,), fetchone=True,
    )
    if not row:
        date_obj = datetime.strptime(log_date, "%Y-%m-%d")
        if date_obj.weekday() in [5, 6]:
            return True
        else:
            return False
    return bool(row)

# ────────────────────────────────────────────────────────────────────────────
# POST /api/allowance
# Body: { log_date, project (Description), type, member_id (EmployeeID) }
# ────────────────────────────────────────────────────────────────────────────
@allowance_bp.route('/api/allowance', methods=['POST'])
@login_required
def create_allowance():
    data = request.json or {}
    project   = (data.get('project') or '').strip()
    log_date  = (data.get('log_date') or '').strip()
    al_type   = (data.get('type') or '').strip()

    if not project:
        return jsonify({'error': 'Project is required'}), 400
    if len(project) > 500:
        return jsonify({'error': 'Project name must be 500 characters or fewer'}), 400
    #if al_type not in VALID_TYPES:
    #    return jsonify({'error': 'Invalid type (must be Normal or Special)'}), 400
    if not log_date:
        return jsonify({'error': 'log_date is required'}), 400
    try:
        datetime.strptime(log_date, '%Y-%m-%d')
    except ValueError:
        return jsonify({'error': 'Invalid date format, expected YYYY-MM-DD'}), 400

    # member_id payload carries EmployeeID. Non-elevated users can only write
    # their own allowance — force the target to their own EmployeeID.
    target_employee = data.get('member_id')
    if session['role'] not in ELEVATED_ROLES:
        target_employee = session['member_id']

    if not target_employee:
        return jsonify({'error': 'member_id is required'}), 400
    target_employee = str(target_employee).strip()
    if not target_employee.isdigit():
        return jsonify({'error': 'member_id must be a number'}), 400

    # Validate the target employee exists.
    emp = app_pkg.db.query(
        "SELECT EmployeeID FROM Employee WHERE EmployeeID=?",
        (target_employee,), fetchone=True,
    )
    if not emp:
        return jsonify({'error': 'Employee not found'}), 404

    #check if log_date is already exist
    exist_row = app_pkg.db.query(
        "SELECT ID FROM Allowance WHERE EmployeeID=? AND log_date=?",
        (target_employee, log_date), fetchone=True,
    )
    if exist_row:
        return jsonify({'error': 'log_date already exist'}), 400

    # Mapping Description → ProjectCode (mirrors worklogs.py).
    project_code = None
    mapp = app_pkg.db.query(
        "SELECT ProjectCode FROM ProjectAndBudget WHERE Description=?",
        (project,), fetchone=True,
    )
    if mapp:
        project_code = mapp.get('ProjectCode')

    # Check if log_date is holiday/sat/sun convert al_type to 'S', else 'N'
    al_type = 'S' if _is_holiday(log_date) else 'N'

    # Do NOT specify IsEditRow → DB default (1) applies, new rows are editable.
    new_id = app_pkg.db.execute(
        """
        INSERT INTO Allowance
            (log_date, EmployeeID, ProjectCode, Description, type)
            {OUTPUT_ID}
        VALUES (?, ?, ?, ?, ?)
            {RETURNING_ID}
        """,
        (log_date, target_employee, project_code, project, al_type),
    )
    return jsonify({'id': new_id}), 201


# ────────────────────────────────────────────────────────────────────────────
# PUT /api/allowance/<aid>
# ────────────────────────────────────────────────────────────────────────────
@allowance_bp.route('/api/allowance/<int:aid>', methods=['PUT'])
@login_required
def update_allowance(aid):
    # Fetch row to check permissions + lock status.
    row = app_pkg.db.query(
        'SELECT EmployeeID AS "EmployeeID", IsEditRow AS "IsEditRow" FROM Allowance WHERE ID=?',
        (aid,), fetchone=True,
    )
    if not row:
        return jsonify({'error': 'Allowance not found'}), 404

    # Own-data check (same pattern as worklogs.update_worklog).
    if session['role'] not in ELEVATED_ROLES:
        if str(row['EmployeeID']) != str(session['member_id']):
            return jsonify({'error': 'You can only edit your own allowance'}), 403

    # Row-lock guard.
    try:
        is_editable = int(row['IsEditRow']) == 1
    except (TypeError, ValueError):
        is_editable = True   # safe default if column is NULL
    if not is_editable:
        return jsonify({'error': 'This row is locked and cannot be edited'}), 403

    data = request.json or {}
    project  = (data.get('project') or '').strip()
    log_date = (data.get('log_date') or '').strip()
    al_type  = (data.get('type') or '').strip()

    if not project:
        return jsonify({'error': 'Project is required'}), 400
    if len(project) > 500:
        return jsonify({'error': 'Project name must be 500 characters or fewer'}), 400
    #if al_type not in VALID_TYPES:
    #    return jsonify({'error': 'Invalid type (must be Normal or Special)'}), 400
    if not log_date:
        return jsonify({'error': 'log_date is required'}), 400
    try:
        datetime.strptime(log_date, '%Y-%m-%d')
    except ValueError:
        return jsonify({'error': 'Invalid date format, expected YYYY-MM-DD'}), 400

    # Re-resolve ProjectCode from Description.
    project_code = None
    mapp = app_pkg.db.query(
        "SELECT ProjectCode FROM ProjectAndBudget WHERE Description=?",
        (project,), fetchone=True,
    )
    if mapp:
        project_code = mapp.get('ProjectCode')

    #check if log_date is already exist
    exist_row = app_pkg.db.query(
        "SELECT ID FROM Allowance WHERE ID<>? AND log_date=?",
        (aid, log_date), fetchone=True,
    )
    if exist_row:
        return jsonify({'error': 'log_date already exist'}), 400

    al_type = 'S' if _is_holiday(log_date) else 'N'

    app_pkg.db.execute(
        """
        UPDATE Allowance
           SET log_date=?, ProjectCode=?, Description=?, type=?, UpdateAt=CURRENT_TIMESTAMP
         WHERE ID=?
        """,
        (log_date, project_code, project, al_type, aid),
    )
    return jsonify({'ok': True})


# ────────────────────────────────────────────────────────────────────────────
# DELETE /api/allowance/<aid>
# ────────────────────────────────────────────────────────────────────────────
@allowance_bp.route('/api/allowance/<int:aid>', methods=['DELETE'])
@login_required
def delete_allowance(aid):
    row = app_pkg.db.query(
        'SELECT EmployeeID AS "EmployeeID", IsEditRow AS "IsEditRow" FROM Allowance WHERE ID=?',
        (aid,), fetchone=True,
    )
    if not row:
        return jsonify({'error': 'Allowance not found'}), 404

    if session['role'] not in ELEVATED_ROLES:
        if str(row['EmployeeID']) != str(session['member_id']):
            return jsonify({'error': 'You can only delete your own allowance'}), 403

    try:
        is_editable = int(row['IsEditRow']) == 1
    except (TypeError, ValueError):
        is_editable = True
    if not is_editable:
        return jsonify({'error': 'This row is locked and cannot be deleted'}), 403

    app_pkg.db.execute("DELETE FROM Allowance WHERE ID=?", (aid,))
    return jsonify({'ok': True})
