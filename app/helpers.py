import json
import re

from datetime import time

# Pragmatic email shape check — real validation is the delivery attempt itself.
EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')


def parse_member_ids(col_value):
    """Parse a project member list — post-migration, this is a JSON array of
    EmployeeID integers. Falls back to (legacy) name-delimited or JSON name
    arrays for any rows that haven't been migrated yet (returned as strings).
    """
    if not col_value:
        return []

    col_str = col_value.strip() if isinstance(col_value, str) else str(col_value)

    if col_str.startswith('['):
        try:
            parsed = json.loads(col_str)
            if isinstance(parsed, list):
                return parsed
        except (json.JSONDecodeError, ValueError):
            pass

    return [item.strip() for item in col_str.split('#') if item.strip()]


# Backward-compat alias — projects.py previously imported `parse_members`
parse_members = parse_member_ids


def format_member_ids(id_list):
    """Format a list of EmployeeIDs as a JSON array string. None on empty."""
    if not id_list:
        return None
    # Store as strings — EmployeeID is NVARCHAR(5)
    coerced = [str(item).strip() for item in id_list if str(item).strip()]
    return json.dumps(coerced, ensure_ascii=False)


# Backward-compat alias
format_members = format_member_ids


def cascade_delete_employee(db, employee_id):
    """Delete all worklogs and skills for an EmployeeID. Used when a user
    account is deleted — frees up their data so the EmployeeID can be reclaimed.
    """
    with db.transaction():
        db.execute("DELETE FROM worklogs WHERE EmployeeID=?", (employee_id,))
        db.execute("DELETE FROM member_skills WHERE EmployeeID=?", (employee_id,))


# Backward-compat alias for any forgotten callers
cascade_delete_member = cascade_delete_employee


def parse_time(value):
    """Convert 'HH:MM' strings to datetime.time for openpyxl."""
    if not value:
        return None

    try:
        parts = value.split(':')
        return time(int(parts[0]), int(parts[1]))
    except (IndexError, ValueError):
        return None
