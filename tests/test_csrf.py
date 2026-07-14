"""
Tests for CSRF / origin validation in app/__init__.py.

Covers:
  - _is_same_origin() unit tests (pure function)
  - verify_api_csrf_origin before_request hook (via Flask test client)
"""
import pytest
from unittest.mock import patch

import app as app_module

_is_same_origin = app_module._is_same_origin

ORIGIN = 'http://localhost/'


# ---------------------------------------------------------------------------
# _is_same_origin — unit tests
# ---------------------------------------------------------------------------

class TestIsSameOrigin:
    def test_identical_http_urls_match(self):
        assert _is_same_origin('http://localhost/', 'http://localhost/') is True

    def test_identical_https_urls_match(self):
        assert _is_same_origin('https://example.com/', 'https://example.com/') is True

    def test_different_paths_same_origin(self):
        # Only scheme + host are compared, not path
        assert _is_same_origin('http://localhost/foo', 'http://localhost/bar') is True

    def test_scheme_mismatch_returns_false(self):
        assert _is_same_origin('http://localhost/', 'https://localhost/') is False

    def test_host_mismatch_returns_false(self):
        assert _is_same_origin('http://localhost/', 'http://evil.com/') is False

    def test_port_difference_returns_false(self):
        assert _is_same_origin('http://localhost:5050/', 'http://localhost:8080/') is False

    def test_subdomain_mismatch_returns_false(self):
        assert _is_same_origin('http://app.example.com/', 'http://evil.example.com/') is False

    def test_malformed_url_returns_false(self):
        assert _is_same_origin('not a url', 'http://localhost/') is False

    def test_empty_strings_match_each_other(self):
        # urlparse('') → scheme='', netloc='' — both sides match, so returns True.
        # Empty-string origins are never in the trusted set, so this is not a security gap.
        assert _is_same_origin('', '') is True


# ---------------------------------------------------------------------------
# verify_api_csrf_origin — integration via Flask test client
# ---------------------------------------------------------------------------

class TestCsrfHook:
    """The before_request hook fires on every non-GET /api/* request."""

    # -- Requests that should PASS ------------------------------------------

    def test_post_with_matching_origin_passes(self, client):
        resp = client.post('/api/logout', json={}, headers={'Origin': ORIGIN})
        assert resp.status_code == 200

    def test_post_with_matching_referer_passes(self, client):
        resp = client.post(
            '/api/logout',
            json={},
            headers={'Referer': 'http://localhost/login'},
        )
        assert resp.status_code == 200

    def test_get_request_bypasses_csrf_check(self, client):
        # GET /api/settings is blocked by @login_required (401), not CSRF (403)
        resp = client.get('/api/settings')
        assert resp.status_code == 401

    # -- Requests that should FAIL (403) ------------------------------------

    def test_post_with_foreign_origin_returns_403(self, client):
        resp = client.post(
            '/api/logout',
            json={},
            headers={'Origin': 'https://evil.com'},
        )
        assert resp.status_code == 403
        assert resp.get_json()['error'] == 'CSRF validation failed'

    def test_post_with_no_origin_and_no_referer_returns_403(self, client):
        resp = client.post('/api/logout', json={})
        assert resp.status_code == 403
        assert resp.get_json()['error'] == 'CSRF validation failed'

    def test_post_with_foreign_referer_returns_403(self, client):
        resp = client.post(
            '/api/logout',
            json={},
            headers={'Referer': 'https://evil.com/page'},
        )
        assert resp.status_code == 403

    # -- ngrok domain trust -------------------------------------------------

    def test_ngrok_domain_trusted_when_env_set(self, client):
        with patch.dict('os.environ', {'NGROK_DOMAIN': 'mycorp.ngrok-free.dev'}):
            resp = client.post(
                '/api/logout',
                json={},
                headers={'Origin': 'https://mycorp.ngrok-free.dev'},
            )
        assert resp.status_code == 200

    def test_different_ngrok_domain_rejected(self, client):
        with patch.dict('os.environ', {'NGROK_DOMAIN': 'mycorp.ngrok-free.dev'}):
            resp = client.post(
                '/api/logout',
                json={},
                headers={'Origin': 'https://other.ngrok-free.dev'},
            )
        assert resp.status_code == 403

    # -- Tailscale domain trust ---------------------------------------------

    def test_tailscale_domain_trusted_when_env_set(self, client):
        with patch.dict('os.environ', {'TAILSCALE_DOMAIN': 'mypc.tail1234a.ts.net'}):
            resp = client.post(
                '/api/logout',
                json={},
                headers={'Origin': 'https://mypc.tail1234a.ts.net'},
            )
        assert resp.status_code == 200
