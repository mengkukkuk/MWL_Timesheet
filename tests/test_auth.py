"""
Tests for app/auth.py — login, register, reset-password endpoints and auth decorators.

DB calls inside _load_failed_logins_from_db / _save_failed_logins_to_db are patched
at the function level to keep each test focused on one behaviour. The user-lookup
db.query call is patched separately via app.db.query.
"""
import pytest
from datetime import datetime, timedelta
from unittest.mock import patch
from werkzeug.security import generate_password_hash

ORIGIN = 'http://localhost/'   # matches Flask test client host → CSRF check passes


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _user(password='password123', role='Staff', status='Active', member_id='33546'):
    return {
        'id': 1,
        'username': 'testuser',
        'password_hash': generate_password_hash(password),
        'role': role,
        'member_id': member_id,
        'status': status,
    }


def _post(client, url, data):
    return client.post(url, json=data, headers={'Origin': ORIGIN})


def _put(client, url, data):
    return client.put(url, json=data, headers={'Origin': ORIGIN})


# ---------------------------------------------------------------------------
# POST /api/login
# ---------------------------------------------------------------------------

class TestLogin:
    @patch('app.auth._save_failed_logins_to_db')
    @patch('app.auth._load_failed_logins_from_db', return_value={})
    @patch('app.db.query')
    def test_success_returns_ok_and_role(self, mock_query, _load, _save, client):
        mock_query.return_value = _user()
        resp = _post(client, '/api/login', {'username': 'testuser', 'password': 'password123'})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['ok'] is True
        assert data['role'] == 'Staff'
        assert data['member_id'] == '33546'

    @patch('app.auth._save_failed_logins_to_db')
    @patch('app.auth._load_failed_logins_from_db', return_value={})
    @patch('app.db.query')
    def test_wrong_password_returns_401_with_attempts_remaining(self, mock_query, _load, _save, client):
        mock_query.return_value = _user(password='correct')
        resp = _post(client, '/api/login', {'username': 'testuser', 'password': 'wrong'})
        assert resp.status_code == 401
        assert 'attempt' in resp.get_json()['error']

    @patch('app.auth._save_failed_logins_to_db')
    @patch('app.auth._load_failed_logins_from_db')
    def test_locked_account_returns_429(self, mock_load, _save, client):
        mock_load.return_value = {
            'testuser': {
                'count': 5,
                'window_start': datetime.now() - timedelta(minutes=1),
                'locked_until': datetime.now() + timedelta(minutes=5),
            }
        }
        resp = _post(client, '/api/login', {'username': 'testuser', 'password': 'any'})
        assert resp.status_code == 429
        data = resp.get_json()
        assert 'locked_for_seconds' in data
        assert data['locked_for_seconds'] > 0

    @patch('app.auth._save_failed_logins_to_db')
    @patch('app.auth._load_failed_logins_from_db')
    @patch('app.db.query')
    def test_fifth_failure_triggers_lockout(self, mock_query, mock_load, _save, client):
        now = datetime.now()
        # Each call to _load_failed_logins_from_db returns a fresh dict with 4 prior failures
        mock_load.side_effect = lambda: {
            'testuser': {'count': 4, 'window_start': now, 'locked_until': None}
        }
        mock_query.return_value = _user(password='correct')
        resp = _post(client, '/api/login', {'username': 'testuser', 'password': 'wrong'})
        assert resp.status_code == 429
        assert 'locked_for_seconds' in resp.get_json()

    @patch('app.auth._save_failed_logins_to_db')
    @patch('app.auth._load_failed_logins_from_db', return_value={})
    @patch('app.db.query')
    def test_pending_account_returns_403(self, mock_query, _load, _save, client):
        mock_query.return_value = _user(status='Pending')
        resp = _post(client, '/api/login', {'username': 'testuser', 'password': 'password123'})
        assert resp.status_code == 403
        assert resp.get_json()['error'] == 'pending_approval'

    @patch('app.auth._save_failed_logins_to_db')
    @patch('app.auth._load_failed_logins_from_db', return_value={})
    @patch('app.db.query')
    def test_declined_account_returns_403(self, mock_query, _load, _save, client):
        mock_query.return_value = _user(status='Declined')
        resp = _post(client, '/api/login', {'username': 'testuser', 'password': 'password123'})
        assert resp.status_code == 403
        assert resp.get_json()['error'] == 'declined'

    def test_missing_username_returns_400(self, client):
        resp = _post(client, '/api/login', {'password': 'password123'})
        assert resp.status_code == 400

    def test_missing_password_returns_400(self, client):
        resp = _post(client, '/api/login', {'username': 'testuser'})
        assert resp.status_code == 400

    def test_empty_body_returns_400(self, client):
        resp = _post(client, '/api/login', {})
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# POST /api/logout
# ---------------------------------------------------------------------------

class TestLogout:
    def test_logout_returns_ok(self, authed_client):
        resp = _post(authed_client, '/api/logout', {})
        assert resp.status_code == 200
        assert resp.get_json()['ok'] is True

    def test_logout_without_session_still_returns_ok(self, client):
        # Logout is intentionally unauthenticated — just clears whatever session exists
        resp = _post(client, '/api/logout', {})
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# POST /api/register
# ---------------------------------------------------------------------------

class TestRegister:
    @patch('app.db.execute')
    @patch('app.db.query')
    def test_success_returns_201_pending(self, mock_query, mock_execute, client):
        # query call order: employee lookup → already_linked check → username check
        mock_query.side_effect = [
            {'EmployeeID': '33546', 'EmployeeName': 'Test User', 'Department': 'IT', 'Position': 'Dev'},
            None,   # EmployeeID not already linked
            None,   # username not taken
        ]
        mock_execute.return_value = None
        resp = _post(client, '/api/register', {
            'username': 'newuser',
            'password': 'securepass',
            'employee_id': '33546',
        })
        assert resp.status_code == 201
        data = resp.get_json()
        assert data['ok'] is True
        assert data['pending'] is True

    @patch('app.db.query')
    def test_unknown_employee_id_returns_404(self, mock_query, client):
        mock_query.return_value = None   # employee not in HR records
        resp = _post(client, '/api/register', {
            'username': 'newuser',
            'password': 'securepass',
            'employee_id': 'XXXXX',
        })
        assert resp.status_code == 404

    @patch('app.db.query')
    def test_already_linked_active_employee_returns_409(self, mock_query, client):
        mock_query.side_effect = [
            {'EmployeeID': '33546', 'EmployeeName': 'Test User', 'Department': 'IT', 'Position': 'Dev'},
            {'id': 99, 'status': 'Active'},   # already claimed by another account
        ]
        resp = _post(client, '/api/register', {
            'username': 'newuser',
            'password': 'securepass',
            'employee_id': '33546',
        })
        assert resp.status_code == 409

    @patch('app.db.query')
    def test_duplicate_username_returns_409(self, mock_query, client):
        mock_query.side_effect = [
            {'EmployeeID': '33546', 'EmployeeName': 'Test User', 'Department': 'IT', 'Position': 'Dev'},
            None,           # EmployeeID not linked
            {'id': 5},      # username already taken
        ]
        resp = _post(client, '/api/register', {
            'username': 'existinguser',
            'password': 'securepass',
            'employee_id': '33546',
        })
        assert resp.status_code == 409

    def test_password_too_short_returns_400(self, client):
        resp = _post(client, '/api/register', {
            'username': 'newuser',
            'password': 'short',
            'employee_id': '33546',
        })
        assert resp.status_code == 400

    def test_missing_employee_id_returns_400(self, client):
        resp = _post(client, '/api/register', {
            'username': 'newuser',
            'password': 'securepass',
        })
        assert resp.status_code == 400

    def test_missing_username_returns_400(self, client):
        resp = _post(client, '/api/register', {
            'password': 'securepass',
            'employee_id': '33546',
        })
        assert resp.status_code == 400

    def test_username_too_long_returns_400(self, client):
        resp = _post(client, '/api/register', {
            'username': 'u' * 51,
            'password': 'securepass',
            'employee_id': '33546',
        })
        assert resp.status_code == 400

    @patch('app.db.execute')
    @patch('app.db.query')
    def test_valid_email_is_stored(self, mock_query, mock_execute, client):
        mock_query.side_effect = [
            {'EmployeeID': '33546', 'EmployeeName': 'Test User', 'Department': 'IT', 'Position': 'Dev'},
            None,
            None,
        ]
        resp = _post(client, '/api/register', {
            'username': 'newuser',
            'password': 'securepass',
            'employee_id': '33546',
            'email': 'newuser@example.com',
        })
        assert resp.status_code == 201
        insert_args = mock_execute.call_args[0][1]
        assert 'newuser@example.com' in insert_args

    def test_invalid_email_returns_400(self, client):
        resp = _post(client, '/api/register', {
            'username': 'newuser',
            'password': 'securepass',
            'employee_id': '33546',
            'email': 'not-an-email',
        })
        assert resp.status_code == 400

    @patch('app.db.execute')
    @patch('app.db.query')
    def test_omitted_email_stores_none(self, mock_query, mock_execute, client):
        mock_query.side_effect = [
            {'EmployeeID': '33546', 'EmployeeName': 'Test User', 'Department': 'IT', 'Position': 'Dev'},
            None,
            None,
        ]
        resp = _post(client, '/api/register', {
            'username': 'newuser',
            'password': 'securepass',
            'employee_id': '33546',
        })
        assert resp.status_code == 201
        insert_args = mock_execute.call_args[0][1]
        assert insert_args[-1] is None


# ---------------------------------------------------------------------------
# Old POST /api/reset-password (username+staff_id) — removed in favour of
# the email-link flow in tests/test_password_reset.py.
# ---------------------------------------------------------------------------

class TestOldResetPasswordRemoved:
    def test_old_endpoint_no_longer_exists(self, client):
        resp = _post(client, '/api/reset-password', {
            'username': 'testuser',
            'staff_id': '33546',
            'password': 'newpassword123',
        })
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Auth decorators — exercised through real registered endpoints
# ---------------------------------------------------------------------------

class TestAuthDecorators:
    def test_login_required_returns_401_json_for_unauthenticated_api(self, client):
        # GET /api/settings uses @login_required and needs no DB call
        resp = client.get('/api/settings')
        assert resp.status_code == 401
        assert resp.get_json()['error'] == 'login required'

    def test_login_required_allows_authenticated_user(self, authed_client):
        # GET /api/settings returns worklog_open bool with no DB call
        resp = authed_client.get('/api/settings')
        assert resp.status_code == 200
        assert 'worklog_open' in resp.get_json()

    def test_admin_required_rejects_staff(self, authed_client):
        # PUT /api/settings/worklog-visibility uses @admin_required
        resp = _put(authed_client, '/api/settings/worklog-visibility', {'open': True})
        assert resp.status_code == 403

    def test_admin_required_rejects_leader(self, elevated_client):
        resp = _put(elevated_client, '/api/settings/worklog-visibility', {'open': True})
        assert resp.status_code == 403

    @patch('app.db.execute')
    def test_admin_required_allows_super_admin(self, mock_execute, super_admin_client):
        mock_execute.return_value = None
        resp = _put(super_admin_client, '/api/settings/worklog-visibility', {'open': True})
        assert resp.status_code == 200
