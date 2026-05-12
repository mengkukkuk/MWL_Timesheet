"""In-process TTL cache for read-mostly list endpoints.

Single-machine NSSM deployment means we don't need Redis. A simple
``cachetools.TTLCache`` sitting in the worker process is sufficient and
zero-infrastructure.

Usage::

    from app.cache import cached_list, invalidate

    @bp.route('/api/members')
    def list_members():
        return jsonify(cached_list('members:list', _load_members))

    @bp.route('/api/employees', methods=['POST'])
    def create_employee():
        ...
        invalidate('members:')
        invalidate('employees:')

TTL is intentionally short (5 minutes) so a missed ``invalidate`` call
only causes bounded staleness.
"""
from threading import RLock

from cachetools import TTLCache

# 128 entries x 5 minutes -- covers the three list endpoints comfortably.
_cache: TTLCache = TTLCache(maxsize=128, ttl=300)
_lock = RLock()


def cached_list(key, loader, ttl=300):
    """Return cached value for ``key`` or compute via ``loader()``.

    ``ttl`` is currently informational -- the underlying TTLCache uses a
    fixed TTL set at construction time. Kept in the signature so callers
    can express intent and so we can switch to per-key TTL later without
    a breaking change.
    """
    with _lock:
        if key in _cache:
            return _cache[key]
        value = loader()
        _cache[key] = value
        return value


def invalidate(prefix):
    """Drop every cached key whose name starts with ``prefix``."""
    with _lock:
        for k in [k for k in _cache if k.startswith(prefix)]:
            del _cache[k]
