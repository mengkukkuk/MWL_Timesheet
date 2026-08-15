"""One-shot data migration: MSSQL (MeterWorklog) -> PostgreSQL (mwl/mwlts).

Phase 8 of the dual-engine port (see the approved plan). Reads live data from
the MSSQL source (read-only — never writes back to MSSQL) and loads it into
an empty-or-seeded PostgreSQL target, preserving original IDENTITY ids and
resyncing every PG sequence afterwards.

Usage:
    python tools/migrate_mssql_to_postgres.py                 # dry run (default): counts only, no writes
    python tools/migrate_mssql_to_postgres.py --execute        # actually migrate (truncates target tables first)
    python tools/migrate_mssql_to_postgres.py --execute --no-truncate   # append instead of truncate (advanced)
    python tools/migrate_mssql_to_postgres.py --tables users,worklogs   # restrict to a subset, for debugging

This script opens its own MSSQL (pyodbc) and PostgreSQL (psycopg2) connections
directly from env vars — it does NOT import db.py, because db.py locks its
engine at import time from DB_ENGINE and this script needs both engines live
simultaneously.
"""

import argparse
import os
import sys

from dotenv import load_dotenv

load_dotenv()

_pg_bin = os.getenv('PG_BIN_DIR', '').strip()
if _pg_bin and hasattr(os, 'add_dll_directory') and os.path.isdir(_pg_bin):
    os.add_dll_directory(_pg_bin)

import psycopg2
import psycopg2.extras
import pyodbc


# ─────────────────────────────────────────────────────────────────────────────
# Connections
# ─────────────────────────────────────────────────────────────────────────────

def connect_mssql():
    server = os.getenv('DB_SERVER', 'localhost')
    database = os.getenv('DB_NAME', 'MeterWorklog')
    driver = os.getenv('DB_DRIVER', '{ODBC Driver 17 for SQL Server}')
    user = os.getenv('DB_USER', '')
    password = os.getenv('DB_PASSWORD', '')
    trust_cert = os.getenv('DB_TRUST_CERT', 'yes')
    if user and password:
        conn_str = (
            f"DRIVER={driver};SERVER={server};DATABASE={database};"
            f"UID={user};PWD={password};TrustServerCertificate={trust_cert}"
        )
    else:
        conn_str = (
            f"DRIVER={driver};SERVER={server};DATABASE={database};"
            f"Trusted_Connection=yes;TrustServerCertificate={trust_cert}"
        )
    conn = pyodbc.connect(conn_str)
    conn.autocommit = True  # read-only source; no transaction needed
    return conn


def connect_postgres():
    schema = os.getenv('PG_SCHEMA', 'mwlts')
    options = f'-c search_path={schema}'
    timezone = os.getenv('PG_TIMEZONE', '').strip()
    if timezone:
        options += f' -c timezone={timezone}'
    conn = psycopg2.connect(
        host=os.getenv('PG_HOST', 'localhost'),
        port=int(os.getenv('PG_PORT', '5432')),
        dbname=os.getenv('PG_DB', 'mwl'),
        user=os.getenv('PG_USER', 'postgres'),
        password=os.getenv('PG_PASSWORD', ''),
        options=options,
    )
    conn.autocommit = False
    return conn


# ─────────────────────────────────────────────────────────────────────────────
# Row transforms
# ─────────────────────────────────────────────────────────────────────────────

def _s(v):
    """Strip an EmployeeID-like value to str; pass None through."""
    return None if v is None else str(v).strip()


def _b(v):
    """Coerce a BIT value to Python bool; pass None through."""
    return None if v is None else bool(v)


# ─────────────────────────────────────────────────────────────────────────────
# Table migration order (FK-dependency safe). Self-referencing FKs
# (users.reviewed_by, file_folders.parent_id) are loaded NULL on the first
# pass and backfilled by a second UPDATE pass after every row exists.
# ─────────────────────────────────────────────────────────────────────────────

TABLES = []


def table(name, mssql_sql, pg_columns, row_fn, self_fk=None, has_identity=True):
    TABLES.append(dict(
        name=name, mssql_sql=mssql_sql, pg_columns=pg_columns,
        row_fn=row_fn, self_fk=self_fk, has_identity=has_identity,
    ))


table(
    'members',
    "SELECT id, name, department, staff_id FROM members ORDER BY id",
    ['id', 'name', 'department', 'staff_id', 'position'],
    lambda r: (r.id, r.name, r.department or '', r.staff_id, None),
)

table(
    'employee',
    """SELECT ID, EmployeeID, EmployeeName, Department, Position, Level, JG,
              CreateAt, UpdateAt, AvatarPath, AvatarMime, AvatarUpdatedAt
       FROM Employee ORDER BY ID""",
    ['id', 'employeeid', 'employeename', 'department', 'position', 'level', 'jg',
     'createat', 'updateat', 'avatarpath', 'avatarmime', 'avatarupdatedat'],
    lambda r: (r.ID, _s(r.EmployeeID), r.EmployeeName, r.Department, r.Position,
               r.Level, r.JG, r.CreateAt, r.UpdateAt, r.AvatarPath, r.AvatarMime,
               r.AvatarUpdatedAt),
)

table(
    'projects',
    "SELECT id, name, main_members, support_members FROM projects ORDER BY id",
    ['id', 'name', 'main_members', 'support_members', 'description'],
    lambda r: (r.id, r.name, r.main_members, r.support_members, None),
)

table(
    'projectandbudget',
    """SELECT ID, RTRIM(projectcode) AS projectcode, RTRIM(budgetcode) AS budgetcode,
              RTRIM(description) AS description, RTRIM(ProjectDepartment) AS ProjectDepartment,
              RTRIM(Status) AS Status
       FROM dbo.ProjectAndBudget ORDER BY ID""",
    ['id', 'projectcode', 'budgetcode', 'description', 'projectdepartment', 'status'],
    lambda r: (r.ID, r.projectcode, r.budgetcode, r.description, r.ProjectDepartment, r.Status),
)

table(
    'holiday',
    "SELECT id, [date], description FROM dbo.holiday ORDER BY id",
    ['id', 'date', 'description'],
    lambda r: (r.id, r.date, r.description),
)

table(
    'users',
    """SELECT id, username, password_hash, role, member_id, EmployeeID, status,
              reviewed_by, reviewed_at, created_at, email
       FROM users ORDER BY id""",
    ['id', 'username', 'password_hash', 'role', 'member_id', 'created_at',
     'status', 'employeeid', 'email'],
    lambda r: (r.id, r.username, r.password_hash, r.role, r.member_id,
               r.created_at, r.status, _s(r.EmployeeID), r.email),
    self_fk=dict(column='reviewed_by', source_attr='reviewed_by'),
)

table(
    'user_security_state',
    """SELECT user_id, failed_login_count, failed_login_window_start, locked_until,
              unlock_token_hash, unlock_token_expires_at, last_unlock_email_sent_at,
              updated_at, reset_token_hash, reset_token_expires_at, last_reset_email_sent_at
       FROM user_security_state ORDER BY user_id""",
    ['user_id', 'failed_login_count', 'failed_login_window_start', 'locked_until',
     'unlock_token_hash', 'unlock_token_expires_at', 'last_unlock_email_sent_at',
     'updated_at', 'reset_token_hash', 'reset_token_expires_at', 'last_reset_email_sent_at'],
    lambda r: (r.user_id, r.failed_login_count, r.failed_login_window_start, r.locked_until,
               r.unlock_token_hash, r.unlock_token_expires_at, r.last_unlock_email_sent_at,
               r.updated_at, r.reset_token_hash, r.reset_token_expires_at,
               r.last_reset_email_sent_at),
    has_identity=False,
)

table(
    'security_events',
    """SELECT id, user_id, username, event_type, ip_address, user_agent, detail, created_at
       FROM security_events ORDER BY id""",
    ['id', 'user_id', 'username', 'event_type', 'ip_address', 'user_agent', 'detail', 'created_at'],
    lambda r: (r.id, r.user_id, r.username, r.event_type, r.ip_address, r.user_agent,
               r.detail, r.created_at),
)

table(
    'member_skills',
    """SELECT id, member_id, name, level, created_at, updated_at, EmployeeID
       FROM member_skills ORDER BY id""",
    ['id', 'member_id', 'name', 'level', 'created_at', 'updated_at', 'employeeid'],
    lambda r: (r.id, r.member_id, r.name, r.level, r.created_at, r.updated_at, _s(r.EmployeeID)),
)

table(
    'file_folders',
    """SELECT id, name, parent_id, created_by, created_at, is_classified
       FROM file_folders ORDER BY id""",
    ['id', 'name', 'created_by', 'created_at', 'is_classified'],
    lambda r: (r.id, r.name, r.created_by, r.created_at, _b(r.is_classified)),
    self_fk=dict(column='parent_id', source_attr='parent_id'),
)

table(
    'files',
    """SELECT id, folder_id, original_name, stored_name, size_bytes, mime_type,
              sha256, uploaded_by, uploaded_at, is_classified
       FROM files ORDER BY id""",
    ['id', 'folder_id', 'original_name', 'stored_name', 'size_bytes', 'mime_type',
     'sha256', 'uploaded_by', 'uploaded_at', 'is_classified'],
    lambda r: (r.id, r.folder_id, r.original_name, r.stored_name, r.size_bytes,
               r.mime_type, r.sha256, r.uploaded_by, r.uploaded_at, _b(r.is_classified)),
)

table(
    'worklogs',
    """SELECT id, member_id, EmployeeID, log_date, project, ProjectDepartment, task,
              start_time, end_time, status, note, OT1, OT3, OT1_5, created_at, updated_at,
              Description, IsEditRow, is_allowance, allowance_overtime
       FROM worklogs ORDER BY id""",
    ['id', 'member_id', 'employeeid', 'log_date', 'project', 'projectdepartment', 'task',
     'start_time', 'end_time', 'status', 'note', 'ot1', 'ot3', 'ot1_5', 'created_at',
     'updated_at', 'description', 'iseditrow', 'is_allowance', 'allowance_overtime'],
    lambda r: (r.id, r.member_id, _s(r.EmployeeID), r.log_date, r.project,
               r.ProjectDepartment, r.task, r.start_time, r.end_time, r.status, r.note,
               r.OT1, r.OT3, r.OT1_5, r.created_at, r.updated_at, r.Description,
               _b(r.IsEditRow), _b(r.is_allowance), r.allowance_overtime),
)

table(
    'allowance',
    """SELECT ID, log_date, EmployeeID, ProjectCode, Description, type, CreateAt,
              UpdateAt, IsEditRow
       FROM dbo.Allowance ORDER BY ID""",
    ['id', 'log_date', 'employeeid', 'projectcode', 'description', 'type',
     'createat', 'updateat', 'iseditrow'],
    lambda r: (r.ID, r.log_date, _s(r.EmployeeID), r.ProjectCode, r.Description,
               r.type, r.CreateAt, r.UpdateAt, _b(r.IsEditRow)),
)


# ─────────────────────────────────────────────────────────────────────────────
# Migration driver
# ─────────────────────────────────────────────────────────────────────────────

def migrate_table(pg_conn, cfg, rows, truncate):
    name = cfg['name']
    cols = cfg['pg_columns']
    cursor = pg_conn.cursor()

    if truncate:
        cursor.execute(f'TRUNCATE TABLE {name} RESTART IDENTITY CASCADE')

    if rows:
        placeholders = ', '.join(cols)
        sql = f'INSERT INTO {name} ({placeholders}) VALUES %s'
        psycopg2.extras.execute_values(cursor, sql, rows, page_size=500)

    return len(rows)


def backfill_self_fk(pg_conn, table_name, fk_column, pairs):
    """pairs: list of (id, fk_value) where fk_value is not None."""
    if not pairs:
        return
    cursor = pg_conn.cursor()
    sql = f'UPDATE {table_name} SET {fk_column} = %s WHERE id = %s'
    cursor.executemany(sql, [(fk_val, row_id) for row_id, fk_val in pairs])


def resync_sequence(pg_conn, table_name):
    cursor = pg_conn.cursor()
    cursor.execute(
        "SELECT setval(pg_get_serial_sequence(%s, 'id'), "
        f"COALESCE((SELECT MAX(id) FROM {table_name}), 1), "
        f"COALESCE((SELECT MAX(id) FROM {table_name}), 0) > 0)",
        (table_name,),
    )


def source_count_sql(cfg):
    """Build a COUNT(*) query over the same FROM clause as the migration SELECT."""
    sql = cfg['mssql_sql']
    from_clause = sql.split('FROM', 1)[1].split('ORDER BY')[0]
    return 'SELECT COUNT(*) FROM' + from_clause


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true',
                         help='Actually write to PostgreSQL. Without this flag, only counts rows (dry run).')
    parser.add_argument('--no-truncate', action='store_true',
                         help='Do not TRUNCATE target tables before inserting (append mode; advanced/unsafe).')
    parser.add_argument('--tables', default='',
                         help='Comma-separated subset of table names to migrate (default: all).')
    args = parser.parse_args()

    wanted = set(t.strip() for t in args.tables.split(',') if t.strip()) or None
    plan = [t for t in TABLES if wanted is None or t['name'] in wanted]
    if not plan:
        print(f"No tables matched --tables={args.tables!r}", file=sys.stderr)
        sys.exit(1)

    truncate = args.execute and not args.no_truncate

    print(f"Mode: {'EXECUTE (writes to PostgreSQL)' if args.execute else 'DRY RUN (counts only, no writes)'}")
    print(f"Truncate target tables first: {truncate}")
    print(f"Tables: {', '.join(t['name'] for t in plan)}")
    print()

    mssql_conn = connect_mssql()
    pg_conn = connect_postgres() if args.execute else None

    # table name -> list of (id, raw self-FK value) captured from the source
    # cursor.Row objects before row_fn projects them into plain tuples.
    self_fk_pairs = {}

    try:
        for cfg in plan:
            name = cfg['name']
            cursor = mssql_conn.cursor()
            cursor.execute(cfg['mssql_sql'])
            source_rows = cursor.fetchall()

            pairs = []
            if cfg['self_fk']:
                attr = cfg['self_fk']['source_attr']
                id_index = 0  # every SELECT lists the id/user_id/ID column first
                for r in source_rows:
                    fk_val = getattr(r, attr)
                    if fk_val is not None:
                        pairs.append((r[id_index], fk_val))
                self_fk_pairs[name] = pairs

            projected = [cfg['row_fn'](r) for r in source_rows]
            print(f"{name}: {len(projected)} source rows"
                  + (f" ({len(pairs)} self-FK backfills pending)" if cfg['self_fk'] else ""))

            if args.execute:
                migrate_table(pg_conn, cfg, projected, truncate)

        if args.execute:
            for cfg in plan:
                if cfg['self_fk']:
                    backfill_self_fk(pg_conn, cfg['name'], cfg['self_fk']['column'],
                                      self_fk_pairs.get(cfg['name'], []))
                if cfg['has_identity']:
                    resync_sequence(pg_conn, cfg['name'])
            pg_conn.commit()
            print("\nCommitted.")

            print("\nRow-count parity check:")
            for cfg in plan:
                mssql_cursor = mssql_conn.cursor()
                mssql_cursor.execute(source_count_sql(cfg))
                src_count = mssql_cursor.fetchone()[0]
                pg_cursor = pg_conn.cursor()
                pg_cursor.execute(f"SELECT COUNT(*) FROM {cfg['name']}")
                tgt_count = pg_cursor.fetchone()[0]
                flag = 'OK' if src_count == tgt_count else 'MISMATCH'
                print(f"  {cfg['name']:24s} source={src_count:6d}  target={tgt_count:6d}  [{flag}]")
        else:
            print("\nDry run complete. Re-run with --execute to write to PostgreSQL.")
    finally:
        mssql_conn.close()
        if pg_conn is not None:
            pg_conn.close()


if __name__ == '__main__':
    main()
