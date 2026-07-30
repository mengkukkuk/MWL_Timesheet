"""
Tests for the email-based password reset flow:
  POST /api/forgot-password        — request a reset link (always generic 200)
  GET  /reset-password             — the standalone page opened from the email
  POST /api/reset-password/verify  — UX check of a token
  POST /api/reset-password/confirm — consume the token, set the new password
  PUT  /api/users/<id>/email       — elevated-role email management

db.query / db.execute are mocked throughout; app.auth.send_email is patched
so no real network call is made. app.auth._token_hash is used to compute the
expected stored hash without depending on send_email's arguments.
"""
import pytest
from datetime import datetime, timedelta
from unittest.mock import patch
from werkzeug.security import generate_password_hash

import app.auth as auth_mod
from app.mail import MailError

ORIGIN = 'http://localhost/'


def _post(client, url, data):
    return client.post(url, json=data, headers={'Origin': ORIGIN})


def _put(client, url, data):
    return client.put(url, json=data, headers={'Origin': ORIGIN})


def _active_user(email='user@example.com', role='Staff', last_sent=None):
    return {
        'id': 1, 'username': 'testuser', 'role': role, 'status': 'Active',
        'email': email, 'last_reset_email_sent_at': last_sent,
    }


# ---------------------------------------------------------------------------
# POST /api/forgot-password
# ---------------------------------------------------------------------------

class TestForgotPassword:
    def test_missing_username_returns_400(self, client):
        resp = _post(client, '/api/forgot-password', {})
        assert resp.status_code == 400

    @patch('app.auth.send_email')
    @patch('app.db.query')
    def test_unknown_username_returns_generic_200_and_does_not_send(self, mock_query, mock_send, client):
        mock_query.return_value = None
        resp = _post(client, '/api/forgot-password', {'username': 'nobody'})
        assert resp.status_code == 200
        assert resp.get_json()['ok'] is True
        mock_send.assert_not_called()

    @patch('app.auth._log_security_event')
    @patch('app.auth._upsert_security_state')
    @patch('app.auth.send_email')
    @patch('app.db.query')
    def test_valid_user_sends_email_and_stores_hashed_token(
            self, mock_query, mock_send, mock_upsert, mock_log, client):
        mock_query.return_value = _active_user()
        resp = _post(client, '/api/forgot-password', {'username': 'testuser'})
        assert resp.status_code == 200
        mock_send.assert_called_once()
        # to_addr is the first positional arg to send_email
        assert mock_send.call_args[0][0] == 'user@example.com'

        mock_upsert.assert_called_once()
        upsert_kwargs = mock_upsert.call_args[1]
        stored_hash = upsert_kwargs['reset_token_hash']
        assert len(stored_hash) == 64  # sha256 hex digest length
        assert stored_hash != ''
        assert isinstance(upsert_kwargs['reset_token_expires_at'], datetime)

    @patch('app.auth.send_email')
    @patch('app.db.query')
    def test_response_body_identical_for_unknown_and_known_users(self, mock_query, mock_send, client):
        mock_query.return_value = None
        resp1 = _post(client, '/api/forgot-password', {'username': 'nobody'}).get_json()

        mock_query.return_value = _active_user()
        with patch('app.auth._upsert_security_state'), patch('app.auth._log_security_event'):
            resp2 = _post(client, '/api/forgot-password', {'username': 'testuser'}).get_json()

        assert resp1 == resp2

    @patch('app.auth.send_email')
    @patch('app.db.query')
    def test_no_email_on_file_does_not_send(self, mock_query, mock_send, client):
        mock_query.return_value = _active_user(email=None)
        resp = _post(client, '/api/forgot-password', {'username': 'testuser'})
        assert resp.status_code == 200
        mock_send.assert_not_called()

    @patch('app.auth.send_email')
    @patch('app.db.query')
    def test_pending_status_does_not_send(self, mock_query, mock_send, client):
        user = _active_user()
        user['status'] = 'Pending'
        mock_query.return_value = user
        _post(client, '/api/forgot-password', {'username': 'testuser'})
        mock_send.assert_not_called()

    @patch('app.auth.send_email')
    @patch('app.db.query')
    def test_declined_status_does_not_send(self, mock_query, mock_send, client):
        user = _active_user()
        user['status'] = 'Declined'
        mock_query.return_value = user
        _post(client, '/api/forgot-password', {'username': 'testuser'})
        mock_send.assert_not_called()

    @patch('app.auth.send_email')
    @patch('app.db.query')
    def test_super_admin_does_not_send(self, mock_query, mock_send, client):
        mock_query.return_value = _active_user(role='Super_Ultimate_ADMIN')
        _post(client, '/api/forgot-password', {'username': 'superadmin'})
        mock_send.assert_not_called()

    @patch('app.auth.send_email')
    @patch('app.db.query')
    def test_within_cooldown_does_not_send(self, mock_query, mock_send, client):
        mock_query.return_value = _active_user(last_sent=datetime.now() - timedelta(seconds=10))
        _post(client, '/api/forgot-password', {'username': 'testuser'})
        mock_send.assert_not_called()

    @patch('app.auth._upsert_security_state')
    @patch('app.auth.send_email')
    @patch('app.db.query')
    def test_past_cooldown_does_send(self, mock_query, mock_send, mock_upsert, client):
        mock_query.return_value = _active_user(last_sent=datetime.now() - timedelta(minutes=10))
        with patch('app.auth._log_security_event'):
            resp = _post(client, '/api/forgot-password', {'username': 'testuser'})
        assert resp.status_code == 200
        mock_send.assert_called_once()

    @patch('app.auth._upsert_security_state')
    @patch('app.auth.send_email', side_effect=MailError('boom'))
    @patch('app.db.query')
    def test_mail_error_still_returns_generic_200(self, mock_query, mock_send, mock_upsert, client):
        mock_query.return_value = _active_user()
        resp = _post(client, '/api/forgot-password', {'username': 'testuser'})
        assert resp.status_code == 200
        assert resp.get_json()['ok'] is True


# ---------------------------------------------------------------------------
# GET /reset-password (page)
# ---------------------------------------------------------------------------

class TestResetPasswordPage:
    def test_page_loads_unauthenticated(self, client):
        resp = client.get('/reset-password')
        assert resp.status_code == 200
        body = resp.get_data(as_text=True)
        assert 'no-referrer' in body
        assert 'fonts.googleapis.com' not in body


# ---------------------------------------------------------------------------
# POST /api/reset-password/verify
# ---------------------------------------------------------------------------

class TestVerify:
    def test_missing_token_returns_invalid(self, client):
        resp = _post(client, '/api/reset-password/verify', {})
        assert resp.status_code == 200
        assert resp.get_json()['valid'] is False

    @patch('app.db.query')
    def test_valid_token_returns_true(self, mock_query, client):
        mock_query.return_value = {'user_id': 1, 'username': 'testuser'}
        resp = _post(client, '/api/reset-password/verify', {'token': 'sometoken'})
        assert resp.get_json()['valid'] is True

    @patch('app.db.query')
    def test_expired_or_garbage_token_returns_false(self, mock_query, client):
        mock_query.return_value = None
        resp = _post(client, '/api/reset-password/verify', {'token': 'garbage'})
        assert resp.get_json()['valid'] is False


# ---------------------------------------------------------------------------
# POST /api/reset-password/confirm
# ---------------------------------------------------------------------------

class TestConfirm:
    def test_short_password_returns_400(self, client):
        resp = _post(client, '/api/reset-password/confirm', {'token': 'x', 'password': 'short'})
        assert resp.status_code == 400

    @patch('app.db.query')
    def test_missing_token_returns_400(self, mock_query, client):
        resp = _post(client, '/api/reset-password/confirm', {'password': 'newpassword123'})
        assert resp.status_code == 400
        assert resp.get_json()['error'] == 'invalid_or_expired'
        mock_query.assert_not_called()

    @patch('app.db.query')
    def test_expired_or_reused_token_returns_400(self, mock_query, client):
        mock_query.return_value = None
        resp = _post(client, '/api/reset-password/confirm', {
            'token': 'expiredtoken', 'password': 'newpassword123',
        })
        assert resp.status_code == 400
        assert resp.get_json()['error'] == 'invalid_or_expired'

    @patch('app.auth._log_security_event')
    @patch('app.auth._load_failed_logins_from_db', return_value={})
    @patch('app.db.execute')
    @patch('app.db.query')
    def test_valid_token_updates_password_and_burns_token(
            self, mock_query, mock_execute, mock_load, mock_log, client):
        mock_query.return_value = {'user_id': 1, 'username': 'testuser'}
        resp = _post(client, '/api/reset-password/confirm', {
            'token': 'validtoken', 'password': 'newpassword123',
        })
        assert resp.status_code == 200
        assert resp.get_json()['ok'] is True

        calls = mock_execute.call_args_list
        password_update = next(c for c in calls if 'password_hash' in c.args[0])
        assert password_update.args[1][1] == 1  # user id
        token_clear = next(c for c in calls if 'reset_token_hash=NULL' in c.args[0])
        assert token_clear.args[1] == (1,)


# ---------------------------------------------------------------------------
# PUT /api/users/<id>/email
# ---------------------------------------------------------------------------

class TestSetUserEmail:
    @patch('app.db.execute')
    @patch('app.db.query')
    def test_elevated_user_can_set_email(self, mock_query, mock_execute, elevated_client):
        mock_query.return_value = {'role': 'Staff'}
        resp = _put(elevated_client, '/api/users/5/email', {'email': 'a@b.com'})
        assert resp.status_code == 200
        assert resp.get_json()['email'] == 'a@b.com'

    def test_staff_forbidden(self, authed_client):
        resp = _put(authed_client, '/api/users/5/email', {'email': 'a@b.com'})
        assert resp.status_code == 403

    def test_invalid_email_returns_400(self, elevated_client):
        resp = _put(elevated_client, '/api/users/5/email', {'email': 'not-an-email'})
        assert resp.status_code == 400

    @patch('app.db.execute')
    @patch('app.db.query')
    def test_empty_email_clears_to_none(self, mock_query, mock_execute, elevated_client):
        mock_query.return_value = {'role': 'Staff'}
        resp = _put(elevated_client, '/api/users/5/email', {'email': ''})
        assert resp.status_code == 200
        assert resp.get_json()['email'] is None
        assert mock_execute.call_args[0][1] == (None, 5)

    @patch('app.db.query')
    def test_leader_cannot_edit_admin_email(self, mock_query, elevated_client):
        mock_query.return_value = {'role': 'Admin'}
        resp = _put(elevated_client, '/api/users/9/email', {'email': 'a@b.com'})
        assert resp.status_code == 403

    @patch('app.db.query')
    def test_cannot_edit_super_admin_email(self, mock_query, elevated_client):
        mock_query.return_value = {'role': 'Super_Ultimate_ADMIN'}
        resp = _put(elevated_client, '/api/users/99/email', {'email': 'a@b.com'})
        assert resp.status_code == 403

    @patch('app.db.query')
    def test_user_not_found_returns_404(self, mock_query, elevated_client):
        mock_query.return_value = None
        resp = _put(elevated_client, '/api/users/404/email', {'email': 'a@b.com'})
        assert resp.status_code == 404
