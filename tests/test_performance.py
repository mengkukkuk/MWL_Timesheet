"""
Performance (microbenchmark) tests.

Each test calls a function REPEATS times and asserts the mean call duration
stays under a generous threshold — fast enough to catch catastrophic
regressions without being brittle on slow CI runners.

No extra dependencies required (uses only time.perf_counter).

Run:
    pytest tests/test_performance.py -v
"""
import time
import pytest

from app.helpers import format_member_ids, parse_member_ids, parse_time
import app as app_module
import db

_is_same_origin = app_module._is_same_origin
_rstrip_params   = db._rstrip_params


# ---------------------------------------------------------------------------
# Thresholds and helpers
# ---------------------------------------------------------------------------

REPEATS = 1_000

# Pure-python, no I/O — must be sub-millisecond on any modern machine
THRESHOLD_FAST_MS   = 1.0
# Slightly heavier (JSON parse, urlparse) — still well under 5 ms
THRESHOLD_MEDIUM_MS = 5.0


def _mean_ms(fn, *args, repeats: int = REPEATS) -> float:
    """Return mean call duration in milliseconds over *repeats* iterations."""
    start = time.perf_counter()
    for _ in range(repeats):
        fn(*args)
    return (time.perf_counter() - start) * 1000 / repeats


# ---------------------------------------------------------------------------
# parse_member_ids
# ---------------------------------------------------------------------------

class TestParseMemberIdsPerformance:
    def test_json_array_small(self):
        mean = _mean_ms(parse_member_ids, '[1, 2, 3, 4, 5]')
        assert mean < THRESHOLD_MEDIUM_MS, f"mean {mean:.4f} ms > {THRESHOLD_MEDIUM_MS} ms"

    def test_json_array_large(self):
        large = str(list(range(200)))
        mean = _mean_ms(parse_member_ids, large)
        assert mean < THRESHOLD_MEDIUM_MS, f"mean {mean:.4f} ms > {THRESHOLD_MEDIUM_MS} ms"

    def test_legacy_hash_format(self):
        data = '#'.join(f'EMP{i:05d}' for i in range(30))
        mean = _mean_ms(parse_member_ids, data)
        assert mean < THRESHOLD_MEDIUM_MS, f"mean {mean:.4f} ms > {THRESHOLD_MEDIUM_MS} ms"

    def test_empty_input(self):
        mean = _mean_ms(parse_member_ids, '')
        assert mean < THRESHOLD_FAST_MS, f"mean {mean:.4f} ms > {THRESHOLD_FAST_MS} ms"

    def test_none_input(self):
        mean = _mean_ms(parse_member_ids, None)
        assert mean < THRESHOLD_FAST_MS, f"mean {mean:.4f} ms > {THRESHOLD_FAST_MS} ms"


# ---------------------------------------------------------------------------
# format_member_ids
# ---------------------------------------------------------------------------

class TestFormatMemberIdsPerformance:
    def test_small_list(self):
        ids = ['33546', '33547', '33548']
        mean = _mean_ms(format_member_ids, ids)
        assert mean < THRESHOLD_MEDIUM_MS, f"mean {mean:.4f} ms > {THRESHOLD_MEDIUM_MS} ms"

    def test_large_list(self):
        ids = [str(i) for i in range(200)]
        mean = _mean_ms(format_member_ids, ids)
        assert mean < THRESHOLD_MEDIUM_MS, f"mean {mean:.4f} ms > {THRESHOLD_MEDIUM_MS} ms"

    def test_empty_list(self):
        mean = _mean_ms(format_member_ids, [])
        assert mean < THRESHOLD_FAST_MS, f"mean {mean:.4f} ms > {THRESHOLD_FAST_MS} ms"


# ---------------------------------------------------------------------------
# parse_time
# ---------------------------------------------------------------------------

class TestParseTimePerformance:
    def test_valid_time_string(self):
        mean = _mean_ms(parse_time, '09:30')
        assert mean < THRESHOLD_FAST_MS, f"mean {mean:.4f} ms > {THRESHOLD_FAST_MS} ms"

    def test_invalid_time_string(self):
        # Error path must not be significantly slower than the happy path
        mean = _mean_ms(parse_time, 'not-a-time')
        assert mean < THRESHOLD_FAST_MS, f"mean {mean:.4f} ms > {THRESHOLD_FAST_MS} ms"

    def test_none_input(self):
        mean = _mean_ms(parse_time, None)
        assert mean < THRESHOLD_FAST_MS, f"mean {mean:.4f} ms > {THRESHOLD_FAST_MS} ms"


# ---------------------------------------------------------------------------
# _is_same_origin  (called inside the CSRF before_request hook on every POST)
# ---------------------------------------------------------------------------

class TestIsSameOriginPerformance:
    def test_matching_origins(self):
        mean = _mean_ms(_is_same_origin, 'http://localhost/', 'http://localhost/')
        assert mean < THRESHOLD_MEDIUM_MS, f"mean {mean:.4f} ms > {THRESHOLD_MEDIUM_MS} ms"

    def test_mismatched_origins(self):
        mean = _mean_ms(_is_same_origin, 'http://localhost/', 'https://evil.com/')
        assert mean < THRESHOLD_MEDIUM_MS, f"mean {mean:.4f} ms > {THRESHOLD_MEDIUM_MS} ms"

    def test_ngrok_https_domain(self):
        mean = _mean_ms(
            _is_same_origin,
            'https://mycorp.ngrok-free.dev',
            'https://mycorp.ngrok-free.dev/',
        )
        assert mean < THRESHOLD_MEDIUM_MS, f"mean {mean:.4f} ms > {THRESHOLD_MEDIUM_MS} ms"


# ---------------------------------------------------------------------------
# _rstrip_params  (called on every db.query() and db.execute())
# ---------------------------------------------------------------------------

class TestRstripParamsPerformance:
    def test_typical_string_params(self):
        params = ('33546 ', 'testuser ', 'Done ')
        mean = _mean_ms(_rstrip_params, params)
        assert mean < THRESHOLD_FAST_MS, f"mean {mean:.4f} ms > {THRESHOLD_FAST_MS} ms"

    def test_mixed_type_params(self):
        params = ('33546 ', 1, None, 3.14, 'text ')
        mean = _mean_ms(_rstrip_params, params)
        assert mean < THRESHOLD_FAST_MS, f"mean {mean:.4f} ms > {THRESHOLD_FAST_MS} ms"

    def test_empty_params(self):
        mean = _mean_ms(_rstrip_params, ())
        assert mean < THRESHOLD_FAST_MS, f"mean {mean:.4f} ms > {THRESHOLD_FAST_MS} ms"

    def test_large_params_tuple(self):
        params = tuple(f'value{i}  ' for i in range(50))
        mean = _mean_ms(_rstrip_params, params)
        assert mean < THRESHOLD_FAST_MS, f"mean {mean:.4f} ms > {THRESHOLD_FAST_MS} ms"
