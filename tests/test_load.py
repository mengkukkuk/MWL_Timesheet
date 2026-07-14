"""
Concurrency / load tests.

Validates that the application handles simultaneous requests correctly:
  1. Thread-local DB connections are isolated per thread (core property of the fix)
  2. db.query() and db.execute() retry correctly under concurrent load
  3. _login_lock prevents counter corruption under concurrent access
  4. Stateless HTTP endpoints return correct responses under concurrent load
  5. Concurrent login attempts never produce 5xx responses

No extra dependencies required (uses concurrent.futures from stdlib).

Run:
    pytest tests/test_load.py -v
"""
import threading
import time
import pyodbc
import pytest
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from unittest.mock import MagicMock, patch
from werkzeug.security import generate_password_hash

import db
import app as app_pkg
from app import app as flask_app

ORIGIN    = 'http://localhost/'
WORKERS   = 20    # concurrent "users" for load scenarios
TIMEOUT_S = 10    # max seconds a load test may run


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_good_conn():
    """Return a mock pyodbc connection that always succeeds."""
    conn   = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value    = cursor
    cursor.execute.return_value = None
    cursor.description          = [('col',)]
    cursor.fetchall.return_value = []
    cursor.fetchone.return_value = None
    return conn


def _make_client():
    """Create an independent Flask test client (own cookie jar per thread)."""
    flask_app.config['TESTING'] = True
    flask_app._db_initialized   = True
    return flask_app.test_client()


@pytest.fixture(autouse=True)
def reset_db_thread_local():
    """Clear the thread-local connection slot before and after every test."""
    db._thread_local.connection = None
    yield
    db._thread_local.connection = None


# ---------------------------------------------------------------------------
# 1. Thread-local connection isolation
# ---------------------------------------------------------------------------

class TestThreadLocalIsolation:
    def test_each_thread_gets_its_own_connection(self):
        """
        N threads each calling get_connection() must each receive a connection
        that is local to that thread (thread-local storage is per-thread).
        """
        thread_conn_ids = {}
        lock = threading.Lock()

        def grab_connection(thread_id):
            fresh = _make_good_conn()
            with patch('pyodbc.connect', return_value=fresh):
                conn = db.get_connection()
            with lock:
                thread_conn_ids[thread_id] = id(conn)
            # Second call in the same thread must reuse the cached connection
            with patch('pyodbc.connect', return_value=_make_good_conn()):
                same_conn = db.get_connection()
            assert id(same_conn) == id(conn), "Same thread must reuse its cached connection"

        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            futures = [ex.submit(grab_connection, i) for i in range(WORKERS)]
            for f in as_completed(futures, timeout=TIMEOUT_S):
                f.result()

        assert len(thread_conn_ids) == WORKERS

    def test_stale_connection_in_one_thread_does_not_affect_another(self):
        """
        Thread A reconnecting due to a stale connection must not disturb
        thread B's healthy cached connection.
        """
        errors = []

        def thread_with_stale():
            stale = MagicMock()
            stale.cursor.return_value.execute.side_effect = pyodbc.OperationalError
            db._thread_local.connection = stale
            fresh = _make_good_conn()
            with patch('pyodbc.connect', return_value=fresh):
                try:
                    conn = db.get_connection()
                    assert conn is fresh
                except Exception as exc:
                    errors.append(exc)

        def thread_with_live():
            live = _make_good_conn()
            db._thread_local.connection = live
            with patch('pyodbc.connect') as mock_connect:
                conn = db.get_connection()
                mock_connect.assert_not_called()
                assert conn is live

        threads = [
            threading.Thread(target=thread_with_stale),
            threading.Thread(target=thread_with_live),
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=TIMEOUT_S)

        assert not errors, f"Stale-conn thread raised: {errors}"


# ---------------------------------------------------------------------------
# 2. Concurrent db.query() / db.execute() under load
# ---------------------------------------------------------------------------

class TestConcurrentDbOperations:
    def test_concurrent_queries_all_succeed(self):
        """WORKERS threads each running db.query() with a mocked good connection."""
        results = []
        errors  = []
        lock    = threading.Lock()

        def run_query(i):
            good = _make_good_conn()
            good.cursor.return_value.description         = [('id',)]
            good.cursor.return_value.fetchall.return_value = [(i,)]
            with patch('db.get_connection', return_value=good):
                try:
                    rows = db.query("SELECT id FROM t WHERE id=?", (i,))
                    with lock:
                        results.append(rows[0]['id'] if rows else None)
                except Exception as exc:
                    with lock:
                        errors.append(exc)

        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            futures = [ex.submit(run_query, i) for i in range(WORKERS)]
            for f in as_completed(futures, timeout=TIMEOUT_S):
                f.result()

        assert not errors, f"Errors during concurrent queries: {errors}"
        assert len(results) == WORKERS

    def test_concurrent_retries_no_deadlock(self):
        """
        WORKERS threads each triggering the one-retry path must all succeed
        without deadlocking or losing their retry.
        """
        success_count = 0
        lock = threading.Lock()

        def run_query_with_retry(i):
            nonlocal success_count
            fail = MagicMock()
            fail.cursor.return_value.execute.side_effect = pyodbc.OperationalError
            good = _make_good_conn()
            good.cursor.return_value.description         = [('v',)]
            good.cursor.return_value.fetchall.return_value = [(i,)]
            with patch('db.get_connection', side_effect=[fail, good]):
                db.query("SELECT v FROM t")
                with lock:
                    success_count += 1

        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            futures = [ex.submit(run_query_with_retry, i) for i in range(WORKERS)]
            for f in as_completed(futures, timeout=TIMEOUT_S):
                f.result()

        assert success_count == WORKERS, (
            f"Only {success_count}/{WORKERS} retried queries succeeded"
        )

    def test_concurrent_executes_all_succeed(self):
        """WORKERS threads each running db.execute() must all complete."""
        success_count = 0
        lock = threading.Lock()

        def run_execute(i):
            nonlocal success_count
            good = _make_good_conn()
            good.cursor.return_value.fetchone.side_effect = pyodbc.ProgrammingError
            with patch('db.get_connection', return_value=good):
                db.execute("UPDATE t SET v=? WHERE id=?", ('a', i))
                with lock:
                    success_count += 1

        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            futures = [ex.submit(run_execute, i) for i in range(WORKERS)]
            for f in as_completed(futures, timeout=TIMEOUT_S):
                f.result()

        assert success_count == WORKERS


# ---------------------------------------------------------------------------
# 3. Login lock concurrency safety
# ---------------------------------------------------------------------------

class TestLoginLockConcurrency:
    def test_concurrent_failure_increments_are_serialised(self):
        """
        WORKERS threads simultaneously incrementing the failure counter must
        produce an exact total — no lost updates.
        """
        app_pkg._failed_logins = {}

        def increment():
            with app_pkg._login_lock:
                rec = app_pkg._failed_logins.setdefault(
                    'loadtest',
                    {'count': 0, 'window_start': datetime.now(), 'locked_until': None},
                )
                rec['count'] += 1

        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            futures = [ex.submit(increment) for _ in range(WORKERS)]
            for f in as_completed(futures, timeout=TIMEOUT_S):
                f.result()

        assert app_pkg._failed_logins['loadtest']['count'] == WORKERS

    def test_lock_not_held_long_enough_to_block(self):
        """
        All WORKERS threads must be able to acquire and release the login lock
        within TIMEOUT_S seconds total (lock is never held indefinitely).
        """
        completions = []

        def hold_briefly():
            with app_pkg._login_lock:
                time.sleep(0.001)
            completions.append(1)

        start = time.perf_counter()
        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            futures = [ex.submit(hold_briefly) for _ in range(WORKERS)]
            for f in as_completed(futures, timeout=TIMEOUT_S):
                f.result()
        elapsed = time.perf_counter() - start

        assert len(completions) == WORKERS
        assert elapsed < TIMEOUT_S, f"Lock contention blocked threads for {elapsed:.2f}s"


# ---------------------------------------------------------------------------
# 4. Concurrent HTTP requests — stateless endpoints
# ---------------------------------------------------------------------------

class TestConcurrentHttpRequests:
    def test_concurrent_logout_all_return_200(self):
        """
        WORKERS independent clients POSTing /api/logout simultaneously must
        all receive 200. Each thread uses its own client to avoid shared
        cookie-jar state.
        """
        status_codes = []
        lock = threading.Lock()

        def post_logout():
            c = _make_client()
            with c:
                resp = c.post('/api/logout', json={}, headers={'Origin': ORIGIN})
                with lock:
                    status_codes.append(resp.status_code)

        threads = [threading.Thread(target=post_logout) for _ in range(WORKERS)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=TIMEOUT_S)

        assert len(status_codes) == WORKERS, "Some threads did not complete"
        assert all(s == 200 for s in status_codes), (
            f"Non-200 responses under load: {[s for s in status_codes if s != 200]}"
        )

    def test_concurrent_unauthenticated_get_all_return_401(self):
        """
        WORKERS unauthenticated GETs to /api/settings must all return 401
        (rejected by @login_required before any DB call).
        """
        status_codes = []
        lock = threading.Lock()

        def get_settings():
            c = _make_client()
            with c:
                resp = c.get('/api/settings')
                with lock:
                    status_codes.append(resp.status_code)

        threads = [threading.Thread(target=get_settings) for _ in range(WORKERS)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=TIMEOUT_S)

        assert len(status_codes) == WORKERS
        assert all(s == 401 for s in status_codes), (
            f"Unexpected status codes: {set(status_codes)}"
        )


# ---------------------------------------------------------------------------
# 5. Concurrent login attempts — no 5xx under load
# ---------------------------------------------------------------------------

class TestConcurrentLoginAttempts:
    @patch('app.auth._save_failed_logins_to_db')
    @patch('app.auth._load_failed_logins_from_db', return_value={})
    @patch('app.db.query')
    def test_wrong_passwords_never_produce_5xx(self, mock_query, _load, _save):
        """
        WORKERS simultaneous wrong-password login attempts must each receive
        401 (wrong credentials) or 429 (locked out) — never a 500.
        """
        mock_query.return_value = {
            'id': 1,
            'username': 'loadtest',
            'password_hash': generate_password_hash('correct'),
            'role': 'Staff',
            'member_id': '33546',
            'status': 'Active',
        }

        status_codes = []
        lock = threading.Lock()

        def attempt_login():
            c = _make_client()
            with c:
                resp = c.post(
                    '/api/login',
                    json={'username': 'loadtest', 'password': 'wrong'},
                    headers={'Origin': ORIGIN},
                )
                with lock:
                    status_codes.append(resp.status_code)

        threads = [threading.Thread(target=attempt_login) for _ in range(WORKERS)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=TIMEOUT_S)

        assert len(status_codes) == WORKERS, "Some threads did not complete"
        server_errors = [s for s in status_codes if s >= 500]
        assert not server_errors, f"Got 5xx responses under load: {server_errors}"
        valid = [s for s in status_codes if s in (401, 429)]
        assert len(valid) == WORKERS, f"Unexpected codes: {set(status_codes) - {401, 429}}"
