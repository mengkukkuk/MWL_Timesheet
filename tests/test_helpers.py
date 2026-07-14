"""
Tests for app/helpers.py — pure utility functions with no DB or HTTP dependencies.
"""
import json
import pytest
from datetime import time

from app.helpers import format_member_ids, parse_member_ids, parse_time


# ---------------------------------------------------------------------------
# parse_member_ids
# ---------------------------------------------------------------------------

class TestParseMemberIds:
    def test_json_array_of_integers(self):
        assert parse_member_ids('[1, 2, 3]') == [1, 2, 3]

    def test_json_array_of_strings(self):
        assert parse_member_ids('["33546","33547"]') == ['33546', '33547']

    def test_json_array_mixed(self):
        assert parse_member_ids('[33546, "33547"]') == [33546, '33547']

    def test_empty_json_array(self):
        assert parse_member_ids('[]') == []

    def test_empty_string_returns_empty_list(self):
        assert parse_member_ids('') == []

    def test_none_returns_empty_list(self):
        assert parse_member_ids(None) == []

    def test_whitespace_only_returns_empty_list(self):
        assert parse_member_ids('   ') == []

    def test_legacy_hash_delimited(self):
        assert parse_member_ids('Alice#Bob#Carol') == ['Alice', 'Bob', 'Carol']

    def test_legacy_hash_strips_whitespace(self):
        assert parse_member_ids(' Alice # Bob ') == ['Alice', 'Bob']

    def test_legacy_single_value(self):
        assert parse_member_ids('Alice') == ['Alice']

    def test_malformed_json_falls_back_to_hash_split(self):
        # '[not valid' starts with '[' but is not valid JSON → falls back to '#' split
        result = parse_member_ids('[not valid json')
        assert isinstance(result, list)

    def test_non_string_input_coerced_to_str(self):
        # non-string values are coerced via str()
        result = parse_member_ids(12345)
        assert isinstance(result, list)


# ---------------------------------------------------------------------------
# format_member_ids
# ---------------------------------------------------------------------------

class TestFormatMemberIds:
    def test_list_of_strings_produces_json_array(self):
        result = format_member_ids(['33546', '33547'])
        assert json.loads(result) == ['33546', '33547']

    def test_list_of_ints_coerced_to_strings(self):
        result = format_member_ids([33546, 33547])
        assert json.loads(result) == ['33546', '33547']

    def test_single_item_list(self):
        result = format_member_ids(['33546'])
        assert json.loads(result) == ['33546']

    def test_whitespace_items_stripped_and_blank_excluded(self):
        result = format_member_ids(['  33546  ', '  ', '33547'])
        parsed = json.loads(result)
        assert '33546' in parsed
        assert '33547' in parsed
        assert '' not in parsed

    def test_empty_list_returns_none(self):
        assert format_member_ids([]) is None

    def test_none_returns_none(self):
        assert format_member_ids(None) is None

    def test_list_of_only_blank_strings_returns_empty_json_array(self):
        # The early `return None` only fires for falsy input (None / []).
        # A non-empty list of whitespace strings passes that check, strips to [],
        # and json.dumps([]) → '[]'.
        import json
        result = format_member_ids(['  ', '   '])
        assert json.loads(result) == []


# ---------------------------------------------------------------------------
# parse_time
# ---------------------------------------------------------------------------

class TestParseTime:
    def test_valid_hhmm(self):
        assert parse_time('09:30') == time(9, 30)

    def test_midnight(self):
        assert parse_time('00:00') == time(0, 0)

    def test_end_of_day(self):
        assert parse_time('23:59') == time(23, 59)

    def test_single_digit_hour(self):
        assert parse_time('8:05') == time(8, 5)

    def test_none_returns_none(self):
        assert parse_time(None) is None

    def test_empty_string_returns_none(self):
        assert parse_time('') is None

    def test_invalid_format_returns_none(self):
        assert parse_time('9am') is None

    def test_no_colon_returns_none(self):
        assert parse_time('0930') is None

    def test_non_numeric_returns_none(self):
        assert parse_time('HH:MM') is None
