"""Tests for BE-6: GET /api/holidays returns 200 [] for an empty month.

Previously an empty month returned 400 {'error': 'no holiday'}, which pins a
TanStack Query in a permanent error state on the React calendar/worklog
islands. The endpoint now returns the (possibly empty) list with 200.
DB layer is mocked at app.db.query (same pattern as test_worklogs_bulk.py).
"""
from datetime import date
from unittest.mock import patch

URL = '/api/holidays'


class TestHolidays:
    def test_empty_month_returns_200_empty_list(self, authed_client):
        with patch('app.db.query', return_value=[]):
            resp = authed_client.get(f'{URL}?year=2026&month=7')
        assert resp.status_code == 200
        assert resp.get_json() == []

    def test_populated_month_returns_rows(self, authed_client):
        rows = [{'date': date(2026, 1, 1), 'description': 'New Year'}]
        with patch('app.db.query', return_value=rows):
            resp = authed_client.get(f'{URL}?year=2026&month=1')
        assert resp.status_code == 200
        assert resp.get_json() == [{'date': '2026-01-01', 'description': 'New Year'}]

    def test_requires_login(self, client):
        resp = client.get(f'{URL}?year=2026&month=7')
        assert resp.status_code == 401
