"""Worklogs blueprint — post-migration: keyed by EmployeeID (not members.id).

The query parameter `member_id` is preserved for frontend backward-compat,
but its VALUE now carries an EmployeeID (e.g. 33546). All SQL queries match
against `worklogs.EmployeeID`. The legacy `worklogs.member_id` column is
left in place but no longer authoritative.
"""
import calendar

from datetime import date
from datetime import datetime

from flask import Blueprint
from flask import jsonify
from flask import request
from flask import session

import app as app_pkg

from .auth import elevated_required
from .auth import login_required
from .constants import ELEVATED_ROLES

worklogs_bp = Blueprint('worklogs', __name__)
VALID_STATUSES = {'Done', 'In Progress', 'Pending', 'Man day'}


@worklogs_bp.route('/api/worklogs', methods=['GET'])
@login_required
def get_worklogs():
    employee_id = request.args.get('member_id', type=int)   # param name kept; value is EmployeeID
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
        SELECT id,
               EmployeeID  AS member_id,   -- alias preserved for frontend payload
               log_date, project, task,
               CONVERT(VARCHAR(5), start_time, 108) as start_time,
               CONVERT(VARCHAR(5), end_time, 108) as end_time,
               hours, status, note
        FROM worklogs
        WHERE EmployeeID = ? AND log_date BETWEEN ? AND ?
        ORDER BY log_date
        """,
        (employee_id, first_day, last_day),
    )

    for row in rows:
        if row['log_date']:
            if isinstance(row['log_date'], (date, datetime)):
                row['log_date'] = row['log_date'].strftime('%Y-%m-%d')
            else:
                row['log_date'] = str(row['log_date'])
        if row['hours'] is not None:
            row['hours'] = float(row['hours'])

    return jsonify(rows)


@worklogs_bp.route('/api/worklogs', methods=['POST'])
@login_required
def create_worklog():
    data = request.json or {}
    project = data.get('project', '')
    task = data.get('task', '')
    note = data.get('note', '')

    if len(project) > 200:
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

    # `member_id` in the payload now carries an EmployeeID.
    target_employee = data.get('member_id')
    if session['role'] not in ELEVATED_ROLES:
        target_employee = session['member_id']

    if not target_employee:
        return jsonify({'error': 'member_id is required'}), 400
    try:
        target_employee = int(target_employee)
    except (TypeError, ValueError):
        return jsonify({'error': 'member_id must be a number'}), 400

    # Validate the target Employee exists (FK safety even though we don't enforce it yet)
    emp = app_pkg.db.query(
        "SELECT EmployeeID FROM dbo.Employee WHERE EmployeeID=?",
        (target_employee,), fetchone=True,
    )
    if not emp:
        return jsonify({'error': 'Employee not found'}), 404

    # EmployeeID is authoritative. The legacy member_id column is nullable after
    # migration and must not receive EmployeeID values because it used to FK to
    # members.id, which is a different key space.
    worklog_id = app_pkg.db.execute(
        """
        INSERT INTO worklogs
            (member_id, EmployeeID, log_date, project, task, start_time, end_time, status, note)
        OUTPUT INSERTED.id
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            None,
            target_employee,
            log_date, project, task,
            data.get('start_time') or None,
            data.get('end_time') or None,
            status, note,
        ),
    )
    return jsonify({'id': worklog_id}), 201


@worklogs_bp.route('/api/worklogs/<int:wid>', methods=['PUT'])
@login_required
def update_worklog(wid):
    if session['role'] not in ELEVATED_ROLES:
        row = app_pkg.db.query(
            "SELECT EmployeeID FROM worklogs WHERE id=?", (wid,), fetchone=True
        )
        if not row or row['EmployeeID'] != session['member_id']:
            return jsonify({'error': 'You can only edit your own worklogs'}), 403

    data = request.json or {}
    project = data.get('project', '')
    task = data.get('task', '')
    note = data.get('note', '')

    if len(project) > 200:
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

    app_pkg.db.execute(
        """
        UPDATE worklogs SET log_date=?, project=?, task=?, start_time=?, end_time=?,
               status=?, note=?, updated_at=GETDATE()
        WHERE id=?
        """,
        (
            log_date, project, task,
            data.get('start_time') or None,
            data.get('end_time') or None,
            status, note,
            wid,
        ),
    )
    return jsonify({'ok': True})


@worklogs_bp.route('/api/worklogs/<int:wid>', methods=['DELETE'])
@login_required
def delete_worklog(wid):
    if session['role'] not in ELEVATED_ROLES:
        row = app_pkg.db.query(
            "SELECT EmployeeID FROM worklogs WHERE id=?", (wid,), fetchone=True
        )
        if not row or row['EmployeeID'] != session['member_id']:
            return jsonify({'error': 'You can only delete your own worklogs'}), 403

    app_pkg.db.execute("DELETE FROM worklogs WHERE id=?", (wid,))
    return jsonify({'ok': True})


@worklogs_bp.route('/api/dashboard', methods=['GET'])
@login_required
def get_dashboard():
    employee_id = request.args.get('member_id', type=int)   # value is EmployeeID
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
                  CAST(EmployeeID AS NVARCHAR(20)) AS staff_id,
                  AvatarPath, AvatarUpdatedAt
           FROM dbo.Employee
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

    # Hours are computed per-day using the same logic as the calendar view:
    #   day_hours = ((max(end_time) - min(start_time)) - lunch_overlap) / 60
    # This avoids double-counting overlapping entries on the same day.
    # Lunch time (12:00-13:00) is deducted from the daily span.
    # Time before 08:30 and after 17:30 is kept as overtime duration.
    import time
    start_db = time.time()
    monthly = app_pkg.db.query(
        """
        SELECT month,
               ISNULL(SUM(CASE WHEN is_manday = 0 THEN day_hours ELSE 0 END), 0) AS total_hours,
               ISNULL(SUM(CASE WHEN is_manday = 0 THEN overtime_hours ELSE 0 END), 0) AS overtime_hours,
               ISNULL(SUM(CASE WHEN is_manday = 1 THEN day_hours ELSE 0 END), 0) AS man_day,
               SUM(done) AS done,
               SUM(in_progress) AS in_progress
        FROM (
            SELECT MONTH(log_date) AS month,
                   log_date,
                   CASE WHEN status = 'Man day' THEN 1 ELSE 0 END AS is_manday,
                   CASE WHEN MIN(start_time) IS NOT NULL AND MAX(end_time) IS NOT NULL
                        THEN (
                            DATEDIFF(MINUTE, MIN(start_time), MAX(end_time)) -
                            CASE WHEN MIN(start_time) < '13:00' AND MAX(end_time) > '12:00' THEN
                                DATEDIFF(MINUTE,
                                    CASE WHEN MIN(start_time) > '12:00' THEN MIN(start_time) ELSE '12:00' END,
                                    CASE WHEN MAX(end_time) < '13:00' THEN MAX(end_time) ELSE '13:00' END
                                )
                            ELSE 0 END
                        ) / 60.0
                        ELSE 0
                   END AS day_hours,
                   CASE WHEN MIN(start_time) IS NOT NULL AND MAX(end_time) IS NOT NULL
                        THEN (
                            (CASE WHEN MIN(start_time) < '08:30' THEN 
                                DATEDIFF(MINUTE, MIN(start_time), CASE WHEN MAX(end_time) < '08:30' THEN MAX(end_time) ELSE '08:30' END) 
                             ELSE 0 END) +
                            (CASE WHEN MAX(end_time) > '17:30' THEN 
                                DATEDIFF(MINUTE, CASE WHEN MIN(start_time) > '17:30' THEN MIN(start_time) ELSE '17:30' END, MAX(end_time)) 
                             ELSE 0 END)
                        ) / 60.0
                        ELSE 0
                   END AS overtime_hours,
                   SUM(CASE WHEN status = 'Done' THEN 1 ELSE 0 END) AS done,
                   SUM(CASE WHEN status = 'In Progress' THEN 1 ELSE 0 END) AS in_progress
            FROM worklogs
            WHERE EmployeeID = ? AND YEAR(log_date) = ?
            GROUP BY MONTH(log_date), log_date,
                     CASE WHEN status = 'Man day' THEN 1 ELSE 0 END
        ) day_agg
        GROUP BY month
        ORDER BY month
        """,
        (employee_id, year),
    )
    print(f"[PERF] get_dashboard DB query took {time.time() - start_db:.4f}s")


    month_map = {row['month']: row for row in monthly}
    months = []
    total_hours = 0
    total_overtime = 0
    total_done = 0
    total_in_progress = 0
    total_man_day = 0

    for month_number in range(1, 13):
        row = month_map.get(month_number, {'total_hours': 0, 'overtime_hours': 0, 'done': 0, 'in_progress': 0, 'man_day': 0})
        hours = float(row['total_hours']) if row['total_hours'] else 0
        ot = float(row['overtime_hours']) if row.get('overtime_hours') else 0
        done = int(row['done']) if row['done'] else 0
        in_progress = int(row['in_progress']) if row['in_progress'] else 0 #Keep
        man_day = float(row['man_day']) if row['man_day'] else 0

        months.append({
            'month': month_number,
            'name': calendar.month_name[month_number],
            'total_hours': round(hours, 2),
            'overtime_hours': round(ot, 2),
            'done': done,
            'in_progress': in_progress, #Keep
            'man_day': round(man_day, 2),
        })
        total_hours += hours
        total_overtime += ot
        total_done += done
        total_in_progress += in_progress
        total_man_day += man_day

    return jsonify({
        'member': member,
        'year': year,
        'total_hours': round(total_hours, 2),
        'total_overtime': round(total_overtime, 2),
        'avg_monthly_hours': round(total_hours / 12, 2),
        'total_done': total_done,
        #'total_in_progress': total_in_progress,
        'total_in_progress': total_man_day,
        'total_man_day': round(total_man_day, 2),
        'months': months,
    })


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

    rows = app_pkg.db.query(
        """
        SELECT w.EmployeeID    AS employee_id,
               e.EmployeeName  AS employee_name,
               w.log_date      AS log_date,
               w.project       AS project_name,
               SUM(w.hours)    AS raw_hours,
               CONVERT(VARCHAR(5), MIN(w.start_time), 108) AS s,
               CONVERT(VARCHAR(5), MAX(w.end_time),   108) AS e
        FROM worklogs w
        LEFT JOIN dbo.Employee e ON e.EmployeeID = w.EmployeeID
        WHERE YEAR(w.log_date) = ?
          AND MONTH(w.log_date) = ?
          AND w.project IS NOT NULL
          AND LTRIM(RTRIM(w.project)) <> ''
          AND ISNULL(w.hours, 0) > 0
        GROUP BY w.EmployeeID, e.EmployeeName, w.log_date, w.project
        """,
        (year, month),
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
        return max(0.0, total / 60.0)

    # Aggregate per (project, employee), summing the per-day capped hours.
    acc = {}   # (project_name, employee_id) -> {'name', 'hours'}
    for r in rows:
        raw = float(r['raw_hours']) if r['raw_hours'] is not None else 0.0
        cap = span_with_lunch(to_min(r['s']), to_min(r['e']))
        capped = min(raw, cap) if cap > 0 else raw
        if capped <= 0:
            continue
        key = (r['project_name'], r['employee_id'])
        entry = acc.setdefault(key, {
            'employee_id': r['employee_id'],
            'name': r['employee_name'] or f"(unknown #{r['employee_id']})",
            'hours': 0.0,
        })
        entry['hours'] += capped

    # Roll up into per-project buckets
    by_project = {}
    for (proj_name, _emp_id), entry in acc.items():
        bucket = by_project.setdefault(proj_name, {
            'project_name': proj_name,
            'total_hours': 0.0,
            'employees': [],
        })
        bucket['total_hours'] += entry['hours']
        bucket['employees'].append({
            'employee_id': entry['employee_id'],
            'name': entry['name'],
            'hours': round(entry['hours'], 2),
        })

    projects = [p for p in by_project.values() if p['total_hours'] > 0]
    projects.sort(key=lambda p: p['total_hours'], reverse=True)
    for p in projects:
        p['total_hours'] = round(p['total_hours'], 2)
        p['employees'].sort(key=lambda emp: emp['hours'], reverse=True)
        p['employees_count'] = len(p['employees'])

    return jsonify({'year': year, 'month': month, 'projects': projects})
