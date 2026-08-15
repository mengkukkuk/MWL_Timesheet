"""Dual-engine database access layer (SQL Server via pyodbc / PostgreSQL via psycopg2).

The engine is selected once at import time by the ``DB_ENGINE`` environment
variable (``mssql`` — the default — or ``postgres``). Only the selected
driver is imported, so a host that has just one of them installed still works.

Call sites keep writing a *single* SQL string that serves both engines:

* Parameters are always written ``?``; :func:`_to_paramstyle` rewrites them to
  ``%s`` for psycopg2.
* Constructs whose *position* differs between dialects are written as
  ``{TOKEN}`` placeholders that :func:`_render_tokens` expands to the right
  fragment on one engine and to ``''`` on the other.
* Result keys are pinned with double-quoted aliases (``AS "EmployeeID"``),
  which both engines honour verbatim, so ``row['EmployeeID']`` and the JSON
  the SPA consumes stay stable even though the Postgres schema is lowercase.
"""

import os
import re
import threading
from contextlib import contextmanager

from dotenv import load_dotenv

load_dotenv()

ENGINE = os.getenv('DB_ENGINE', 'mssql').strip().lower()
if ENGINE not in ('mssql', 'postgres'):
    raise RuntimeError(
        f"DB_ENGINE must be 'mssql' or 'postgres', got {ENGINE!r}"
    )

IS_POSTGRES = ENGINE == 'postgres'

if IS_POSTGRES:
    # psycopg2-binary ships a self-contained libpq for the Python versions it
    # has wheels for. On newer interpreters pip falls back to building from
    # source, and the resulting extension links against the local PostgreSQL
    # installation's libpq.dll. Windows ignores PATH when resolving extension
    # DLLs (Python 3.8+), so that directory has to be registered explicitly.
    _pg_bin = os.getenv('PG_BIN_DIR', '').strip()
    if _pg_bin and hasattr(os, 'add_dll_directory') and os.path.isdir(_pg_bin):
        os.add_dll_directory(_pg_bin)

    import psycopg2
    import psycopg2.extensions

    Error = psycopg2.Error
    OperationalError = psycopg2.OperationalError
    InterfaceError = psycopg2.InterfaceError
else:
    import pyodbc

    Error = pyodbc.Error
    OperationalError = pyodbc.OperationalError
    # pyodbc has no InterfaceError; alias it to OperationalError so the shared
    # `except (OperationalError, InterfaceError)` clauses stay engine-agnostic.
    InterfaceError = pyodbc.OperationalError

_thread_local = threading.local()


# ─────────────────────────────────────────────────────────────────────────────
# SQL portability
# ─────────────────────────────────────────────────────────────────────────────

# Fragments whose *position* in the statement differs between dialects. Each
# token expands to a real fragment on one engine and to '' on the other, so a
# single SQL string can carry both forms without a Python-level branch.
_TOKENS_MSSQL = {
    'OUTPUT_ID': 'OUTPUT INSERTED.id',
    'RETURNING_ID': '',
    'TOP1': 'TOP 1',
    'LIMIT1': '',
    'RECURSIVE': '',
    'MAXRECURSION': 'OPTION (MAXRECURSION 100)',
    'FALSE': '0',
    'TRUE': '1',
}

_TOKENS_POSTGRES = {
    'OUTPUT_ID': '',
    'RETURNING_ID': 'RETURNING id',
    'TOP1': '',
    'LIMIT1': 'LIMIT 1',
    'RECURSIVE': 'RECURSIVE',
    'MAXRECURSION': '',
    'FALSE': 'FALSE',
    'TRUE': 'TRUE',
}

_TOKENS = _TOKENS_POSTGRES if IS_POSTGRES else _TOKENS_MSSQL

_HAS_TOKEN = re.compile(r'\{[A-Z_0-9]+\}')


def _render_tokens(sql):
    """Expand ``{TOKEN}`` placeholders for the active engine.

    Skipped entirely when the statement contains no token, so ordinary SQL
    containing a stray brace is never passed through ``format_map``.
    """
    if not _HAS_TOKEN.search(sql):
        return sql
    return sql.format_map(_TOKENS)


# Scanner states for _to_paramstyle.
_NORMAL, _SQUOTE, _DQUOTE, _LINE_COMMENT, _BLOCK_COMMENT = range(5)


def _to_paramstyle(sql):
    """Rewrite ``?`` placeholders to psycopg2's ``%s`` paramstyle.

    A character scanner rather than a regex, because a naive replace would
    also rewrite a ``?`` inside a string literal, inside a ``--`` comment, or
    inside a double-quoted identifier (which this codebase now uses heavily
    for result-key aliases such as ``AS "EmployeeID"``).

    Every literal ``%`` is doubled regardless of state: psycopg2 applies
    ``%``-interpolation to the *whole* statement, comments included, so an
    un-escaped ``%`` raises even where SQL would consider it inert.
    """
    out = []
    state = _NORMAL
    i = 0
    n = len(sql)
    while i < n:
        ch = sql[i]
        nxt = sql[i + 1] if i + 1 < n else ''

        if state == _NORMAL:
            if ch == "'":
                state = _SQUOTE
                out.append(ch)
            elif ch == '"':
                state = _DQUOTE
                out.append(ch)
            elif ch == '-' and nxt == '-':
                state = _LINE_COMMENT
                out.append('--')
                i += 2
                continue
            elif ch == '/' and nxt == '*':
                state = _BLOCK_COMMENT
                out.append('/*')
                i += 2
                continue
            elif ch == '?':
                out.append('%s')
            elif ch == '%':
                out.append('%%')
            else:
                out.append(ch)

        elif state == _SQUOTE:
            if ch == "'" and nxt == "'":
                out.append("''")  # escaped quote, stays inside the literal
                i += 2
                continue
            if ch == "'":
                state = _NORMAL
            out.append('%%' if ch == '%' else ch)

        elif state == _DQUOTE:
            if ch == '"' and nxt == '"':
                out.append('""')  # escaped quote inside a delimited identifier
                i += 2
                continue
            if ch == '"':
                state = _NORMAL
            out.append('%%' if ch == '%' else ch)

        elif state == _LINE_COMMENT:
            if ch == '\n':
                state = _NORMAL
            out.append('%%' if ch == '%' else ch)

        elif state == _BLOCK_COMMENT:
            if ch == '*' and nxt == '/':
                state = _NORMAL
                out.append('*/')
                i += 2
                continue
            out.append('%%' if ch == '%' else ch)

        i += 1
    return ''.join(out)


def prepare(sql):
    """Render tokens and translate paramstyle for the active engine."""
    sql = _render_tokens(sql)
    return _to_paramstyle(sql) if IS_POSTGRES else sql


# ─────────────────────────────────────────────────────────────────────────────
# Expression helpers
# ─────────────────────────────────────────────────────────────────────────────
# These interpolate *literal column expressions written by us*, never user
# input, so f-string composition is safe here. They exist because the two
# dialects spell these operations with different function names AND different
# argument shapes, which a {TOKEN} placeholder cannot express.

def month(expr):
    """Month-of-year as an integer."""
    return f"EXTRACT(MONTH FROM {expr})" if IS_POSTGRES else f"MONTH({expr})"


def year(expr):
    """Year as an integer."""
    return f"EXTRACT(YEAR FROM {expr})" if IS_POSTGRES else f"YEAR({expr})"


def minutes_between(start_expr, end_expr):
    """Whole minutes from ``start_expr`` to ``end_expr``."""
    if IS_POSTGRES:
        return f"(EXTRACT(EPOCH FROM ({end_expr} - {start_expr})) / 60.0)"
    return f"DATEDIFF(MINUTE, {start_expr}, {end_expr})"


def json_members(column, alias='j'):
    """Lateral join expanding a JSON array column into one row per element.

    The expanded value is exposed as ``<alias>.value`` on both engines. A NULL
    input yields zero rows either way, matching ``CROSS APPLY OPENJSON(NULL)``.
    """
    if IS_POSTGRES:
        return (
            f"CROSS JOIN LATERAL jsonb_array_elements_text({column}::jsonb) "
            f"AS {alias}(value)"
        )
    return f"CROSS APPLY OPENJSON({column}) AS {alias}"


# ─────────────────────────────────────────────────────────────────────────────
# Connections
# ─────────────────────────────────────────────────────────────────────────────

def _connect(dbname=None):
    if IS_POSTGRES:
        schema = os.getenv('PG_SCHEMA', 'mwlts')
        # Setting search_path as a connect-time option (rather than issuing a
        # SET after connecting) means it survives every reconnect and can never
        # be lost to a rolled-back transaction.
        options = f'-c search_path={schema}'
        timezone = os.getenv('PG_TIMEZONE', '').strip()
        if timezone:
            options += f' -c timezone={timezone}'
        return psycopg2.connect(
            host=os.getenv('PG_HOST', 'localhost'),
            port=int(os.getenv('PG_PORT', '5432')),
            dbname=dbname or os.getenv('PG_DB', 'mwl'),
            user=os.getenv('PG_USER', 'postgres'),
            password=os.getenv('PG_PASSWORD', ''),
            options=options,
        )

    server = os.getenv('DB_SERVER', 'localhost')
    database = dbname or os.getenv('DB_NAME', 'MeterWorklog')
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
    return pyodbc.connect(conn_str)


def _healthy(conn):
    """Return True if the cached connection is still usable.

    For Postgres this must NOT issue a probe query: on a connection left in
    INERROR by an earlier failure, any statement raises InFailedSqlTransaction.
    Such a connection is recoverable with a rollback, so we repair and reuse it
    rather than paying for a reconnect.
    """
    if IS_POSTGRES:
        if conn.closed:
            return False
        status = conn.get_transaction_status()
        if status == psycopg2.extensions.TRANSACTION_STATUS_UNKNOWN:
            return False
        if status == psycopg2.extensions.TRANSACTION_STATUS_INERROR:
            try:
                conn.rollback()
            except Error:
                return False
        return True

    try:
        conn.cursor().execute("SELECT 1")  # real TCP liveness probe
        return True
    except Error:
        return False


def _discard():
    conn = getattr(_thread_local, 'connection', None)
    _thread_local.connection = None
    if conn is not None:
        try:
            conn.close()
        except Error:
            pass


def get_connection():
    conn = getattr(_thread_local, 'connection', None)
    if conn is not None:
        if _healthy(conn):
            return conn
        _discard()

    conn = _connect()
    _thread_local.connection = conn
    return conn


# ─────────────────────────────────────────────────────────────────────────────
# Schema initialisation
# ─────────────────────────────────────────────────────────────────────────────

def _read_sql(filename):
    # These files are UTF-8 and contain box-drawing characters in their comment
    # banners. Without an explicit encoding Python falls back to the locale
    # codepage (cp1252 on Windows), which raises UnicodeDecodeError.
    path = os.path.join(os.path.dirname(__file__), filename)
    with open(path, 'r', encoding='utf-8-sig') as f:
        return f.read()


def _init_db_postgres():
    sql = _read_sql('postgres_init_db.sql')
    schema = os.getenv('PG_SCHEMA', 'mwlts')
    conn = _connect()
    conn.autocommit = True
    try:
        cursor = conn.cursor()
        cursor.execute(f'CREATE SCHEMA IF NOT EXISTS {schema}')
        # The whole file goes in as ONE simple query. Postgres wraps a
        # multi-statement simple query in a single implicit transaction, giving
        # clean all-or-nothing semantics — and avoiding a fragile ';' splitter.
        # Swallowing per-batch errors (as the MSSQL path does) is not an option
        # here: the first failure aborts the transaction and every later
        # statement cascades, so the schema would end up empty.
        cursor.execute(sql)
    finally:
        conn.close()


def _init_db_mssql():
    sql = _read_sql('init_db.sql')
    # CREATE DATABASE / USE cannot be parameterised in T-SQL, so the script
    # carries a {DBNAME} placeholder instead of a literal name. Reject anything
    # that is not a bare identifier: the value is interpolated, not bound.
    dbname = os.getenv('DB_NAME', 'MeterWorklog').strip()
    if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', dbname):
        raise RuntimeError(f'DB_NAME is not a valid SQL Server identifier: {dbname!r}')
    sql = sql.replace('{DBNAME}', dbname)
    # Must run from master: the script opens with CREATE DATABASE + USE, so it
    # cannot start inside the database it is about to create.
    conn = _connect(dbname='master')
    conn.autocommit = True
    cursor = conn.cursor()
    # Batch separator: a line containing only GO. Matched case-insensitively and
    # tolerant of surrounding whitespace — a plain split('\nGO\n') misses the
    # lowercase/trailing-space variants and silently merges adjacent batches.
    for i, batch in enumerate(re.split(r'(?im)^[ \t]*GO[ \t]*$', sql), start=1):
        batch = batch.strip()
        if not batch:
            continue
        try:
            cursor.execute(batch)
        except Error as e:
            # Loud, prefixed warning so migration failures aren't lost in the log.
            # Print the first 200 chars of the batch so we can pinpoint which one.
            head = batch.replace('\n', ' ')[:200]
            print(f"[init_db] SQL batch #{i} FAILED: {e}\n         batch head: {head}")
    conn.close()


def init_db():
    """Apply the schema for the active engine. Safe to call repeatedly."""
    if IS_POSTGRES:
        _init_db_postgres()
    else:
        _init_db_mssql()


# ─────────────────────────────────────────────────────────────────────────────
# Query execution
# ─────────────────────────────────────────────────────────────────────────────

def _rstrip_params(params):
    """Right-trim every string parameter before binding.

    Trailing whitespace in NVARCHAR columns (notably the NVARCHAR(5)
    EmployeeID column) gets URL-encoded to %20 by the SPA, which then
    fails string-equality matching against trimmed values returned from
    other queries. Centralizing the trim here means every current and
    future INSERT/UPDATE/DELETE path is protected without having to
    audit each call site.
    """
    if not params:
        return None if IS_POSTGRES else ()
    return tuple(p.rstrip() if isinstance(p, str) else p for p in params)


def _in_transaction():
    return getattr(_thread_local, 'in_transaction', False)


def _rollback(conn):
    try:
        conn.rollback()
    except Error:
        _discard()


def _finish_read(conn):
    if _in_transaction():
        return
    try:
        conn.commit()
    except Error:
        _rollback(conn)


def query(sql, params=(), fetchone=False):
    """Run a SELECT and return dict rows (or a single dict / None)."""
    sql = prepare(sql)
    bound = _rstrip_params(params)
    for attempt in range(2):
        conn = get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(sql, bound)
            columns = [col[0] for col in cursor.description] if cursor.description else []
            if fetchone:
                row = cursor.fetchone()
                result = dict(zip(columns, row)) if row else None
            else:
                result = [dict(zip(columns, row)) for row in cursor.fetchall()]
            # Postgres opens an implicit transaction on the first statement,
            # including a SELECT. Leaving it open on a long-lived thread-local
            # connection pins xmin (starving autovacuum) and freezes the MVCC
            # snapshot, so this thread would never observe other threads' writes.
            _finish_read(conn)
            return result
        except (OperationalError, InterfaceError):
            _discard()
            if attempt == 0:
                continue
            raise
        except Error:
            _rollback(conn)
            raise


def execute(sql, params=()):
    """Run an INSERT/UPDATE/DELETE.

    Returns the generated id when the statement carries an OUTPUT/RETURNING
    clause, else None.
    """
    sql = prepare(sql)
    bound = _rstrip_params(params)
    for attempt in range(2):
        conn = get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(sql, bound)
            result = None
            # `cursor.description is not None` is the engine-agnostic way to ask
            # "did this statement produce a result set?". The old
            # fetchone()-inside-try/except probe raises on psycopg2 and leaves
            # the connection's transaction state perturbed.
            if cursor.description is not None:
                row = cursor.fetchone()
                if row:
                    result = row[0]
            if not _in_transaction():
                conn.commit()
            return result
        except (OperationalError, InterfaceError):
            _discard()
            if attempt == 0:
                continue
            raise
        except Error:
            _rollback(conn)
            raise


@contextmanager
def transaction():
    """Group several execute() calls into one atomic unit.

    Without this, a multi-statement logical operation commits after each
    statement and can half-apply if a later one fails.
    """
    if _in_transaction():
        # Already inside an outer transaction() — join it rather than opening a
        # nested one, so the outermost block owns the commit/rollback.
        yield
        return

    conn = get_connection()
    _thread_local.in_transaction = True
    try:
        yield
    except BaseException:
        _rollback(conn)
        raise
    else:
        try:
            conn.commit()
        except Error:
            _rollback(conn)
            raise
    finally:
        _thread_local.in_transaction = False
