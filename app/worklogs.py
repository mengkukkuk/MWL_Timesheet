"""Worklogs blueprint — post-migration: keyed by EmployeeID (not members.id).

The query parameter `member_id` is preserved for frontend backward-compat,
but its VALUE now carries an EmployeeID (e.g. 33546). All SQL queries match
against `worklogs.EmployeeID`. The legacy `worklogs.member_id` column is
left in place but no longer authoritative.
"""
import calendar

from datetime import date
from datetime import datetime,time
from datetime import timedelta

from flask import Blueprint
from flask import jsonify
from flask import request
from flask import session

import app as app_pkg

from .auth import elevated_required
from .auth import login_required
from .constants import ELEVATED_ROLES

worklogs_bp = Blueprint('worklogs', __name__)
VALID_STATUSES = {'Done', 'In Progress', 'Pending', 'Man day', 'Leave'}

@worklogs_bp.route('/api/worklogs', methods=['GET'])
@login_required
def get_worklogs():
    employee_id = request.args.get('member_id')   # param name kept; value is EmployeeID (NVARCHAR string)
    year = request.args.get('year', type=int, default=date.today().year)
    month = request.args.get('month', type=int, default=date.today().month)

    if not employee_id:
        return jsonify({'error': 'member_id required'}), 400

    if (not app_pkg._worklog_open
            and session.get('role') not in ELEVATED_ROLES
            and employee_id != session.get('member_id')):
        return jsonify({'error': 'Permission denied'}), 403

    first_day = date(year, month, 1)
    last_day = date(year, month, calendar.monthrange(year, month)[1])

    rows = app_pkg.db.query(
        """
        SELECT w.id,
               w.EmployeeID  AS member_id,   -- alias preserved for frontend payload
               w.log_date, w.project, w.task,
               w.start_time, w.end_time,
               w.hours, w.regular_hours, w.OT1, w.OT1_5, w.OT3,
               w.status, w.note,
               COALESCE(w.IsEditRow, {TRUE}) AS "IsEditRow",
               COALESCE(w.is_allowance, {FALSE}) AS is_allowance,
               pb.Description AS project_description
        FROM worklogs w
        LEFT JOIN ProjectAndBudget pb
               ON pb.ProjectCode = w.project
        WHERE w.EmployeeID = ? AND w.log_date BETWEEN ? AND ?
        AND pb.Description = w.Description
        ORDER BY w.log_date
        """,
        (employee_id, first_day, last_day),
    )

    for row in rows:
        if row['log_date']:
            if isinstance(row['log_date'], (date, datetime)):
                row['log_date'] = row['log_date'].strftime('%Y-%m-%d')
            else:
                row['log_date'] = str(row['log_date'])
        for col in ('hours', 'regular_hours', 'OT1', 'OT1_5', 'OT3'):
            if row.get(col) is not None:
                row[col] = float(row[col])
        # `time` columns aren't JSON-serializable via Flask's default encoder.
        for tcol in ('start_time', 'end_time'):
            if isinstance(row.get(tcol), time):
                row[tcol] = row[tcol].strftime('%H:%M')
            elif row.get(tcol) is not None:
                row[tcol] = str(row[tcol])[:5]
        if row.get('IsEditRow') is not None:
            row['IsEditRow'] = int(row['IsEditRow'])
        else:
            row['IsEditRow'] = 1
        if row.get('is_allowance') is not None:
            row['is_allowance'] = int(row['is_allowance'])
        else:
            row['is_allowance'] = 0

    return jsonify(rows)

#Check holidays
@worklogs_bp.route('/api/holidays', methods=['GET'])
@login_required
def get_holiday():
    year = request.args.get('year', type=int, default=date.today().year)
    month = request.args.get('month', type=int, default=date.today().month)

    first_day = date(year, month, 1)
    last_day = date(year, month, calendar.monthrange(year, month)[1])

    holidays_rows = app_pkg.db.query("""
            SELECT "date", description
            FROM holiday WHERE "date" BETWEEN ? AND ?
        """,
        (first_day, last_day),fetchone=False)

    for hol in holidays_rows:
        if hol['date']:
            if isinstance(hol['date'], (date, datetime)):
                hol['date'] = hol['date'].strftime('%Y-%m-%d')
            else:
                hol['date'] = str(hol['date'])

    if not holidays_rows:
        return jsonify({'error': 'no holiday'}), 400
    return jsonify(holidays_rows)

#Check if the input time range is overlap with existed time range
def check_overlap(start_time, end_time, overlap_time):
    for i in range(len(overlap_time)):
        st = overlap_time[i]['start_time']
        et = overlap_time[i]['end_time']
        if (start_time <= st < end_time) or (start_time < et <= end_time) or (st < start_time and end_time < et):
            return True
    return False
def to_time(value):
    if isinstance(value, time):
        return value
    if isinstance(value, str):
        # supports "HH:MM" and "HH:MM:SS"
        for fmt in ("%H:%M:%S", "%H:%M"):
            try:
                return datetime.strptime(value.strip(), fmt).time()
            except ValueError:
                pass
    raise ValueError(f"Invalid time value: {value!r}")
#Check if the input time range is overlap with existed time range//

# ── Overtime calculation ───────────────────────────────────────────────────────
# Company rules:
#   Normal worktime    : 08:30 – 17:30
#   Lunch (excluded)   : 12:00 – 13:00
#   Holiday  → OT1  for work inside normal window (minus lunch)
#              OT3  for work outside normal window
#   Non-holiday → OT1_5 for work outside normal window
NORMAL_START = time(8, 30)
NORMAL_END   = time(17, 30)
LUNCH_START  = time(12, 0)
LUNCH_END    = time(13, 0)


def _minutes_between(a: time, b: time) -> int:
    if b <= a:
        return 0
    return (b.hour * 60 + b.minute) - (a.hour * 60 + a.minute)


def _overlap_minutes(s1: time, e1: time, s2: time, e2: time) -> int:
    """Whole minutes that two time ranges [s1,e1) and [s2,e2) overlap."""
    start = max(s1, s2)
    end   = min(e1, e2)
    return _minutes_between(start, end)


def _calc_overtime(start: time, end: time, is_holiday: bool) -> dict:
    """Compute OT1 / OT1_5 / OT3 in decimal hours for a single worklog entry."""
    normal_min = _overlap_minutes(start, end, NORMAL_START, NORMAL_END)
    lunch_in_normal = _overlap_minutes(
        max(start, NORMAL_START), min(end, NORMAL_END),
        LUNCH_START, LUNCH_END,
    )
    inside_normal = max(0, normal_min - lunch_in_normal)

    early_min = _overlap_minutes(start, end, time(0, 0), NORMAL_START)
    late_min  = _overlap_minutes(start, end, NORMAL_END, time(23, 59, 59))
    outside_normal = early_min + late_min

    if is_holiday:
        return {'OT1': inside_normal / 60.0, 'OT3': outside_normal / 60.0, 'OT1_5': 0.0}
    return {'OT1': 0.0, 'OT3': 0.0, 'OT1_5': outside_normal / 60.0}


def _is_holiday(log_date) -> bool:
    """Return True if log_date (YYYY-MM-DD string or date) is in holiday or saturday/sunday"""
    row = app_pkg.db.query(
        'SELECT 1 AS hit FROM holiday WHERE "date"=?',
        (log_date,), fetchone=True,
    )
    if not row:
        date_obj = datetime.strptime(log_date, "%Y-%m-%d")
        return True if date_obj.weekday() in [5, 6] else False
    return bool(row)

def _employee_jg_num(emp_id):
    """Return the numeric suffix of Employee.JG (e.g. 'JG06' -> 6), or None
    if unset or unparseable."""
    row = app_pkg.db.query(
        'SELECT JG AS "JG" FROM Employee WHERE EmployeeID=?',
        (emp_id,), fetchone=True,
    )
    jg = (row or {}).get('JG') or ''
    try:
        return int(jg[-2:])
    except (TypeError, ValueError):
        return None


def jg_check(emp_id, ot):
    """Zero per-row OT columns for JG06+ employees.

    For JG06-JG08 the day-total OT is computed by `_rebalance_day_allowance_ot`
    and written to the row with MAX(id) of that day, so any per-row value here
    is just a placeholder. For JG>=9 no OT is earned at all. JG<6 keep the
    per-row OT values from `_calc_overtime`.
    """
    num_jg = _employee_jg_num(emp_id)
    allow_ot = 0.0
    if num_jg is None:
        return allow_ot, ot
    if 6 <= num_jg <= 8 or num_jg >= 9:
        ot = {'OT1': 0.0, 'OT1_5': 0.0, 'OT3': 0.0}
    return allow_ot, ot


def _rebalance_day_allowance_ot(emp_id, log_date):
    """Re-derive day-total OT for a JG06-JG08 employee and write it to the row
    with the latest `end_time` for that (EmployeeID, log_date). If two rows
    end at the same time, the one with the higher `id` wins. All other rows of
    that day have `allowance_overtime` cleared to 0.

    No-op for JG<6 (per-row OT already correct) and JG>=9 (no OT at all).
    Also a no-op when the employee has no remaining rows for that date.
    """
    num_jg = _employee_jg_num(emp_id)
    if num_jg is None or num_jg < 6 or num_jg >= 9:
        return

    rows = app_pkg.db.query(
        """SELECT id, start_time, end_time FROM worklogs
           WHERE EmployeeID=? AND log_date=?
             AND start_time IS NOT NULL AND end_time IS NOT NULL
           ORDER BY id""",
        (emp_id, log_date), fetchone=False,
    )
    if not rows:
        return

    total_min = 0
    lunch_min = 0
    for r in rows:
        st, et = r['start_time'], r['end_time']
        total_min += _minutes_between(st, et)
        lunch_min += _overlap_minutes(st, et, LUNCH_START, LUNCH_END)
    day_hours    = max(0, total_min - lunch_min) / 60.0
    day_overtime = max(0.0, day_hours - 8.0)

    # Pick the row with the latest end_time (id as tiebreaker for equal ends).
    last_row = max(rows, key=lambda r: (r['end_time'], r['id']))
    last_id = last_row['id']

    # That row carries the day's overtime.
    app_pkg.db.execute(
        "UPDATE worklogs SET allowance_overtime=? WHERE id=?",
        (day_overtime, last_id),
    )
    # Clear everyone else for that day.
    app_pkg.db.execute(
        """UPDATE worklogs SET allowance_overtime=0
           WHERE EmployeeID=? AND log_date=? AND id<>?""",
        (emp_id, log_date, last_id),
    )

@worklogs_bp.route('/api/worklogs', methods=['POST'])
@login_required
def create_worklog():
    data = request.json or {}
    project = data.get('project', '')
    task = data.get('task', '')
    note = data.get('note', '')
    log_date = data.get('log_date', '').strip()

    if project=='':
        return jsonify({'error': 'Project name is required'}), 400
    if len(project) > 500:
        return jsonify({'error': 'Project name must be 200 characters or fewer'}), 400
    if len(task) > 500:
        return jsonify({'error': 'Task must be 500 characters or fewer'}), 400
    if len(note) > 1000:
        return jsonify({'error': 'Note must be 1000 characters or fewer'}), 400
    status = data.get('status', 'Pending')
    if status not in VALID_STATUSES:
        return jsonify({'error': 'Invalid status'}), 400

    #log_date = data.get('log_date', '').strip()
    if not log_date:
        return jsonify({'error': 'log_date is required'}), 400
    try:
        datetime.strptime(log_date, '%Y-%m-%d') #Check time format
    except ValueError:
        return jsonify({'error': 'Invalid date format, expected YYYY-MM-DD'}), 400

    # `member_id` in the payload now carries an EmployeeID.
    target_employee = data.get('member_id')
    if session['role'] not in ELEVATED_ROLES:
        target_employee = session['member_id']

    if not target_employee:
        return jsonify({'error': 'member_id is required'}), 400
    target_employee = str(target_employee).strip()
    if not target_employee.isdigit():
        return jsonify({'error': 'member_id must be a number'}), 400

    # Validate the target Employee exists (FK safety even though we don't enforce it yet)
    emp = app_pkg.db.query(
        "SELECT EmployeeID FROM Employee WHERE EmployeeID=?",
        (target_employee,), fetchone=True,
    )
    if not emp:
        return jsonify({'error': 'Employee not found'}), 404

    #Check if input time range is overlap with existed time range
    overlap_time = app_pkg.db.query(
        "SELECT start_time, end_time FROM worklogs WHERE EmployeeID = ? AND log_date = ?",
        (target_employee, log_date),fetchone=False,
    )

    ns = to_time(data.get('start_time'))
    ne = to_time(data.get('end_time'))
    if check_overlap(ns, ne, overlap_time):
        return jsonify({'error': 'Time range overlaps with another worklog'}), 400
    if ne <= ns:
        return jsonify({'error': 'End-time cannot less than Start-time'}), 400

    #Mapping description and project code
    project_code = None
    project_dep = None
    if project:
        mapp = app_pkg.db.query(
            'SELECT ProjectCode AS "ProjectCode", ProjectDepartment AS "ProjectDepartment" '
            'FROM ProjectAndBudget WHERE Description=?',
            (project,), fetchone=True,
        )
        project_code = mapp.get('ProjectCode')
        project_dep = mapp.get('ProjectDepartment')

    # When is_allowance=True, the entry is treated as an allowance day and
    # earns NO overtime — skip the tiered OT calc and store zeros.
    is_allowance = bool(data.get('is_allowance'))
    if is_allowance :
        ot = {'OT1': 0.0, 'OT1_5': 0.0, 'OT3': 0.0}
    else:
        ot = _calc_overtime(ns, ne, _is_holiday(log_date))

    #If 6 <= JG <= 8. All OT = 0, but add overtime_hours to allowance_overtime instead of OT1,OT1_5,OT3
    #If JG > 8 got nothing at all.
    allow_ot,ot = jg_check(target_employee,ot)

    # EmployeeID is authoritative. The legacy member_id column is nullable after
    # migration and must not receive EmployeeID values because it used to FK to
    # members.id, which is a different key space.
    worklog_id = app_pkg.db.execute(
        """
        INSERT INTO worklogs
            (member_id, EmployeeID, log_date, project, ProjectDepartment, Description, task,
             start_time, end_time, status, note, OT1, OT1_5, OT3, is_allowance ,allowance_overtime)
        {OUTPUT_ID}
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        {RETURNING_ID}
        """,
        (
            None,
            target_employee,
            log_date, project_code, project_dep , project, task,
            data.get('start_time') or None,
            data.get('end_time') or None,
            status, note,
            ot['OT1'], ot['OT1_5'], ot['OT3'],
            is_allowance, allow_ot
        ),
    )
    # JG06-JG08: day-total allowance OT is recomputed across all rows for this
    # (EmployeeID, log_date) and written to the MAX(id) row.
    _rebalance_day_allowance_ot(target_employee, log_date)
    return jsonify({'id': worklog_id}), 201


@worklogs_bp.route('/api/worklogs/<int:wid>', methods=['PUT'])
@login_required
def update_worklog(wid):
    if session['role'] not in ELEVATED_ROLES:
        row = app_pkg.db.query(
            'SELECT EmployeeID AS "EmployeeID" FROM worklogs WHERE id=?', (wid,), fetchone=True
        )
        if not row or row['EmployeeID'] != str(session['member_id']):
            return jsonify({'error': 'You can only edit your own worklogs'}), 403

    data = request.json or {}
    project_des = data.get('project', '') #Description from frontend
    task = data.get('task', '')
    note = data.get('note', '')
    member_id = data.get('member_id')
    if member_id is not None:
        member_id = str(member_id).strip()

    #Not necessary to check if the worklog is open, because the frontend will not allow creating a worklog if the worklog is not open
    """if project_des=='':
        project_des = app_pkg.db.execute("SELECT project FROM worklogs WHERE id=?", (wid,))
     """
    if len(project_des) > 500:
        return jsonify({'error': 'Project name must be 200 characters or fewer'}), 400
    if len(task) > 500:
        return jsonify({'error': 'Task must be 500 characters or fewer'}), 400
    if len(note) > 1000:
        return jsonify({'error': 'Note must be 1000 characters or fewer'}), 400
    status = data.get('status', 'Pending')
    if status not in VALID_STATUSES:
        return jsonify({'error': 'Invalid status'}), 400

    log_date = data.get('log_date', '').strip()
    if not log_date:
        return jsonify({'error': 'log_date is required'}), 400
    try:
        datetime.strptime(log_date, '%Y-%m-%d')
    except ValueError:
        return jsonify({'error': 'Invalid date format, expected YYYY-MM-DD'}), 400

    # Capture the OLD log_date before the UPDATE so we can rebalance the old
    # day too, if the user is moving this entry to a different date.
    prior = app_pkg.db.query(
        "SELECT log_date FROM worklogs WHERE id=?", (wid,), fetchone=True,
    )
    prior_log_date = prior.get('log_date') if prior else None

    #Check if input time range is overlap with existed time range
    overlap_time = app_pkg.db.query(
        "SELECT start_time, end_time FROM worklogs WHERE EmployeeID = ? AND log_date = ? AND id != ?",
        (member_id, log_date, wid),fetchone=False,
    )
    ns = to_time(data.get('start_time'))
    ne = to_time(data.get('end_time'))
    if check_overlap(ns, ne, overlap_time):
        return jsonify({'error': 'Time range overlaps with another worklog'}), 400
    if ne <= ns:
        return jsonify({'error': 'End-time cannot less than Start-time'}), 400

    #Mapping description and project code
    project_code, project_dep = None, None
    if project_des != '':
        mapp = app_pkg.db.query(
            'SELECT ProjectCode AS "ProjectCode", ProjectDepartment AS "ProjectDepartment" '
            'FROM ProjectAndBudget WHERE Description=?',
            (project_des,), fetchone=True,
        )
        project_code = mapp.get('ProjectCode')
        project_dep = mapp.get('ProjectDepartment')

    else:
        wl_des = app_pkg.db.query(
            'SELECT Description AS "Description" FROM worklogs WHERE id=?', (wid,), fetchone=True
        )
        project_des = wl_des.get('Description')
        mapp = app_pkg.db.query(
            'SELECT ProjectCode AS "ProjectCode", ProjectDepartment AS "ProjectDepartment" '
            'FROM ProjectAndBudget WHERE Description=?',
            (project_des,), fetchone=True,
        )
        project_code = mapp.get('ProjectCode')
        project_dep = mapp.get('ProjectDepartment')

    # Recompute OT columns on every edit — start/end/log_date may have changed.
    # is_allowance=True forces OT to zero (entry treated as allowance, not OT).
    is_allowance = bool(data.get('is_allowance'))
    if is_allowance:
        ot = {'OT1': 0.0, 'OT1_5': 0.0, 'OT3': 0.0}
    else:
        ot = _calc_overtime(ns, ne, _is_holiday(log_date))

    # If 6 <= JG <= 8. All OT = 0, but add overtime_hours to allowance_overtime instead of OT1,OT1_5,OT3
    # If JG > 8 got nothing at all.
    allow_ot,ot = jg_check(member_id,ot)

    #All conditions are met, update the worklog
    app_pkg.db.execute(
    """
    UPDATE worklogs SET log_date=?, project=?, Description=?, ProjectDepartment=?, task=?, start_time=?, end_time=?,
           status=?, note=?, OT1=?, OT1_5=?, OT3=?, is_allowance=?, updated_at=CURRENT_TIMESTAMP, allowance_overtime=?
    WHERE id=?
    """,
    (
        log_date, project_code, project_des, project_dep, task,
        data.get('start_time') or None,
        data.get('end_time') or None,
        status, note,
        ot['OT1'], ot['OT1_5'], ot['OT3'],
        is_allowance, allow_ot,
        wid,
        ),
    )
    # JG06-JG08: rebalance the day this row now belongs to, plus the day it
    # used to belong to (if the user just moved it to a different date).
    _rebalance_day_allowance_ot(member_id, log_date)
    if prior_log_date is not None:
        prior_log_date_str = (
            prior_log_date.strftime('%Y-%m-%d')
            if isinstance(prior_log_date, (date, datetime))
            else str(prior_log_date)
        )
        if prior_log_date_str != log_date:
            _rebalance_day_allowance_ot(member_id, prior_log_date_str)
    return jsonify({'ok': True})


@worklogs_bp.route('/api/worklogs/<int:wid>', methods=['DELETE'])
@login_required
def delete_worklog(wid):
    # Pull EmployeeID + log_date BEFORE the delete so we can rebalance the
    # surviving rows of that day afterwards (JG06-JG08 employees).
    target = app_pkg.db.query(
        'SELECT EmployeeID AS "EmployeeID", log_date FROM worklogs WHERE id=?',
        (wid,), fetchone=True,
    )
    if session['role'] not in ELEVATED_ROLES:
        if not target or target['EmployeeID'] != str(session['member_id']):
            return jsonify({'error': 'You can only delete your own worklogs'}), 403

    app_pkg.db.execute("DELETE FROM worklogs WHERE id=?", (wid,))
    if target:
        d = target['log_date']
        d_str = d.strftime('%Y-%m-%d') if isinstance(d, (date, datetime)) else str(d)
        _rebalance_day_allowance_ot(target['EmployeeID'], d_str)
    return jsonify({'ok': True})


@worklogs_bp.route('/api/dashboard', methods=['GET'])
@login_required
def get_dashboard():
    employee_id = request.args.get('member_id')   # value is EmployeeID (varchar business key)
    year = request.args.get('year', type=int, default=date.today().year)

    if not employee_id:
        return jsonify({'error': 'member_id required'}), 400

    if (not app_pkg._worklog_open
            and session.get('role') not in ELEVATED_ROLES
            and employee_id != session.get('member_id')):
        return jsonify({'error': 'Permission denied'}), 403

    member = app_pkg.db.query(
        """SELECT EmployeeName AS name,
                  Department  AS department,
                  Position    AS position,
                  Level       AS level,
                  EmployeeID  AS staff_id,
                  AvatarPath AS "AvatarPath", AvatarUpdatedAt AS "AvatarUpdatedAt"
           FROM Employee
           WHERE EmployeeID=?""",
        (employee_id,), fetchone=True,
    )
    if not member:
        return jsonify({'error': 'member not found'}), 404

    # Drop raw avatar columns from response; expose a cache-bustable URL only.
    _ap = member.pop('AvatarPath', None)
    _au = member.pop('AvatarUpdatedAt', None)
    if _ap:
        v = int(_au.timestamp()) if _au is not None else 0
        member['avatar_url'] = f"/api/avatars/{employee_id}?v={v}"
    else:
        member['avatar_url'] = None

    # ── Missing-entry days per month for this employee ──────────────────
    # Definition: weekday in month, NOT a holiday, AND employee has no worklog row that day.
    first_yr = date(year, 1, 1)
    last_yr  = date(year, 12, 31)

    # Hours are computed per-day using the same logic as the calendar view:
    #   day_hours = ((max(end_time) - min(start_time)) - lunch_overlap) / 60
    # This avoids double-counting overlapping entries on the same day.
    # Lunch time (12:00-13:00) is deducted from the daily span.
    # Time before 08:30 and after 17:30 is kept as overtime duration.
    month_expr = app_pkg.db.month('log_date')
    mb_full = app_pkg.db.minutes_between('MIN(start_time)', 'MAX(end_time)')
    mb_lunch = app_pkg.db.minutes_between(
        "CASE WHEN MIN(start_time) > '12:00' THEN MIN(start_time) ELSE '12:00' END",
        "CASE WHEN MAX(end_time) < '13:00' THEN MAX(end_time) ELSE '13:00' END",
    )
    mb_early = app_pkg.db.minutes_between(
        'MIN(start_time)',
        "CASE WHEN MAX(end_time) < '08:30' THEN MAX(end_time) ELSE '08:30' END",
    )
    mb_late = app_pkg.db.minutes_between(
        "CASE WHEN MIN(start_time) > '17:30' THEN MIN(start_time) ELSE '17:30' END",
        'MAX(end_time)',
    )
    monthly = app_pkg.db.query(
        f"""
        SELECT month,
               COALESCE(SUM(CASE WHEN is_manday = 0 THEN day_hours ELSE 0 END), 0) AS total_hours,
               COALESCE(SUM(CASE WHEN is_manday = 0 THEN overtime_hours ELSE 0 END), 0) AS overtime_hours,
               COALESCE(SUM(CASE WHEN is_manday = 1 THEN day_hours ELSE 0 END), 0) AS man_day,
               COALESCE(SUM(ot1_day),   0) AS total_ot1,
               COALESCE(SUM(ot1_5_day), 0) AS total_ot1_5,
               COALESCE(SUM(ot3_day),   0) AS total_ot3,
               SUM(done) AS done,
               SUM(in_progress) AS in_progress
        FROM (
            SELECT {month_expr} AS month,
                   log_date,
                   CASE WHEN status = 'Man day' THEN 1 ELSE 0 END AS is_manday,
                   CASE WHEN MIN(start_time) IS NOT NULL AND MAX(end_time) IS NOT NULL
                        THEN (
                            {mb_full} -
                            CASE WHEN MIN(start_time) < '13:00' AND MAX(end_time) > '12:00' THEN
                                {mb_lunch}
                            ELSE 0 END
                        ) / 60.0
                        ELSE 0
                   END AS day_hours,
                   CASE WHEN MIN(start_time) IS NOT NULL AND MAX(end_time) IS NOT NULL
                        THEN (
                            (CASE WHEN MIN(start_time) < '08:30' THEN
                                {mb_early}
                             ELSE 0 END) +
                            (CASE WHEN MAX(end_time) > '17:30' THEN
                                {mb_late}
                             ELSE 0 END)
                        ) / 60.0
                        ELSE 0
                   END AS overtime_hours,
                   COALESCE(SUM(OT1),   0) AS ot1_day,
                   COALESCE(SUM(OT1_5), 0) AS ot1_5_day,
                   COALESCE(SUM(OT3),   0) AS ot3_day,
                   SUM(CASE WHEN status = 'Done' THEN 1 ELSE 0 END) AS done,
                   SUM(CASE WHEN status = 'In Progress' THEN 1 ELSE 0 END) AS in_progress
            FROM worklogs
            WHERE EmployeeID = ? AND log_date BETWEEN ? AND ?
            GROUP BY {month_expr}, log_date,
                     CASE WHEN status = 'Man day' THEN 1 ELSE 0 END
        ) day_agg
        GROUP BY month
        ORDER BY month
        """,
        (employee_id, first_yr, last_yr),
    )

    holiday_rows = app_pkg.db.query(
        'SELECT "date" FROM holiday WHERE "date" BETWEEN ? AND ?',
        (first_yr, last_yr),
    )
    holiday_set = set()
    for hr in holiday_rows:
        hd = hr['date']
        if isinstance(hd, datetime):
            hd = hd.date()
        holiday_set.add(hd)

    expected_per_month = {mm: 0 for mm in range(1, 13)}
    for mm in range(1, 13):
        d = date(year, mm, 1)
        while d.month == mm:
            if d.weekday() < 5 and d not in holiday_set:
                expected_per_month[mm] += 1
            d += timedelta(days=1)

    logged_rows = app_pkg.db.query(
        f"""
        SELECT {month_expr} AS m, COUNT(DISTINCT log_date) AS days_logged
        FROM worklogs
        WHERE EmployeeID = ? AND log_date BETWEEN ? AND ?
        GROUP BY {month_expr}
        """,
        (employee_id, first_yr, last_yr),
    )
    logged_per_month = {int(r['m']): int(r['days_logged']) for r in logged_rows}

    month_map = {row['month']: row for row in monthly}
    months = []
    total_hours = 0
    total_overtime = 0
    total_done = 0
    total_in_progress = 0
    total_man_day = 0
    total_ot1 = 0
    total_ot1_5 = 0
    total_ot3 = 0

    for month_number in range(1, 13):
        row = month_map.get(month_number, {'total_hours': 0, 'overtime_hours': 0, 'done': 0, 'in_progress': 0, 'man_day': 0, 'total_ot1': 0, 'total_ot1_5': 0, 'total_ot3': 0})
        hours = float(row['total_hours']) if row['total_hours'] else 0
        ot = float(row['overtime_hours']) if row.get('overtime_hours') else 0
        done = int(row['done']) if row['done'] else 0
        in_progress = int(row['in_progress']) if row['in_progress'] else 0 #Keep
        man_day = float(row['man_day']) if row['man_day'] else 0
        ot1   = float(row.get('total_ot1')   or 0)
        ot1_5 = float(row.get('total_ot1_5') or 0)
        ot3   = float(row.get('total_ot3')   or 0)

        expected = expected_per_month.get(month_number, 0)
        logged   = logged_per_month.get(month_number, 0)
        missing  = max(0, expected - logged)

        months.append({
            'month': month_number,
            'name': calendar.month_name[month_number],
            'total_hours': round(hours, 2),
            'overtime_hours': round(ot, 2),
            'OT1':   round(ot1, 2),
            'OT1_5': round(ot1_5, 2),
            'OT3':   round(ot3, 2),
            'done': done,
            'in_progress': in_progress, #Keep
            'missing': missing,
            'man_day': round(man_day, 2),
        })
        total_hours += hours
        total_overtime += ot
        total_done += done
        total_in_progress += in_progress
        total_man_day += man_day
        total_ot1 += ot1
        total_ot1_5 += ot1_5
        total_ot3 += ot3

    return jsonify({
        'member': member,
        'year': year,
        'total_hours': round(total_hours, 2),
        'total_overtime': round(total_overtime, 2),
        'total_OT1':   round(total_ot1, 2),
        'total_OT1_5': round(total_ot1_5, 2),
        'total_OT3':   round(total_ot3, 2),
        'avg_monthly_hours': round(total_hours / 12, 2),
        'total_done': total_done,
        #'total_in_progress': total_in_progress,
        'total_in_progress': total_man_day,
        'total_man_day': round(total_man_day, 2),
        'months': months,
    })


@worklogs_bp.route('/api/dashboard/missing', methods=['GET'])
@login_required
def get_overall_missing():
    """Return {EmployeeID: missing_day_count} for a given year+month.

    A missing day = a weekday (Mon-Fri) within the month, NOT a holiday,
    AND the employee has no worklog entry on that date.

    Non-elevated callers receive only their own row (privacy).
    """
    year  = request.args.get('year',  type=int, default=date.today().year)
    month = request.args.get('month', type=int, default=date.today().month)
    if not (1 <= month <= 12):
        return jsonify({'error': 'month must be 1-12'}), 400

    first_day = date(year, month, 1)
    last_day  = date(year, month, calendar.monthrange(year, month)[1])

    # 1) Weekdays in month (Mon..Fri)
    workdays = set()
    d = first_day
    while d <= last_day:
        if d.weekday() < 5:
            workdays.add(d)
        d += timedelta(days=1)

    # 2) Holidays in month → drop from workdays
    holiday_rows = app_pkg.db.query(
        'SELECT "date" FROM holiday WHERE "date" BETWEEN ? AND ?',
        (first_day, last_day),
    )
    for r in holiday_rows:
        hd = r['date']
        if isinstance(hd, datetime):
            hd = hd.date()
        if hd in workdays:
            workdays.discard(hd)

    expected = len(workdays)
    if expected == 0:
        return jsonify({})

    # 3) Per-employee distinct log_date count within the working-day set
    placeholders = ','.join(['?'] * len(workdays))
    params = [first_day, last_day, *list(workdays)]
    rows = app_pkg.db.query(
        f"""
        SELECT EmployeeID AS "EmployeeID", COUNT(DISTINCT log_date) AS days_logged
        FROM worklogs
        WHERE log_date BETWEEN ? AND ?
          AND log_date IN ({placeholders})
        GROUP BY EmployeeID
        """,
        tuple(params),
    )
    logged_map = {
        str(r['EmployeeID']): int(r['days_logged'])
        for r in rows if r['EmployeeID']
    }

    # 4) For every Employee in HR, compute expected - logged
    emp_rows = app_pkg.db.query('SELECT EmployeeID AS "EmployeeID" FROM Employee')
    out = {}
    for er in emp_rows:
        eid = str(er['EmployeeID'])
        logged = logged_map.get(eid, 0)
        out[eid] = max(0, expected - logged)

    # Non-elevated → restrict to own row only
    if session.get('role') not in ELEVATED_ROLES:
        my = str(session.get('member_id') or '')
        out = {my: out.get(my, 0)} if my else {}

    return jsonify(out)


@worklogs_bp.route('/api/projects-summary', methods=['GET'])
@login_required
@elevated_required
def get_projects_summary():
    """Aggregate hours per project (and per employee within each project)
    for a given month. Elevated users only.

    Hours rule (per-project, per-employee, per-day cap):
        For each (employee, day, project) bucket, the daily hours are
            min( SUM(entry.hours),
                 ((max(end_time) - min(start_time)) - lunch_overlap) / 60 )
        Lunch (12:00-13:00) is deducted from the daily span.
        The capped daily values are then summed across days for the
        monthly per-employee, per-project total.

    Example: on a single day Project X has tasks A (3.5h) and B (8h)
    spanning 08:30-17:30. SUM = 11.5h, span cap = 8h → contribution = 8h.
    """
    try:
        year = int(request.args.get('year'))
        month = int(request.args.get('month'))
    except (TypeError, ValueError):
        return jsonify({'error': 'year and month are required integers'}), 400

    if month < 1 or month > 12:
        return jsonify({'error': 'month must be 1-12'}), 400

    month_start = date(year, month, 1)
    month_end = date(year, month, calendar.monthrange(year, month)[1])

    rows = app_pkg.db.query(
        """
        SELECT w.EmployeeID        AS employee_id,
               e.EmployeeName      AS employee_name,
               w.log_date          AS log_date,
               w.ProjectDepartment AS project_department,
               w.Description       AS project_description,
               SUM(w.hours)        AS raw_hours,
               MIN(w.start_time) AS s,
               MAX(w.end_time)   AS e
        FROM worklogs w
        LEFT JOIN Employee e ON e.EmployeeID = w.EmployeeID
        WHERE w.log_date BETWEEN ? AND ?
          AND w.ProjectDepartment IS NOT NULL
          AND LTRIM(RTRIM(w.ProjectDepartment)) <> ''
          AND COALESCE(w.hours, 0) > 0
        GROUP BY w.EmployeeID, e.EmployeeName, w.log_date,
                 w.ProjectDepartment, w.Description
        """,
        (month_start, month_end),
    )

    LUNCH_S, LUNCH_E = 12 * 60, 13 * 60   # 12:00, 13:00 in minutes

    def to_min(t):
        if t is None:
            return None
        try:
            h, m = str(t).split(':')[:2]
            return int(h) * 60 + int(m)
        except (ValueError, IndexError):
            return None

    def span_with_lunch(s_min, e_min):
        """((max(end) - min(start)) - lunch_overlap) / 60, in hours."""
        if s_min is None or e_min is None or e_min <= s_min:
            return 0.0
        total = e_min - s_min
        if s_min < LUNCH_E and e_min > LUNCH_S:
            overlap = min(e_min, LUNCH_E) - max(s_min, LUNCH_S)
            if overlap > 0:
                total -= overlap
                if total > 480.00 :
                    total = 480.00

        return max(0.0, total / 60.0)

    # Aggregate per (department, employee), summing the per-day capped hours.
    dept_descriptions = {}  # project_department -> set of descriptions
    acc = {}                # (project_department, employee_id) -> {'name', 'hours'}
    for r in rows:
        raw = float(r['raw_hours']) if r['raw_hours'] is not None else 0.0
        cap = span_with_lunch(to_min(r['s']), to_min(r['e']))
        capped = min(raw, cap) if cap > 0 else raw
        if capped <= 0:
            continue

        dept = r['project_department']
        desc = r['project_description']
        if dept not in dept_descriptions:
            dept_descriptions[dept] = set()
        if desc:
            dept_descriptions[dept].add(desc)

        key = (dept, r['employee_id'])
        entry = acc.setdefault(key, {
            'employee_id': r['employee_id'],
            'name': r['employee_name'] or f"(unknown #{r['employee_id']})",
            'hours': 0.0,
        })
        entry['hours'] += capped

    # Roll up into per-department buckets
    by_project = {}
    for (dept, _emp_id), entry in acc.items():
        descs = sorted(dept_descriptions.get(dept, set()))
        bucket = by_project.setdefault(dept, {
            'project_department': dept,
            'project_description': ', '.join(descs),
            'total_hours': 0.0,
            'employees': [],
        })
        bucket['total_hours'] += entry['hours']
        bucket['employees'].append({
            'employee_id': entry['employee_id'],
            'hours': round(entry['hours'], 2),
            'name': entry['name'],
        })

    projects = [p for p in by_project.values() if p['total_hours'] > 0]
    projects.sort(key=lambda p: p['total_hours'], reverse=True)
    for p in projects:
        p['total_hours'] = round(p['total_hours'], 2)
        p['employees'].sort(key=lambda emp: emp['hours'], reverse=True)
        p['employees_count'] = len(p['employees'])

    return jsonify({'year': year, 'month': month, 'projects': projects})
