import os
import sys

# Put the project root on the path so 'db', 'app', etc. are importable from tests/
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# SECRET_KEY must exist before the app package is imported (it fail-fasts otherwise)
os.environ.setdefault('SECRET_KEY', 'test-secret-key-32bytes-xxxxxxxxxxxx')

import pytest
import app as app_pkg
from app import app as flask_app

# The Origin header value that matches Flask test client's default host,
# so the CSRF before_request hook passes on every POST in tests.
ORIGIN = 'http://localhost/'


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
