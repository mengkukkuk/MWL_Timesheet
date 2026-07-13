"""
Tests for db.py — connection liveness probe and retry logic.

These tests validate the fix for the 08S01 production crash where stale
thread-local connections were reused without a real TCP liveness check.
"""
import pytest
import pyodbc
from unittest.mock import MagicMock, patch

import db


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_conn(probe_raises=False, exec_raises=False):
    """Return (conn_mock, cursor_mock).

    probe_raises  — cursor().execute("SELECT 1") raises OperationalError
    exec_raises   — cursor().execute(any_sql) raises OperationalError
    """
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value = cursor

    if probe_raises or exec_raises:
        cursor.execute.side_effect = pyodbc.OperationalError("connection dead")
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
    def test_probe_calls_execute_select_1(self):
        """Liveness check must actually execute a query, not just call cursor()."""
        conn, cursor = _make_conn()
        db._thread_local.connection = conn

        with patch('pyodbc.connect') as mock_connect:
            result = db.get_connection()

        cursor.execute.assert_called_once_with("SELECT 1")
        assert result is conn
        mock_connect.assert_not_called()

    def test_live_connection_returned_without_reconnect(self):
        """Healthy cached connection is returned; pyodbc.connect is never called."""
        conn, _ = _make_conn()
        db._thread_local.connection = conn

        with patch('pyodbc.connect') as mock_connect:
            result = db.get_connection()

        assert result is conn
        mock_connect.assert_not_called()

    def test_stale_connection_triggers_reconnect(self):
        """OperationalError from the probe causes a fresh pyodbc.connect."""
        stale, _ = _make_conn(probe_raises=True)
        db._thread_local.connection = stale

        fresh = MagicMock()
        with patch('pyodbc.connect', return_value=fresh):
            result = db.get_connection()

        assert result is fresh
        assert db._thread_local.connection is fresh

    def test_stale_connection_is_closed(self):
        """close() is called on the dead connection before reconnecting."""
        stale, _ = _make_conn(probe_raises=True)
        db._thread_local.connection = stale

        with patch('pyodbc.connect', return_value=MagicMock()):
            db.get_connection()

        stale.close.assert_called_once()

    def test_thread_local_set_to_none_before_reconnect(self):
        """_thread_local.connection is None at the moment pyodbc.connect is called."""
        stale, _ = _make_conn(probe_raises=True)
        db._thread_local.connection = stale

        seen = []

        def capture(*a, **kw):
            seen.append(db._thread_local.connection)
            return MagicMock()

        with patch('pyodbc.connect', side_effect=capture):
            db.get_connection()

        assert seen[0] is None

    def test_close_error_is_swallowed(self):
        """An error during close() of the stale connection does not propagate."""
        stale, _ = _make_conn(probe_raises=True)
        stale.close.side_effect = pyodbc.Error("already gone")
        db._thread_local.connection = stale

        fresh = MagicMock()
        with patch('pyodbc.connect', return_value=fresh):
            result = db.get_connection()   # must not raise

        assert result is fresh

    def test_no_cached_connection_connects_fresh(self):
        """With no cached connection, pyodbc.connect is always called."""
        fresh = MagicMock()
        with patch('pyodbc.connect', return_value=fresh) as mock_connect:
            result = db.get_connection()

        mock_connect.assert_called_once()
        assert result is fresh
        assert db._thread_local.connection is fresh


# ---------------------------------------------------------------------------
# query() — retry on OperationalError
# ---------------------------------------------------------------------------

class TestQueryRetry:
    def test_retries_once_and_returns_rows(self):
        """query() discards stale conn, retries, and returns rows from second attempt."""
        fail_conn, fail_cursor = _make_conn(exec_raises=True)
        good_conn, good_cursor = _make_good_conn(rows=[(7,)])
        good_cursor.description = [('id',)]

        with patch('db.get_connection', side_effect=[fail_conn, good_conn]):
            result = db.query("SELECT id FROM t")

        assert result == [{'id': 7}]

    def test_thread_local_cleared_on_retry(self):
        """_thread_local.connection is set to None before the retry call."""
        db._thread_local.connection = MagicMock()  # simulate stale cached conn

        fail_conn, fail_cursor = _make_conn(exec_raises=True)
        good_conn, good_cursor = _make_good_conn(rows=[])

        with patch('db.get_connection', side_effect=[fail_conn, good_conn]):
            db.query("SELECT 1")

        assert db._thread_local.connection is None

    def test_reraises_on_second_failure(self):
        """OperationalError propagates if both attempts fail."""
        bad_conn, _ = _make_conn(exec_raises=True)

        with patch('db.get_connection', return_value=bad_conn):
            with pytest.raises(pyodbc.OperationalError):
                db.query("SELECT 1")

    def test_get_connection_called_twice_on_retry(self):
        """Exactly two get_connection() calls happen: initial + one retry."""
        fail_conn, _ = _make_conn(exec_raises=True)
        good_conn, good_cursor = _make_good_conn(rows=[])

        with patch('db.get_connection', side_effect=[fail_conn, good_conn]) as mock_gc:
            db.query("SELECT 1")

        assert mock_gc.call_count == 2

    def test_fetchone_true_retries_correctly(self):
        """fetchone=True path also benefits from the retry on OperationalError."""
        fail_conn, _ = _make_conn(exec_raises=True)
        good_conn, good_cursor = _make_good_conn()
        good_cursor.description = [('name',)]
        good_cursor.fetchone.return_value = ('Alice',)

        with patch('db.get_connection', side_effect=[fail_conn, good_conn]):
            result = db.query("SELECT name FROM t WHERE id=?", (1,), fetchone=True)

        assert result == {'name': 'Alice'}

    def test_fetchone_returns_none_when_no_row(self):
        """fetchone=True returns None when the query matches no rows."""
        good_conn, good_cursor = _make_good_conn()
        good_cursor.description = [('name',)]
        good_cursor.fetchone.return_value = None

        with patch('db.get_connection', return_value=good_conn):
            result = db.query("SELECT name FROM t WHERE id=?", (0,), fetchone=True)

        assert result is None


# ---------------------------------------------------------------------------
# execute() — retry on OperationalError
# ---------------------------------------------------------------------------

class TestExecuteRetry:
    def test_retries_once_and_returns_inserted_id(self):
        """execute() retries and returns the OUTPUT INSERTED value on success."""
        fail_conn, _ = _make_conn(exec_raises=True)
        good_conn, good_cursor = _make_good_conn(inserted_id=99)

        with patch('db.get_connection', side_effect=[fail_conn, good_conn]):
            result = db.execute(
                "INSERT INTO t (v) OUTPUT INSERTED.id VALUES (?)", ('x',)
            )

        assert result == 99
        good_conn.commit.assert_called_once()

    def test_reraises_on_second_failure(self):
        """OperationalError propagates if both attempts fail."""
        bad_conn, _ = _make_conn(exec_raises=True)

        with patch('db.get_connection', return_value=bad_conn):
            with pytest.raises(pyodbc.OperationalError):
                db.execute("DELETE FROM t WHERE id=?", (1,))

    def test_thread_local_cleared_on_retry(self):
        """_thread_local.connection is set to None before the execute() retry."""
        db._thread_local.connection = MagicMock()

        fail_conn, fail_cursor = _make_conn(exec_raises=True)
        good_conn, good_cursor = _make_good_conn()
        good_cursor.fetchone.return_value = None

        with patch('db.get_connection', side_effect=[fail_conn, good_conn]):
            db.execute("UPDATE t SET v=? WHERE id=?", ('a', 1))

        assert db._thread_local.connection is None

    def test_returns_none_for_statement_without_output(self):
        """execute() returns None for UPDATE/DELETE that has no OUTPUT clause."""
        good_conn, good_cursor = _make_good_conn()
        good_cursor.execute.side_effect = None
        good_cursor.fetchone.side_effect = pyodbc.ProgrammingError("no results")

        with patch('db.get_connection', return_value=good_conn):
            result = db.execute("UPDATE t SET v=? WHERE id=?", ('a', 1))

        assert result is None
        good_conn.commit.assert_called_once()

    def test_get_connection_called_twice_on_retry(self):
        """Exactly two get_connection() calls on a retried execute()."""
        fail_conn, _ = _make_conn(exec_raises=True)
        good_conn, good_cursor = _make_good_conn()
        good_cursor.fetchone.return_value = None

        with patch('db.get_connection', side_effect=[fail_conn, good_conn]) as mock_gc:
            db.execute("DELETE FROM t")

        assert mock_gc.call_count == 2
