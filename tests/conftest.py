import importlib
import os
import sys

# Put the project root on the path so 'db', 'app', etc. are importable from tests/
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# SECRET_KEY must exist before the app package is imported (it fail-fasts otherwise)
os.environ.setdefault('SECRET_KEY', 'test-secret-key-32bytes-xxxxxxxxxxxx')

import pytest
import app as app_pkg
from app import app as flask_app

import db

# db.py only registers the PostgreSQL client DLL directory when DB_ENGINE=postgres
# at its own import time (see db.py's `if IS_POSTGRES:` block). The test suite's
# `db_engine` fixture needs a bare, always-available `import psycopg2` at module
# level in tests/test_db.py and tests/test_load.py regardless of the ambient
# DB_ENGINE, so the same registration is done here unconditionally. db.py's own
# load_dotenv() call (unconditional, at its top) has already populated PG_BIN_DIR
# into os.environ by the time this runs, since `import db` above executed it.
_pg_bin = os.getenv('PG_BIN_DIR', '').strip()
if _pg_bin and hasattr(os, 'add_dll_directory') and os.path.isdir(_pg_bin):
    os.add_dll_directory(_pg_bin)

# The Origin header value that matches Flask test client's default host,
# so the CSRF before_request hook passes on every POST in tests.
ORIGIN = 'http://localhost/'


@pytest.fixture(params=['mssql', 'postgres'])
def db_engine(request, monkeypatch):
    """Re-execute db.py under each engine so its module-level ENGINE /
    IS_POSTGRES / Error / OperationalError / InterfaceError bindings (and the
    conditional `import psycopg2` / `import pyodbc`) reflect the parametrized
    engine for the duration of one test.

    `importlib.reload` mutates the *existing* db module object in place
    rather than creating a new one, so every other module's `import db`
    (a module reference, not `from db import X`) sees the change too — no
    need to re-import anywhere else.
    """
    monkeypatch.setenv('DB_ENGINE', request.param)
    importlib.reload(db)
    try:
        yield db
    finally:
        # Undo the env var first so the restoring reload below picks up
        # whatever DB_ENGINE was set to before this fixture ran.
        monkeypatch.undo()
        importlib.reload(db)


@pytest.fixture(autouse=True)
def reset_app_state():
    """Reset shared module-level state between tests to prevent cross-test bleed."""
    flask_app._db_initialized = True   # skip real DB init; tests mock the DB layer
    app_pkg._failed_logins = {}
    yield
    app_pkg._failed_logins = {}


@pytest.fixture
def client():
    flask_app.config['TESTING'] = True
    with flask_app.test_client() as c:
        yield c


@pytest.fixture
def authed_client(client):
    """Staff-role authenticated client."""
    with client.session_transaction() as sess:
        sess['user_id'] = 1
        sess['username'] = 'testuser'
        sess['role'] = 'Staff'
        sess['member_id'] = '33546'
    return client


@pytest.fixture
def elevated_client(client):
    """Leader-role authenticated client (elevated access)."""
    with client.session_transaction() as sess:
        sess['user_id'] = 2
        sess['username'] = 'leader'
        sess['role'] = 'Leader'
        sess['member_id'] = '33547'
    return client


@pytest.fixture
def super_admin_client(client):
    """Super_Ultimate_ADMIN authenticated client."""
    with client.session_transaction() as sess:
        sess['user_id'] = 3
        sess['username'] = 'superadmin'
        sess['role'] = 'Super_Ultimate_ADMIN'
        sess['member_id'] = '33548'
    return client
