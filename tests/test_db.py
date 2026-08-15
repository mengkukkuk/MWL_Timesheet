"""
Tests for db.py — connection liveness probe and retry logic.

Parametrized over DB_ENGINE (mssql / postgres) via the `db_engine` fixture
in conftest.py: every test runs once per engine within a single pytest
session, exercising the real per-engine `_healthy()` / `_connect()` /
exception-class branches in db.py rather than assuming pyodbc.

These tests validate the fix for the 08S01 production crash where stale
thread-local connections were reused without a real liveness check, and its
Postgres equivalent (a connection left in a closed/INERROR state).
"""
import psycopg2
import psycopg2.extensions
import pyodbc
import pytest
from unittest.mock import MagicMock, patch

import db


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _connect_target(db_engine):
    """Dotted path to patch so it intercepts db.py's `_connect()` call."""
    return 'psycopg2.connect' if db_engine.IS_POSTGRES else 'pyodbc.connect'


def _make_conn(db_engine, exec_raises=False):
    """Return (conn_mock, cursor_mock) for query()/execute() retry tests.

    These tests patch 'db.get_connection' directly, so _healthy()/_connect()
    are never exercised — only cursor.execute()'s behaviour on the returned
    mock connection matters. exec_raises=True makes the query/execute call
    itself fail with the active engine's real OperationalError class, which
    is what db.py's `except (OperationalError, InterfaceError)` clause keys
    off of after the module reload.
    """
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value = cursor

    if exec_raises:
        cursor.execute.side_effect = db_engine.OperationalError("connection dead")
    else:
        cursor.description = [('col',)]
        cursor.fetchone.return_value = ('value',)
        cursor.fetchall.return_value = [('value',)]

    return conn, cursor


def _make_good_conn(rows=None, one_row=None, inserted_id=None):
    """Return a working connection mock for the retry success path."""
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value = cursor
    cursor.execute.side_effect = None

    if one_row is not None:
        cursor.description = [('col',)]
        cursor.fetchone.return_value = one_row
    elif rows is not None:
        cursor.description = [('col',)]
        cursor.fetchall.return_value = rows
    elif inserted_id is not None:
        cursor.fetchone.return_value = (inserted_id,)
    else:
        cursor.description = [('col',)]
        cursor.fetchall.return_value = []
        cursor.fetchone.return_value = None

    return conn, cursor


def _make_healthy_liveness_conn(db_engine):
    """A cached connection that _healthy() must judge alive, engine-correctly.

    Postgres: _healthy() never issues a probe query — it inspects
    conn.closed / conn.get_transaction_status() instead.
    MSSQL: _healthy() issues a real cursor().execute("SELECT 1") probe.
    """
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value = cursor

    if db_engine.IS_POSTGRES:
        conn.closed = 0
        conn.get_transaction_status.return_value = (
            psycopg2.extensions.TRANSACTION_STATUS_IDLE
        )
    else:
        cursor.execute.side_effect = None

    return conn, cursor


def _make_stale_liveness_conn(db_engine):
    """A cached connection that _healthy() must judge dead, engine-correctly.

    Postgres: a closed connection — _healthy() returns False immediately,
    without attempting a rollback/reuse (that path is reserved for a
    recoverable INERROR connection, a separate, non-reconnect scenario).
    MSSQL: the SELECT 1 probe raises OperationalError.
    """
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value = cursor

    if db_engine.IS_POSTGRES:
        conn.closed = 1
    else:
        cursor.execute.side_effect = db_engine.OperationalError("connection dead")

    return conn, cursor


@pytest.fixture(autouse=True)
def clear_thread_local():
    """Reset the thread-local connection slot before and after every test."""
    db._thread_local.connection = None
    yield
    db._thread_local.connection = None


# ---------------------------------------------------------------------------
# get_connection — liveness probe behaviour
# ---------------------------------------------------------------------------

class TestGetConnection:
    def test_probe_calls_execute_select_1(self, db_engine):
        """MSSQL: liveness check executes a real query. Postgres: it must
        NOT — _healthy() judges liveness from connection/transaction state
        alone, since a probe query on a poisoned connection would raise."""
        conn, cursor = _make_healthy_liveness_conn(db_engine)
        db_engine._thread_local.connection = conn

        with patch(_connect_target(db_engine)) as mock_connect:
            result = db_engine.get_connection()

        if db_engine.IS_POSTGRES:
            cursor.execute.assert_not_called()
            conn.get_transaction_status.assert_called_once()
        else:
            cursor.execute.assert_called_once_with("SELECT 1")
        assert result is conn
        mock_connect.assert_not_called()

    def test_live_connection_returned_without_reconnect(self, db_engine):
        """Healthy cached connection is returned; _connect() is never called."""
        conn, _ = _make_healthy_liveness_conn(db_engine)
        db_engine._thread_local.connection = conn

        with patch(_connect_target(db_engine)) as mock_connect:
            result = db_engine.get_connection()

        assert result is conn
        mock_connect.assert_not_called()

    def test_stale_connection_triggers_reconnect(self, db_engine):
        """An unhealthy cached connection causes a fresh _connect() call."""
        stale, _ = _make_stale_liveness_conn(db_engine)
        db_engine._thread_local.connection = stale

        fresh = MagicMock()
        with patch(_connect_target(db_engine), return_value=fresh):
            result = db_engine.get_connection()

        assert result is fresh
        assert db_engine._thread_local.connection is fresh

    def test_stale_connection_is_closed(self, db_engine):
        """close() is called on the dead connection before reconnecting."""
        stale, _ = _make_stale_liveness_conn(db_engine)
        db_engine._thread_local.connection = stale

        with patch(_connect_target(db_engine), return_value=MagicMock()):
            db_engine.get_connection()

        stale.close.assert_called_once()

    def test_thread_local_set_to_none_before_reconnect(self, db_engine):
        """_thread_local.connection is None at the moment _connect() runs."""
        stale, _ = _make_stale_liveness_conn(db_engine)
        db_engine._thread_local.connection = stale

        seen = []

        def capture(*a, **kw):
            seen.append(db_engine._thread_local.connection)
            return MagicMock()

        with patch(_connect_target(db_engine), side_effect=capture):
            db_engine.get_connection()

        assert seen[0] is None

    def test_close_error_is_swallowed(self, db_engine):
        """An error during close() of the stale connection does not propagate."""
        stale, _ = _make_stale_liveness_conn(db_engine)
        stale.close.side_effect = db_engine.Error("already gone")
        db_engine._thread_local.connection = stale

        fresh = MagicMock()
        with patch(_connect_target(db_engine), return_value=fresh):
            result = db_engine.get_connection()   # must not raise

        assert result is fresh

    def test_no_cached_connection_connects_fresh(self, db_engine):
        """With no cached connection, _connect() is always called."""
        fresh = MagicMock()
        with patch(_connect_target(db_engine), return_value=fresh) as mock_connect:
            result = db_engine.get_connection()

        mock_connect.assert_called_once()
        assert result is fresh
        assert db_engine._thread_local.connection is fresh


# ---------------------------------------------------------------------------
# query() — retry on OperationalError
# ---------------------------------------------------------------------------

class TestQueryRetry:
    def test_retries_once_and_returns_rows(self, db_engine):
        """query() discards stale conn, retries, and returns rows from second attempt."""
        fail_conn, fail_cursor = _make_conn(db_engine, exec_raises=True)
        good_conn, good_cursor = _make_good_conn(rows=[(7,)])
        good_cursor.description = [('id',)]

        with patch('db.get_connection', side_effect=[fail_conn, good_conn]):
            result = db_engine.query("SELECT id FROM t")

        assert result == [{'id': 7}]

    def test_thread_local_cleared_on_retry(self, db_engine):
        """_thread_local.connection is set to None before the retry call."""
        db_engine._thread_local.connection = MagicMock()  # simulate stale cached conn

        fail_conn, fail_cursor = _make_conn(db_engine, exec_raises=True)
        good_conn, good_cursor = _make_good_conn(rows=[])

        with patch('db.get_connection', side_effect=[fail_conn, good_conn]):
            db_engine.query("SELECT 1")

        assert db_engine._thread_local.connection is None

    def test_reraises_on_second_failure(self, db_engine):
        """OperationalError propagates if both attempts fail."""
        bad_conn, _ = _make_conn(db_engine, exec_raises=True)

        with patch('db.get_connection', return_value=bad_conn):
            with pytest.raises(db_engine.OperationalError):
                db_engine.query("SELECT 1")

    def test_get_connection_called_twice_on_retry(self, db_engine):
        """Exactly two get_connection() calls happen: initial + one retry."""
        fail_conn, _ = _make_conn(db_engine, exec_raises=True)
        good_conn, good_cursor = _make_good_conn(rows=[])

        with patch('db.get_connection', side_effect=[fail_conn, good_conn]) as mock_gc:
            db_engine.query("SELECT 1")

        assert mock_gc.call_count == 2

    def test_fetchone_true_retries_correctly(self, db_engine):
        """fetchone=True path also benefits from the retry on OperationalError."""
        fail_conn, _ = _make_conn(db_engine, exec_raises=True)
        good_conn, good_cursor = _make_good_conn()
        good_cursor.description = [('name',)]
        good_cursor.fetchone.return_value = ('Alice',)

        with patch('db.get_connection', side_effect=[fail_conn, good_conn]):
            result = db_engine.query("SELECT name FROM t WHERE id=?", (1,), fetchone=True)

        assert result == {'name': 'Alice'}

    def test_fetchone_returns_none_when_no_row(self, db_engine):
        """fetchone=True returns None when the query matches no rows."""
        good_conn, good_cursor = _make_good_conn()
        good_cursor.description = [('name',)]
        good_cursor.fetchone.return_value = None

        with patch('db.get_connection', return_value=good_conn):
            result = db_engine.query("SELECT name FROM t WHERE id=?", (0,), fetchone=True)

        assert result is None


# ---------------------------------------------------------------------------
# execute() — retry on OperationalError
# ---------------------------------------------------------------------------

class TestExecuteRetry:
    def test_retries_once_and_returns_inserted_id(self, db_engine):
        """execute() retries and returns the OUTPUT/RETURNING value on success."""
        fail_conn, _ = _make_conn(db_engine, exec_raises=True)
        good_conn, good_cursor = _make_good_conn(inserted_id=99)

        with patch('db.get_connection', side_effect=[fail_conn, good_conn]):
            result = db_engine.execute(
                "INSERT INTO t (v) OUTPUT INSERTED.id VALUES (?)", ('x',)
            )

        assert result == 99
        good_conn.commit.assert_called_once()

    def test_reraises_on_second_failure(self, db_engine):
        """OperationalError propagates if both attempts fail."""
        bad_conn, _ = _make_conn(db_engine, exec_raises=True)

        with patch('db.get_connection', return_value=bad_conn):
            with pytest.raises(db_engine.OperationalError):
                db_engine.execute("DELETE FROM t WHERE id=?", (1,))

    def test_thread_local_cleared_on_retry(self, db_engine):
        """_thread_local.connection is set to None before the execute() retry."""
        db_engine._thread_local.connection = MagicMock()

        fail_conn, fail_cursor = _make_conn(db_engine, exec_raises=True)
        good_conn, good_cursor = _make_good_conn()
        good_cursor.fetchone.return_value = None

        with patch('db.get_connection', side_effect=[fail_conn, good_conn]):
            db_engine.execute("UPDATE t SET v=? WHERE id=?", ('a', 1))

        assert db_engine._thread_local.connection is None

    def test_returns_none_for_statement_without_output(self, db_engine):
        """execute() returns None for UPDATE/DELETE that has no OUTPUT clause."""
        good_conn, good_cursor = _make_good_conn()
        good_cursor.execute.side_effect = None
        # A statement with no result set leaves cursor.description as None on
        # both pyodbc and psycopg2 — that is the signal execute() probes.
        good_cursor.description = None

        with patch('db.get_connection', return_value=good_conn):
            result = db_engine.execute("UPDATE t SET v=? WHERE id=?", ('a', 1))

        assert result is None
        good_conn.commit.assert_called_once()

    def test_get_connection_called_twice_on_retry(self, db_engine):
        """Exactly two get_connection() calls on a retried execute()."""
        fail_conn, _ = _make_conn(db_engine, exec_raises=True)
        good_conn, good_cursor = _make_good_conn()
        good_cursor.fetchone.return_value = None

        with patch('db.get_connection', side_effect=[fail_conn, good_conn]) as mock_gc:
            db_engine.execute("DELETE FROM t")

        assert mock_gc.call_count == 2
