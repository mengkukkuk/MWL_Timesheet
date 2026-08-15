"""
Static SQL portability lint.

AST-walks every `app/*.py` module, finds every call site that passes SQL to
`db.query()` / `db.execute()` (bound as `db.query(...)` or
`app_pkg.db.query(...)` — the only two forms used in this codebase), and
asserts the SQL text contains none of the MSSQL-only constructs that a
single string is supposed to avoid now that both engines share one query
(see db.py's module docstring and CLAUDE.md §11).

This is a regression test for the dual-engine port: it exists so a future
edit can't silently reintroduce a bracket-quoted identifier, a raw T-SQL
function, or an un-escaped literal `%` into a query string without a test
failing at collection time — no live database required.

Run:
    pytest tests/test_sql_portability.py -v
"""
import ast
import glob
import os
import re

import pytest

APP_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'app')

# Raw MSSQL-only syntax that must go through a db.py {TOKEN} placeholder or
# expression helper (db.month/db.year/db.minutes_between/db.json_members)
# instead of being spelled out literally in app/*.py.
_BANNED_SUBSTRINGS = [
    'ISNULL(',
    'GETDATE(',
    'OUTPUT INSERTED',
    'SELECT TOP',
    'CROSS APPLY',
    'OPENJSON',
    'DATEDIFF(',
    'NVARCHAR',
]

# {TOKEN} placeholders (e.g. {MAXRECURSION}, {TOP1}) are the *correct*,
# portable spelling of these constructs — strip them before banned-substring
# scanning so the token names themselves don't false-positive.
_TOKEN_RE = re.compile(r'\{[A-Z_0-9]+\}')


def _db_call_kind(func):
    """Return 'query'/'execute' if `func` is a `db.<x>(...)` or
    `<anything>.db.<x>(...)` attribute access, else None."""
    if isinstance(func, ast.Attribute) and func.attr in ('query', 'execute'):
        value = func.value
        if isinstance(value, ast.Name) and value.id == 'db':
            return func.attr
        if isinstance(value, ast.Attribute) and value.attr == 'db':
            return func.attr
    return None


def _string_literals_in(node):
    """All literal str Constants reachable inside `node`'s subtree.

    Concatenated / multi-line SQL (`"..." + filter + "..."`, adjacent string
    literals) is common in this codebase (e.g. app/files.py's classified-item
    filters) — walking the whole subtree and joining every literal piece
    catches those without needing a full constant-folding evaluator, since
    substring/character checks don't care about the concatenation order.
    """
    return [n.value for n in ast.walk(node) if isinstance(n, ast.Constant) and isinstance(n.value, str)]


def _iter_db_sql_call_sites():
    """Yield (filepath, lineno, kind, sql_text, arg0_node, args_node) for every
    db.query/db.execute call whose first argument contains at least one
    string literal (i.e. is inspectable without executing the module)."""
    for filepath in sorted(glob.glob(os.path.join(APP_DIR, '*.py'))):
        source = open(filepath, encoding='utf-8').read()
        tree = ast.parse(source, filename=filepath)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            kind = _db_call_kind(node.func)
            if not kind or not node.args:
                continue
            arg0 = node.args[0]
            if isinstance(arg0, ast.Name):
                # SQL built up across several statements into a local
                # variable (e.g. app/files.py's _folder_name_conflict) —
                # not statically inspectable from the call site alone.
                continue
            literals = _string_literals_in(arg0)
            if not literals:
                continue
            sql_text = ''.join(literals)
            args_node = node.args[1] if len(node.args) > 1 else None
            yield (
                os.path.relpath(filepath, os.path.dirname(APP_DIR)),
                node.lineno,
                kind,
                sql_text,
                arg0,
                args_node,
            )


# Collected once at module import so every assertion below reports its own
# failing call sites via parametrize IDs, instead of one opaque list.
_CALL_SITES = list(_iter_db_sql_call_sites())


def test_finds_call_sites():
    """Sanity check the AST walk itself is wired up — catches a silently
    empty result (e.g. from a bad glob) that would make every other test in
    this file vacuously pass."""
    assert len(_CALL_SITES) > 100, (
        f"expected 100+ db.query/db.execute call sites with inspectable SQL, "
        f"found {len(_CALL_SITES)} — the AST walk may be broken"
    )


@pytest.mark.parametrize(
    'filepath,lineno,kind,sql_text,_arg0,_args',
    _CALL_SITES,
    ids=[f"{f}:{ln}" for f, ln, *_ in _CALL_SITES],
)
def test_no_bracket_quoted_identifiers(filepath, lineno, kind, sql_text, _arg0, _args):
    """`[Ident]` is MSSQL-only delimited-identifier syntax; Postgres requires
    `"Ident"`. A stray bracket here means Phase 2's mechanical rewrite missed
    a site (this caught a real one at app/__init__.py's settings-load query,
    which still read `WHERE [key]=...` before being fixed)."""
    stripped = _TOKEN_RE.sub('', sql_text)
    assert '[' not in stripped and ']' not in stripped, (
        f"{filepath}:{lineno} db.{kind}() SQL contains a bracket-quoted "
        f"identifier — use \"Ident\" instead: {sql_text!r}"
    )


@pytest.mark.parametrize(
    'filepath,lineno,kind,sql_text,_arg0,_args',
    _CALL_SITES,
    ids=[f"{f}:{ln}" for f, ln, *_ in _CALL_SITES],
)
def test_no_unescaped_percent(filepath, lineno, kind, sql_text, _arg0, _args):
    """psycopg2 %-interpolates the whole statement; a literal `%` (e.g. from
    a LIKE pattern) has to be written `%%` or it raises at execute time on
    Postgres. db._to_paramstyle() only escapes `%` inside dynamically-built
    strings it tokenizes at runtime — a literal `%` baked into the Python
    source is this test's job to catch instead."""
    stripped = _TOKEN_RE.sub('', sql_text)
    assert '%' not in stripped, (
        f"{filepath}:{lineno} db.{kind}() SQL contains a literal '%' — "
        f"escape it as '%%' for psycopg2: {sql_text!r}"
    )


@pytest.mark.parametrize(
    'filepath,lineno,kind,sql_text,_arg0,_args',
    _CALL_SITES,
    ids=[f"{f}:{ln}" for f, ln, *_ in _CALL_SITES],
)
def test_no_banned_mssql_only_syntax(filepath, lineno, kind, sql_text, _arg0, _args):
    """Raw T-SQL constructs that have a portable {TOKEN} placeholder or
    db.py expression helper and must go through it instead of being spelled
    out literally (db.month/db.year/db.minutes_between/db.json_members,
    {OUTPUT_ID}/{RETURNING_ID}, {TOP1}/{LIMIT1}, {RECURSIVE}/{MAXRECURSION})."""
    stripped = _TOKEN_RE.sub('', sql_text)
    hits = [b for b in _BANNED_SUBSTRINGS if b in stripped]
    assert not hits, (
        f"{filepath}:{lineno} db.{kind}() SQL contains banned MSSQL-only "
        f"syntax {hits} — route it through a db.py token/helper instead: {sql_text!r}"
    )


@pytest.mark.parametrize(
    'filepath,lineno,kind,sql_text,arg0,_args',
    [c for c in _CALL_SITES if isinstance(c[4], ast.Constant)],
    ids=[f"{f}:{ln}" for f, ln, *rest in _CALL_SITES if isinstance(rest[1], ast.Constant)],
)
def test_placeholder_count_matches_params(filepath, lineno, kind, sql_text, arg0, _args):
    """For call sites whose first argument is a single literal string (no
    concatenation), `?`-count must equal the number of bound params — a
    mismatch is a real bug on both engines, not just a portability issue.

    Scoped to pure-literal SQL only ("where statically determinable", per
    the migration plan): concatenated SQL may add its own `?`s conditionally
    (e.g. app/files.py's `sql += " AND id<>?"`), which this AST-level check
    can't safely evaluate.
    """
    placeholder_count = sql_text.count('?')
    if _args is None:
        expected = 0
    elif isinstance(_args, (ast.Tuple, ast.List)):
        expected = len(_args.elts)
    else:
        # params passed as a variable (e.g. a dict-built tuple) — not
        # statically countable, skip rather than false-positive.
        return
    assert placeholder_count == expected, (
        f"{filepath}:{lineno} db.{kind}() has {placeholder_count} '?' "
        f"placeholders but {expected} bound params: {sql_text!r}"
    )
