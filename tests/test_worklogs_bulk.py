"""Tests for BE-1: PATCH /api/worklogs/bulk (bulk_patch_worklogs).

The endpoint does a server-side *partial* patch: only keys present in the
`fields` object are written, so an unedited column can never be blanked.
DB layer is mocked at app.db.query / app.db.execute (same pattern as
test_auth.py).
"""
from unittest.mock import patch

ORIGIN = 'http://localhost/'
URL = '/api/worklogs/bulk'


# ---------------------------------------------------------------------------
# Validation (400s) — no DB access needed
# ---------------------------------------------------------------------------

class TestBulkValidation:
    def test_missing_ids_returns_400(self, authed_client):
        resp = authed_client.patch(
            URL, json={'fields': {'status': 'Done'}}, headers={'Origin': ORIGIN})
        assert resp.status_code == 400

    def test_empty_ids_returns_400(self, authed_client):
        resp = authed_client.patch(
            URL, json={'ids': [], 'fields': {'status': 'Done'}},
            headers={'Origin': ORIGIN})
        assert resp.status_code == 400

    def test_non_integer_ids_returns_400(self, authed_client):
        resp = authed_client.patch(
            URL, json={'ids': ['abc'], 'fields': {'status': 'Done'}},
            headers={'Origin': ORIGIN})
        assert resp.status_code == 400

    def test_missing_fields_returns_400(self, authed_client):
        resp = authed_client.patch(
            URL, json={'ids': [1]}, headers={'Origin': ORIGIN})
        assert resp.status_code == 400

    def test_empty_fields_returns_400(self, authed_client):
        resp = authed_client.patch(
            URL, json={'ids': [1], 'fields': {}}, headers={'Origin': ORIGIN})
        assert resp.status_code == 400

    def test_invalid_status_returns_400(self, authed_client):
        resp = authed_client.patch(
            URL, json={'ids': [1], 'fields': {'status': 'Bogus'}},
            headers={'Origin': ORIGIN})
        assert resp.status_code == 400

    def test_note_too_long_returns_400(self, authed_client):
        resp = authed_client.patch(
            URL, json={'ids': [1], 'fields': {'note': 'x' * 1001}},
            headers={'Origin': ORIGIN})
        assert resp.status_code == 400

    def test_empty_project_returns_400(self, authed_client):
        resp = authed_client.patch(
            URL, json={'ids': [1], 'fields': {'project': '   '}},
            headers={'Origin': ORIGIN})
        assert resp.status_code == 400

    def test_unrecognized_fields_only_returns_400(self, authed_client):
        resp = authed_client.patch(
            URL, json={'ids': [1], 'fields': {'nonsense': 1}},
            headers={'Origin': ORIGIN})
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Authentication / authorization
# ---------------------------------------------------------------------------

class TestBulkAuth:
    def test_unauthenticated_returns_401(self, client):
        resp = client.patch(
            URL, json={'ids': [1], 'fields': {'status': 'Done'}},
            headers={'Origin': ORIGIN})
        assert resp.status_code == 401

    @patch('app.db.execute')
    @patch('app.db.query')
    def test_non_elevated_forbidden_on_other_rows(self, mock_query, mock_execute, authed_client):
        # authed_client is Staff, member_id '33546'; row belongs to someone else.
        mock_query.return_value = {'EmployeeID': '99999'}
        resp = authed_client.patch(
            URL, json={'ids': [7], 'fields': {'status': 'Done'}},
            headers={'Origin': ORIGIN})
        assert resp.status_code == 200
        body = resp.get_json()
        assert body['updated'] == []
        assert body['failed'] == [{'id': 7, 'error': 'forbidden'}]
        mock_execute.assert_not_called()

    @patch('app.db.execute')
    @patch('app.db.query')
    def test_elevated_may_patch_other_rows(self, mock_query, mock_execute, elevated_client):
        mock_query.return_value = {'EmployeeID': '99999'}
        resp = elevated_client.patch(
            URL, json={'ids': [7], 'fields': {'status': 'Done'}},
            headers={'Origin': ORIGIN})
        assert resp.status_code == 200
        assert resp.get_json()['updated'] == [7]
        mock_execute.assert_called_once()


# ---------------------------------------------------------------------------
# Happy-path partial patch
# ---------------------------------------------------------------------------

class TestBulkPatch:
    @patch('app.db.execute')
    @patch('app.db.query')
    def test_status_and_note_partial_patch_leaves_project_untouched(
            self, mock_query, mock_execute, authed_client):
        # Own row.
        mock_query.return_value = {'EmployeeID': '33546'}
        resp = authed_client.patch(
            URL, json={'ids': [1, 2], 'fields': {'status': 'Done', 'note': 'hi'}},
            headers={'Origin': ORIGIN})
        assert resp.status_code == 200
        assert resp.get_json()['updated'] == [1, 2]
        # UPDATE fired once per row; SQL touches only status/note/updated_at.
        assert mock_execute.call_count == 2
        sql = mock_execute.call_args_list[0].args[0]
        assert 'status=?' in sql
        assert 'note=?' in sql
        assert 'project=?' not in sql
        assert 'Description=?' not in sql

    @patch('app.db.execute')
    @patch('app.db.query')
    def test_project_remaps_to_code_and_department(
            self, mock_query, mock_execute, authed_client):
        # Project remap runs during SET-clause build (before the per-row loop),
        # so it is the FIRST query; the per-row auth lookup is second.
        mock_query.side_effect = [
            {'ProjectCode': 'P100', 'ProjectDepartment': 'ENG'},
            {'EmployeeID': '33546'},
        ]
        resp = authed_client.patch(
            URL, json={'ids': [1], 'fields': {'project': 'Widget Redesign'}},
            headers={'Origin': ORIGIN})
        assert resp.status_code == 200
        assert resp.get_json()['updated'] == [1]
        sql, params = mock_execute.call_args.args
        assert 'project=?' in sql and 'Description=?' in sql and 'ProjectDepartment=?' in sql
        # params order: ProjectCode, Description, ProjectDepartment, wid
        assert params[0] == 'P100'
        assert params[1] == 'Widget Redesign'
        assert params[2] == 'ENG'
        assert params[-1] == 1

    @patch('app.db.query')
    def test_unknown_project_returns_400(self, mock_query, authed_client):
        # Project remap runs first and finds nothing → 400 before any auth loop.
        mock_query.return_value = None
        resp = authed_client.patch(
            URL, json={'ids': [1], 'fields': {'project': 'No Such Project'}},
            headers={'Origin': ORIGIN})
        assert resp.status_code == 400

    @patch('app.db.execute')
    @patch('app.db.query')
    def test_missing_row_reported_in_failed(self, mock_query, mock_execute, authed_client):
        mock_query.return_value = None  # row not found
        resp = authed_client.patch(
            URL, json={'ids': [999], 'fields': {'status': 'Done'}},
            headers={'Origin': ORIGIN})
        assert resp.status_code == 200
        body = resp.get_json()
        assert body['updated'] == []
        assert body['failed'] == [{'id': 999, 'error': 'not found'}]
        mock_execute.assert_not_called()
