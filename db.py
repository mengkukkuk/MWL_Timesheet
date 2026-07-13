import os
import threading

import pyodbc
from dotenv import load_dotenv

load_dotenv()
_thread_local = threading.local()

# Define Connection string.
def get_connection():
    conn = getattr(_thread_local, 'connection', None)
    if conn is not None:
        try:
            conn.cursor().execute("SELECT 1")  # real TCP liveness probe
            return conn
        except pyodbc.Error:
            try:
                conn.close()
            except pyodbc.Error:
                pass
            _thread_local.connection = None

    server = os.getenv('DB_SERVER', 'localhost')
    database = os.getenv('DB_NAME', 'MeterWorklog')
    driver = os.getenv('DB_DRIVER', '{ODBC Driver 17 for SQL Server}')
    user = os.getenv('DB_USER', '')
    password = os.getenv('DB_PASSWORD', '')
    trust_cert = os.getenv('DB_TRUST_CERT', 'yes')

    if user and password:
        conn_str = f"DRIVER={driver};SERVER={server};DATABASE={database};UID={user};PWD={password};TrustServerCertificate={trust_cert}"
    else:
        conn_str = f"DRIVER={driver};SERVER={server};DATABASE={database};Trusted_Connection=yes;TrustServerCertificate={trust_cert}"

    conn = pyodbc.connect(conn_str)
    _thread_local.connection = conn
    return conn


def init_db():
    """Run init_db.sql to create tables if they don't exist."""
    server = os.getenv('DB_SERVER', 'localhost')
    driver = os.getenv('DB_DRIVER', '{ODBC Driver 17 for SQL Server}')
    user = os.getenv('DB_USER', '')
    password = os.getenv('DB_PASSWORD', '')

    trust_cert = os.getenv('DB_TRUST_CERT', 'no')

    if user and password:
        conn_str = f"DRIVER={driver};SERVER={server};DATABASE=master;UID={user};PWD={password};TrustServerCertificate={trust_cert}"
    else:
        conn_str = f"DRIVER={driver};SERVER={server};DATABASE=master;Trusted_Connection=yes;TrustServerCertificate={trust_cert}"

    sql_path = os.path.join(os.path.dirname(__file__), 'init_db.sql')
    with open(sql_path, 'r') as f:
        sql = f.read()

    conn = pyodbc.connect(conn_str, autocommit=True)
    cursor = conn.cursor()
    for i, batch in enumerate(sql.split('\nGO\n'), start=1):
        batch = batch.strip()
        if not batch:
            continue
        try:
            cursor.execute(batch)
        except pyodbc.Error as e:
            # Loud, prefixed warning so migration failures aren't lost in the log.
            # Print the first 200 chars of the batch so we can pinpoint which one.
            head = batch.replace('\n', ' ')[:200]
            print(f"[init_db] SQL batch #{i} FAILED: {e}\n         batch head: {head}")
    conn.close()


def query(sql, params=(), fetchone=False):
    for attempt in range(2):
        try:
            conn = get_connection()
            cursor = conn.cursor()
            cursor.execute(sql, _rstrip_params(params))
            columns = [col[0] for col in cursor.description] if cursor.description else []
            if fetchone:
                row = cursor.fetchone()
                return dict(zip(columns, row)) if row else None
            rows = cursor.fetchall()
            return [dict(zip(columns, row)) for row in rows]
        except pyodbc.OperationalError:
            if attempt == 0:
                _thread_local.connection = None  # discard stale connection, retry once
                continue
            raise


def _rstrip_params(params):
    """Right-trim every string parameter before binding.

    Trailing whitespace in NVARCHAR columns (notably the NVARCHAR(5)
    EmployeeID column) gets URL-encoded to %20 by the SPA, which then
    fails string-equality matching against trimmed values returned from
    other queries. Centralizing the trim here means every current and
    future INSERT/UPDATE/DELETE path is protected without having to
    audit each call site.

    Non-string values (None, int, bytes, datetime, decimal, ...) are
    passed through untouched.
    """
    if not params:
        return params
    return tuple(p.rstrip() if isinstance(p, str) else p for p in params)


def execute(sql, params=()):
    for attempt in range(2):
        try:
            conn = get_connection()
            cursor = conn.cursor()
            cursor.execute(sql, _rstrip_params(params))
            result = None
            try:
                row = cursor.fetchone()
                if row:
                    result = row[0]
            except pyodbc.ProgrammingError:
                pass
            conn.commit()
            return result
        except pyodbc.OperationalError:
            if attempt == 0:
                _thread_local.connection = None  # discard stale connection, retry once
                continue
            raise
