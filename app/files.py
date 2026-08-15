import hashlib
import io
import mimetypes
import os
import shutil
import uuid
import zipfile
from datetime import datetime

from flask import Blueprint
from flask import Response
from flask import current_app
from flask import jsonify
from flask import request
from flask import send_file
from flask import session

import app as app_pkg

from .auth import elevated_required
from .auth import login_required
from .constants import ELEVATED_ROLES

files_bp = Blueprint('files', __name__)

MAX_FOLDER_NAME = 200
MAX_FILENAME = 400
_ILLEGAL_NAME_CHARS = set('\\/:*?"<>|')
_HASH_CHUNK = 64 * 1024
_BULK_MAX_IDS = 500  # safety cap on bulk operations


def _clean_folder_name(raw):
    name = (raw or '').strip()
    if not name:
        return None, 'Folder name is required'
    if len(name) > MAX_FOLDER_NAME:
        return None, f'Folder name must be {MAX_FOLDER_NAME} characters or fewer'
    if name in ('.', '..'):
        return None, 'Invalid folder name'
    if any(ch in _ILLEGAL_NAME_CHARS for ch in name):
        return None, 'Folder name contains illegal characters'
    return name, None


def _folder_exists(fid):
    if fid is None:
        return True  # NULL parent = root, always valid
    row = app_pkg.db.query("SELECT id FROM file_folders WHERE id=?", (fid,), fetchone=True)
    return row is not None


def _is_descendant(candidate_id, ancestor_id):
    """Return True if candidate_id is ancestor_id or any of its descendants.

    Used to prevent cycles on folder move/rename. Walks up from candidate.
    """
    if candidate_id is None or ancestor_id is None:
        return False
    cur = candidate_id
    seen = set()
    while cur is not None and cur not in seen:
        if cur == ancestor_id:
            return True
        seen.add(cur)
        row = app_pkg.db.query("SELECT parent_id FROM file_folders WHERE id=?", (cur,), fetchone=True)
        if not row:
            return False
        cur = row.get('parent_id')
    return False


def _is_elevated():
    """True if the current session role may view/manage classified items."""
    return session.get('role') in ELEVATED_ROLES


def _folder_hidden_for_staff(fid):
    """True if folder fid or any of its ancestors is classified.

    Classified folders hide their entire subtree from non-elevated (Staff)
    users. Walks up the parent chain (guarded against cycles). Root (None)
    is never hidden.
    """
    if fid is None:
        return False
    cur = fid
    seen = set()
    while cur is not None and cur not in seen:
        seen.add(cur)
        row = app_pkg.db.query(
            "SELECT parent_id, is_classified FROM file_folders WHERE id=?",
            (cur,), fetchone=True,
        )
        if not row:
            return False
        if row.get('is_classified'):
            return True
        cur = row.get('parent_id')
    return False


def _storage_snapshot():
    """Return dict of used_bytes, cap_bytes, free_disk_bytes, file_count, folder_count."""
    row = app_pkg.db.query(
        "SELECT COUNT(*) AS cnt, COALESCE(SUM(size_bytes), 0) AS total FROM files",
        fetchone=True,
    ) or {}
    folders_row = app_pkg.db.query(
        "SELECT COUNT(*) AS cnt FROM file_folders", fetchone=True,
    ) or {}

    storage_dir = current_app.config['FILE_STORAGE_DIR']
    try:
        os.makedirs(storage_dir, exist_ok=True)
        du = shutil.disk_usage(storage_dir)
        free_disk = du.free
    except OSError:
        free_disk = 0

    return {
        'file_count': int(row.get('cnt') or 0),
        'folder_count': int(folders_row.get('cnt') or 0),
        'used_bytes': int(row.get('total') or 0),
        'cap_bytes': int(current_app.config['FILE_STORAGE_CAP_BYTES']),
        'free_disk_bytes': int(free_disk),
        'min_free_bytes': int(current_app.config['FILE_MIN_FREE_BYTES']),
    }


@files_bp.route('/api/files/stats', methods=['GET'])
@login_required
def get_stats():
    s = _storage_snapshot()
    # Back-compat: expose total_bytes alongside used_bytes
    s['total_bytes'] = s['used_bytes']
    return jsonify(s)


@files_bp.route('/api/files/tree', methods=['GET'])
@login_required
def get_tree():
    """Return the full folder tree as a nested list. Root nodes have parent_id=None."""
    rows = app_pkg.db.query(
        "SELECT id, name, parent_id, is_classified FROM file_folders ORDER BY name"
    ) or []

    elevated = _is_elevated()
    by_parent = {}
    for r in rows:
        # Staff never see classified folders. Dropping the node here also makes
        # its entire subtree unreachable (children can't attach to a missing id).
        if not elevated and r.get('is_classified'):
            continue
        by_parent.setdefault(r['parent_id'], []).append({
            'id': r['id'],
            'name': r['name'],
            'parent_id': r['parent_id'],
            'is_classified': bool(r.get('is_classified')),
            'children': [],
        })

    def attach(node):
        node['children'] = by_parent.get(node['id'], [])
        for c in node['children']:
            attach(c)
        return node

    roots = [attach(n) for n in by_parent.get(None, [])]
    return jsonify(roots)


@files_bp.route('/api/files/folder', methods=['GET'])
@files_bp.route('/api/files/folder/<int:fid>', methods=['GET'])
@login_required
def get_folder_contents(fid=None):
    """List immediate children (subfolders + files) of a folder. fid omitted = root."""
    if fid is not None and not _folder_exists(fid):
        return jsonify({'error': 'folder not found'}), 404

    elevated = _is_elevated()
    # Staff cannot open a classified folder (or any folder under one). Return 404
    # rather than 403 so its existence stays hidden.
    if not elevated and fid is not None and _folder_hidden_for_staff(fid):
        return jsonify({'error': 'folder not found'}), 404

    # Non-elevated callers must never receive classified items.
    folder_filter = '' if elevated else ' AND is_classified = {FALSE}'
    file_filter = '' if elevated else ' AND f.is_classified = {FALSE}'

    if fid is None:
        subfolders = app_pkg.db.query(
            "SELECT id, name, parent_id, is_classified FROM file_folders "
            "WHERE parent_id IS NULL" + folder_filter + " ORDER BY name"
        ) or []
        files_rows = app_pkg.db.query(
            """SELECT f.id, f.original_name, f.size_bytes, f.mime_type,
                      f.uploaded_at, f.uploaded_by, f.is_classified,
                      COALESCE(m.name, u.username) AS uploaded_by_name
               FROM files f
               LEFT JOIN users u ON f.uploaded_by = u.id
               LEFT JOIN members m ON u.member_id = m.id
               WHERE f.folder_id IS NULL""" + file_filter + """
               ORDER BY f.original_name"""
        ) or []
        breadcrumbs = []
    else:
        subfolders = app_pkg.db.query(
            "SELECT id, name, parent_id, is_classified FROM file_folders "
            "WHERE parent_id=?" + folder_filter + " ORDER BY name",
            (fid,),
        ) or []
        files_rows = app_pkg.db.query(
            """SELECT f.id, f.original_name, f.size_bytes, f.mime_type,
                      f.uploaded_at, f.uploaded_by, f.is_classified,
                      COALESCE(m.name, u.username) AS uploaded_by_name
               FROM files f
               LEFT JOIN users u ON f.uploaded_by = u.id
               LEFT JOIN members m ON u.member_id = m.id
               WHERE f.folder_id=?""" + file_filter + """
               ORDER BY f.original_name""",
            (fid,),
        ) or []
        # Build breadcrumbs in a single recursive CTE — replaces an N+1 loop
        # that ran one query per level of nesting. MAXRECURSION 100 mirrors the
        # prior implicit cycle guard (the `seen` set) and prevents infinite
        # walks on malformed parent chains.
        bc_rows = app_pkg.db.query(
            """
            WITH {RECURSIVE} bc AS (
                SELECT id, name, parent_id, 0 AS lvl
                FROM file_folders WHERE id = ?
                UNION ALL
                SELECT f.id, f.name, f.parent_id, bc.lvl + 1
                FROM file_folders f
                JOIN bc ON f.id = bc.parent_id
            )
            SELECT id, name FROM bc ORDER BY lvl DESC
            {MAXRECURSION}
            """,
            (fid,),
        ) or []
        breadcrumbs = [{'id': r['id'], 'name': r['name']} for r in bc_rows]

    for f in files_rows:
        if f.get('uploaded_at'):
            f['uploaded_at'] = f['uploaded_at'].isoformat()
        f['is_classified'] = bool(f.get('is_classified'))
    for sf in subfolders:
        sf['is_classified'] = bool(sf.get('is_classified'))

    return jsonify({
        'folder_id': fid,
        'breadcrumbs': breadcrumbs,
        'folders': subfolders,
        'files': files_rows,
    })


@files_bp.route('/api/files/folder', methods=['POST'])
@login_required
def create_folder():
    data = request.json or {}
    name, err = _clean_folder_name(data.get('name'))
    if err:
        return jsonify({'error': err}), 400

    parent_id = data.get('parent_id')
    if parent_id is not None:
        try:
            parent_id = int(parent_id)
        except (TypeError, ValueError):
            return jsonify({'error': 'invalid parent_id'}), 400
        if not _folder_exists(parent_id):
            return jsonify({'error': 'parent folder not found'}), 404

    # Uniqueness check (DB also enforces via UNIQUE constraint, but we want a friendly error)
    if parent_id is None:
        dup = app_pkg.db.query(
            "SELECT id FROM file_folders WHERE parent_id IS NULL AND name=?",
            (name,), fetchone=True,
        )
    else:
        dup = app_pkg.db.query(
            "SELECT id FROM file_folders WHERE parent_id=? AND name=?",
            (parent_id, name), fetchone=True,
        )
    if dup:
        return jsonify({'error': 'A folder with that name already exists here'}), 409

    new_id = app_pkg.db.execute(
        "INSERT INTO file_folders (name, parent_id, created_by) {OUTPUT_ID} VALUES (?, ?, ?) {RETURNING_ID}",
        (name, parent_id, session.get('user_id')),
    )
    return jsonify({'id': new_id, 'name': name, 'parent_id': parent_id}), 201


@files_bp.route('/api/files/folder/<int:fid>', methods=['PUT'])
@elevated_required
def rename_folder(fid):
    data = request.json or {}
    name, err = _clean_folder_name(data.get('name'))
    if err:
        return jsonify({'error': err}), 400

    folder = app_pkg.db.query(
        "SELECT id, parent_id FROM file_folders WHERE id=?", (fid,), fetchone=True
    )
    if not folder:
        return jsonify({'error': 'folder not found'}), 404

    parent_id = folder['parent_id']
    if parent_id is None:
        dup = app_pkg.db.query(
            "SELECT id FROM file_folders WHERE parent_id IS NULL AND name=? AND id<>?",
            (name, fid), fetchone=True,
        )
    else:
        dup = app_pkg.db.query(
            "SELECT id FROM file_folders WHERE parent_id=? AND name=? AND id<>?",
            (parent_id, name, fid), fetchone=True,
        )
    if dup:
        return jsonify({'error': 'A folder with that name already exists here'}), 409

    # Optional classified toggle (elevated-only, enforced by the decorator).
    if 'is_classified' in data:
        classified = True if data.get('is_classified') else False
        app_pkg.db.execute(
            "UPDATE file_folders SET name=?, is_classified=? WHERE id=?",
            (name, classified, fid),
        )
    else:
        app_pkg.db.execute("UPDATE file_folders SET name=? WHERE id=?", (name, fid))
    return jsonify({'ok': True, 'id': fid, 'name': name})


def _folder_name_conflict(parent_id, name, exclude_id=None):
    """True if another folder named `name` already sits under `parent_id`.

    Mirrors the uniqueness check in create_folder/rename_folder (and the DB
    UNIQUE constraint behind them) — note the NULL-parent split, since
    `parent_id = NULL` never matches in SQL.
    """
    if parent_id is None:
        sql = "SELECT id FROM file_folders WHERE parent_id IS NULL AND name=?"
        params = (name,)
    else:
        sql = "SELECT id FROM file_folders WHERE parent_id=? AND name=?"
        params = (parent_id, name)
    if exclude_id is not None:
        sql += " AND id<>?"
        params = params + (exclude_id,)
    return app_pkg.db.query(sql, params, fetchone=True) is not None


@files_bp.route('/api/files/folder/<int:fid>/move', methods=['POST'])
@elevated_required
def move_folder(fid):
    """Re-parent a folder. Body: {parent_id: int|null}.  null = move to root.

    Elevated-only, matching the other folder mutations (rename/delete).
    """
    folder = app_pkg.db.query(
        "SELECT id, name, parent_id FROM file_folders WHERE id=?", (fid,), fetchone=True
    )
    if not folder:
        return jsonify({'error': 'folder not found'}), 404

    data = request.json or {}
    target = data.get('parent_id')
    if target is not None:
        try:
            target = int(target)
        except (TypeError, ValueError):
            return jsonify({'error': 'invalid parent_id'}), 400
        if not _folder_exists(target):
            return jsonify({'error': 'target folder not found'}), 404

    if target == fid:
        return jsonify({'error': 'A folder cannot contain itself'}), 400
    # Cycle guard: walks UP from the proposed parent looking for fid, i.e. is
    # the destination inside this folder's own subtree? Argument order matters —
    # swapping these returns False for every real cycle.
    if _is_descendant(target, fid):
        return jsonify({'error': 'Cannot move a folder into one of its own subfolders'}), 400

    if target == folder['parent_id']:
        return jsonify({'ok': True, 'id': fid, 'parent_id': target})   # no-op

    if _folder_name_conflict(target, folder['name'], exclude_id=fid):
        return jsonify({'error': 'A folder with that name already exists here'}), 409

    app_pkg.db.execute("UPDATE file_folders SET parent_id=? WHERE id=?", (target, fid))
    return jsonify({'ok': True, 'id': fid, 'parent_id': target})


def _storage_paths_for_new():
    """Return (absolute_dir, stored_name, relative_path_for_db)."""
    now = datetime.now()
    subdir = os.path.join(str(now.year), f"{now.month:02d}")
    abs_dir = os.path.join(current_app.config['FILE_STORAGE_DIR'], subdir)
    os.makedirs(abs_dir, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}.bin"
    rel_path = f"{subdir}/{stored_name}".replace('\\', '/')
    return abs_dir, stored_name, rel_path


def _resolve_blob_path(stored_name):
    """Build absolute path from DB stored_name; raise if it escapes FILE_STORAGE_DIR."""
    base = os.path.realpath(current_app.config['FILE_STORAGE_DIR'])
    # stored_name in DB is a forward-slash relative path like "2026/04/<uuid>.bin"
    candidate = os.path.realpath(os.path.join(base, stored_name.replace('/', os.sep)))
    if not candidate.startswith(base + os.sep) and candidate != base:
        raise ValueError('resolved path escapes storage root')
    return candidate


def _safe_download_name(original):
    """Sanitize original filename for the Content-Disposition header.

    werkzeug.secure_filename strips non-ASCII; we keep a Latin-1 fallback for the
    header and rely on filename* (RFC 5987) via send_file's download_name.
    """
    cleaned = (original or '').strip() or 'file'
    return cleaned


@files_bp.route('/api/files/upload', methods=['POST'])
@login_required
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'no file in request'}), 400
    f = request.files['file']
    if not f or not f.filename:
        return jsonify({'error': 'empty file'}), 400

    # werkzeug already strips path components from uploaded filenames, so traversal is blocked.
    # We keep the original name only for display / download header, never for disk paths.
    original = os.path.basename(f.filename).strip()
    if not original:
        return jsonify({'error': 'empty filename'}), 400
    if len(original) > MAX_FILENAME:
        return jsonify({'error': f'filename must be {MAX_FILENAME} characters or fewer'}), 400

    folder_id = request.form.get('folder_id')
    if folder_id in (None, '', 'null'):
        folder_id = None
    else:
        try:
            folder_id = int(folder_id)
        except (TypeError, ValueError):
            return jsonify({'error': 'invalid folder_id'}), 400
        if not _folder_exists(folder_id):
            return jsonify({'error': 'folder not found'}), 404

    # ── Storage guards: global cap + free-disk floor ──────────────────────
    # Best-effort pre-check. If we can't get Content-Length the streaming loop
    # below still trips ENOSPC and rolls back cleanly, so this is advisory.
    snap = _storage_snapshot()
    incoming = request.content_length or 0  # multipart framing overhead is tiny

    if snap['free_disk_bytes'] and snap['free_disk_bytes'] - incoming < snap['min_free_bytes']:
        free_mb = snap['free_disk_bytes'] // (1024 * 1024)
        min_mb = snap['min_free_bytes'] // (1024 * 1024)
        return jsonify({
            'error': f'Server disk low: only {free_mb} MB free (need ≥ {min_mb} MB). Please contact an admin.'
        }), 507  # Insufficient Storage

    if snap['cap_bytes'] and (snap['used_bytes'] + incoming) > snap['cap_bytes']:
        used_mb = snap['used_bytes'] // (1024 * 1024)
        cap_mb = snap['cap_bytes'] // (1024 * 1024)
        return jsonify({
            'error': f'Global storage cap reached: {used_mb} MB used of {cap_mb} MB. Delete some files first.'
        }), 507

    abs_dir, stored_name, rel_path = _storage_paths_for_new()
    tmp_path = os.path.join(abs_dir, stored_name + '.part')
    final_path = os.path.join(abs_dir, stored_name)

    sha = hashlib.sha256()
    size = 0
    try:
        with open(tmp_path, 'wb') as out:
            while True:
                chunk = f.stream.read(_HASH_CHUNK)
                if not chunk:
                    break
                sha.update(chunk)
                size += len(chunk)
                out.write(chunk)
        os.replace(tmp_path, final_path)
    except Exception as exc:
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except OSError:
            pass
        return jsonify({'error': f'upload failed: {exc}'}), 500

    mime = f.mimetype or mimetypes.guess_type(original)[0] or 'application/octet-stream'

    new_id = app_pkg.db.execute(
        """INSERT INTO files (folder_id, original_name, stored_name, size_bytes, mime_type,
                              sha256, uploaded_by)
           {OUTPUT_ID}
           VALUES (?, ?, ?, ?, ?, ?, ?)
           {RETURNING_ID}""",
        (folder_id, original, rel_path, size, mime, sha.hexdigest(), session.get('user_id')),
    )
    return jsonify({
        'id': new_id,
        'original_name': original,
        'size_bytes': size,
        'mime_type': mime,
        'folder_id': folder_id,
    }), 201


@files_bp.route('/api/files/<int:fid>/download', methods=['GET'])
@login_required
def download_file(fid):
    row = app_pkg.db.query(
        "SELECT id, original_name, stored_name, mime_type, folder_id, is_classified "
        "FROM files WHERE id=?",
        (fid,), fetchone=True,
    )
    if not row:
        return jsonify({'error': 'file not found'}), 404

    # Staff cannot download a classified file, nor anything under a classified
    # folder. 404 (not 403) so existence stays hidden.
    if not _is_elevated() and (
        row.get('is_classified') or _folder_hidden_for_staff(row.get('folder_id'))
    ):
        return jsonify({'error': 'file not found'}), 404

    try:
        abs_path = _resolve_blob_path(row['stored_name'])
    except ValueError:
        return jsonify({'error': 'invalid stored path'}), 500
    if not os.path.exists(abs_path):
        return jsonify({'error': 'file missing on disk'}), 410

    # ?inline=1 → render in-browser (used by image preview lightbox).
    inline = request.args.get('inline') in ('1', 'true', 'yes')
    return send_file(
        abs_path,
        mimetype=row['mime_type'] or 'application/octet-stream',
        as_attachment=not inline,
        download_name=_safe_download_name(row['original_name']),
        conditional=True,
    )


@files_bp.route('/api/files/<int:fid>', methods=['PATCH'])
@elevated_required
def update_file(fid):
    """Update a file's classified flag. Elevated-only (decorator enforced)."""
    row = app_pkg.db.query("SELECT id FROM files WHERE id=?", (fid,), fetchone=True)
    if not row:
        return jsonify({'error': 'file not found'}), 404

    data = request.json or {}
    classified = True if data.get('is_classified') else False
    app_pkg.db.execute("UPDATE files SET is_classified=? WHERE id=?", (classified, fid))
    return jsonify({'ok': True, 'id': fid, 'is_classified': bool(classified)})


@files_bp.route('/api/files/<int:fid>', methods=['DELETE'])
@login_required
def delete_file(fid):
    row = app_pkg.db.query(
        "SELECT id, stored_name, uploaded_by FROM files WHERE id=?",
        (fid,), fetchone=True,
    )
    if not row:
        return jsonify({'error': 'file not found'}), 404

    is_elevated = session.get('role') in ELEVATED_ROLES
    is_uploader = row['uploaded_by'] == session.get('user_id')
    if not (is_elevated or is_uploader):
        return jsonify({'error': 'permission denied'}), 403

    app_pkg.db.execute("DELETE FROM files WHERE id=?", (fid,))

    try:
        abs_path = _resolve_blob_path(row['stored_name'])
        if os.path.exists(abs_path):
            os.remove(abs_path)
    except (ValueError, OSError) as exc:
        # DB row is already gone; log and move on (orphan blob can be cleaned later)
        current_app.logger.warning("file delete: blob removal failed for id=%s: %s", fid, exc)

    return jsonify({'ok': True})


@files_bp.route('/api/files/folder/<int:fid>', methods=['DELETE'])
@elevated_required
def delete_folder(fid):
    folder = app_pkg.db.query("SELECT id FROM file_folders WHERE id=?", (fid,), fetchone=True)
    if not folder:
        return jsonify({'error': 'folder not found'}), 404

    child = app_pkg.db.query(
        "SELECT {TOP1} id FROM file_folders WHERE parent_id=? {LIMIT1}", (fid,), fetchone=True
    )
    if child:
        return jsonify({'error': 'Folder is not empty (contains subfolders)'}), 409

    file_in = app_pkg.db.query(
        "SELECT {TOP1} id FROM files WHERE folder_id=? {LIMIT1}", (fid,), fetchone=True
    )
    if file_in:
        return jsonify({'error': 'Folder is not empty (contains files)'}), 409

    app_pkg.db.execute("DELETE FROM file_folders WHERE id=?", (fid,))
    return jsonify({'ok': True})


# ─────────────────────────────────────────────────────────────────────────────
# Bulk operations + extras (Tier 1/2/3)
# ─────────────────────────────────────────────────────────────────────────────

def _coerce_id_list(raw):
    """Validate body.ids → list[int]. Returns (ids, error_response_or_None)."""
    if not isinstance(raw, list) or not raw:
        return None, (jsonify({'error': 'ids must be a non-empty list'}), 400)
    if len(raw) > _BULK_MAX_IDS:
        return None, (jsonify({'error': f'too many ids (max {_BULK_MAX_IDS})'}), 400)
    out = []
    for v in raw:
        try:
            out.append(int(v))
        except (TypeError, ValueError):
            return None, (jsonify({'error': 'all ids must be integers'}), 400)
    return out, None


def _select_files_by_ids(ids):
    """Return file rows for the given ids. Uses a parameterised IN clause."""
    if not ids:
        return []
    placeholders = ','.join('?' for _ in ids)
    rows = app_pkg.db.query(
        f"SELECT id, original_name, stored_name, size_bytes, mime_type, uploaded_by, "
        f"folder_id, is_classified "
        f"FROM files WHERE id IN ({placeholders})",
        tuple(ids),
    )
    return rows or []


def _file_hidden_for_staff(row):
    """True if a non-elevated user must not see/access this file row."""
    return bool(row.get('is_classified')) or _folder_hidden_for_staff(row.get('folder_id'))


def _unique_zip_name(used, name):
    """Append ' (n)' suffix to avoid duplicate names inside the zip."""
    if name not in used:
        used.add(name)
        return name
    base, ext = os.path.splitext(name)
    n = 2
    while f"{base} ({n}){ext}" in used:
        n += 1
    candidate = f"{base} ({n}){ext}"
    used.add(candidate)
    return candidate


def _build_zip_bytes(rows):
    """Build a zip of the given file rows and return the full byte buffer.

    Uses io.BytesIO so zipfile has full seek/tell support (required for
    updating local file headers). Built eagerly inside the request context
    to avoid current_app access issues from a streaming generator.
    """
    buf = io.BytesIO()
    used_names = set()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_STORED, allowZip64=True) as zf:
        for row in rows:
            try:
                abs_path = _resolve_blob_path(row['stored_name'])
            except (ValueError, AttributeError, TypeError):
                continue
            if not os.path.exists(abs_path):
                continue
            arcname = _unique_zip_name(used_names, row['original_name'] or f"file_{row['id']}")
            zinfo = zipfile.ZipInfo(filename=arcname)
            zinfo.compress_type = zipfile.ZIP_STORED
            with zf.open(zinfo, 'w') as zentry:
                with open(abs_path, 'rb') as src:
                    while True:
                        chunk = src.read(_HASH_CHUNK)
                        if not chunk:
                            break
                        zentry.write(chunk)
    return buf.getvalue()


@files_bp.route('/api/files/bulk/download', methods=['POST'])
@login_required
def bulk_download():
    """Return a zip of the selected files. No permission filter — same as
    single-file download (any logged-in user can download any file).

    Built eagerly (not streamed) so any error propagates back as JSON instead
    of a half-written stream, and so current_app config access stays inside
    the request context.
    """
    data = request.json or {}
    ids, err = _coerce_id_list(data.get('ids'))
    if err:
        return err
    rows = _select_files_by_ids(ids)
    # Staff never receive classified files (or files under a classified folder).
    if not _is_elevated():
        rows = [r for r in rows if not _file_hidden_for_staff(r)]
    if not rows:
        return jsonify({'error': 'no files found'}), 404

    # Total size sanity check — refuse > 2 GB to keep the in-memory build sane.
    total = sum(int(r.get('size_bytes') or 0) for r in rows)
    if total > 2 * 1024 * 1024 * 1024:
        return jsonify({'error': 'selection too large (>2 GB). Download in smaller batches.'}), 413

    try:
        zip_bytes = _build_zip_bytes(rows)
    except Exception as exc:
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'zip build failed: {exc}'}), 500

    if not zip_bytes:
        return jsonify({'error': 'no readable files'}), 404

    fname = f"files-{datetime.now().strftime('%Y-%m-%d-%H%M%S')}.zip"
    headers = {
        'Content-Disposition': f'attachment; filename="{fname}"',
        'Content-Length': str(len(zip_bytes)),
    }
    return Response(zip_bytes, mimetype='application/zip', headers=headers)


@files_bp.route('/api/files/bulk/delete', methods=['POST'])
@login_required
def bulk_delete():
    """Delete multiple files. Per-id permission check: uploader OR elevated.
    Reports per-id success/failure rather than aborting on first error."""
    data = request.json or {}
    ids, err = _coerce_id_list(data.get('ids'))
    if err:
        return err

    rows = _select_files_by_ids(ids)
    found_ids = {r['id'] for r in rows}
    user_id = session.get('user_id')
    is_elevated = session.get('role') in ELEVATED_ROLES

    deleted = []
    failed = []

    # Track ids the client sent that didn't resolve to a row
    for missing_id in (set(ids) - found_ids):
        failed.append({'id': missing_id, 'reason': 'not found'})

    for row in rows:
        rid = row['id']
        # Staff cannot act on classified files — report as not found to keep
        # existence hidden.
        if not is_elevated and _file_hidden_for_staff(row):
            failed.append({'id': rid, 'reason': 'not found'})
            continue
        if not (is_elevated or row['uploaded_by'] == user_id):
            failed.append({'id': rid, 'reason': 'permission denied'})
            continue
        try:
            app_pkg.db.execute("DELETE FROM files WHERE id=?", (rid,))
        except Exception as exc:
            failed.append({'id': rid, 'reason': f'db error: {exc}'})
            continue
        try:
            abs_path = _resolve_blob_path(row['stored_name'])
            if os.path.exists(abs_path):
                os.remove(abs_path)
        except (ValueError, OSError) as exc:
            print(f"bulk delete: blob removal failed for id={rid}: {exc}")
            # DB row already gone, count as deleted; orphan blob can be reaped.
        deleted.append(rid)

    return jsonify({'deleted': deleted, 'failed': failed})


@files_bp.route('/api/files/<int:fid>/move', methods=['POST'])
@login_required
def move_file(fid):
    """Move a file to a different folder. Permission: uploader OR elevated.
    Body: {folder_id: int|null}.  null = move to root.
    """
    row = app_pkg.db.query(
        "SELECT id, uploaded_by, folder_id, is_classified FROM files WHERE id=?",
        (fid,), fetchone=True,
    )
    if not row:
        return jsonify({'error': 'file not found'}), 404

    is_elevated = session.get('role') in ELEVATED_ROLES
    # Staff cannot move a classified file (or one under a classified folder).
    if not is_elevated and _file_hidden_for_staff(row):
        return jsonify({'error': 'file not found'}), 404
    if not (is_elevated or row['uploaded_by'] == session.get('user_id')):
        return jsonify({'error': 'permission denied'}), 403

    data = request.json or {}
    target = data.get('folder_id')
    if target is not None:
        try:
            target = int(target)
        except (TypeError, ValueError):
            return jsonify({'error': 'invalid folder_id'}), 400
        if not _folder_exists(target):
            return jsonify({'error': 'target folder not found'}), 404

    app_pkg.db.execute("UPDATE files SET folder_id=? WHERE id=?", (target, fid))
    return jsonify({'ok': True, 'id': fid, 'folder_id': target})


@files_bp.route('/api/files/folder/<int:fid>/stats', methods=['GET'])
@files_bp.route('/api/files/folder/stats', methods=['GET'])
@login_required
def folder_stats(fid=None):
    """Return total file count + total size for the subtree rooted at fid.
    fid omitted = root subtree (all files everywhere).
    """
    if fid is not None and not _folder_exists(fid):
        return jsonify({'error': 'folder not found'}), 404

    if fid is None:
        # Whole library
        row = app_pkg.db.query(
            "SELECT COUNT(*) AS cnt, COALESCE(SUM(size_bytes), 0) AS total FROM files",
            fetchone=True,
        ) or {}
        folder_count = (app_pkg.db.query(
            "SELECT COUNT(*) AS cnt FROM file_folders", fetchone=True,
        ) or {}).get('cnt') or 0
    else:
        # Walk the subtree (small trees expected; iterative)
        ids = [fid]
        stack = [fid]
        while stack:
            cur = stack.pop()
            kids = app_pkg.db.query(
                "SELECT id FROM file_folders WHERE parent_id=?", (cur,)
            ) or []
            for k in kids:
                ids.append(k['id'])
                stack.append(k['id'])
        placeholders = ','.join('?' for _ in ids)
        row = app_pkg.db.query(
            f"SELECT COUNT(*) AS cnt, COALESCE(SUM(size_bytes), 0) AS total "
            f"FROM files WHERE folder_id IN ({placeholders})",
            tuple(ids), fetchone=True,
        ) or {}
        folder_count = len(ids) - 1  # exclude self

    return jsonify({
        'folder_id': fid,
        'file_count': int(row.get('cnt') or 0),
        'total_bytes': int(row.get('total') or 0),
        'subfolder_count': int(folder_count),
    })


@files_bp.route('/api/files/recent', methods=['GET'])
@login_required
def recent_uploads():
    """Return the N most recently uploaded files across all folders."""
    try:
        limit = int(request.args.get('limit', '20'))
    except (TypeError, ValueError):
        limit = 20
    limit = max(1, min(limit, 100))

    elevated = _is_elevated()
    classified_filter = '' if elevated else ' WHERE f.is_classified = {FALSE}'
    # No token exists for a variable-N row limit (only the literal-1 TOP1/LIMIT1
    # pair), so branch manually — `limit` is clamped to 1..100 above, safe to
    # interpolate.
    top_clause = f'TOP {limit}' if not app_pkg.db.IS_POSTGRES else ''
    limit_clause = f'LIMIT {limit}' if app_pkg.db.IS_POSTGRES else ''
    rows = app_pkg.db.query(
        f"""SELECT {top_clause} f.id, f.original_name, f.size_bytes, f.mime_type,
                   f.uploaded_at, f.uploaded_by, f.folder_id, f.is_classified,
                   COALESCE(m.name, u.username) AS uploaded_by_name,
                   ff.name AS folder_name
            FROM files f
            LEFT JOIN users u ON f.uploaded_by = u.id
            LEFT JOIN members m ON u.member_id = m.id
            LEFT JOIN file_folders ff ON f.folder_id = ff.id{classified_filter}
            ORDER BY f.uploaded_at DESC
            {limit_clause}"""
    ) or []
    # Also exclude files that sit under a classified folder (row itself not flagged).
    if not elevated:
        rows = [r for r in rows if not _folder_hidden_for_staff(r.get('folder_id'))]
    for r in rows:
        if r.get('uploaded_at'):
            r['uploaded_at'] = r['uploaded_at'].isoformat()
        r['is_classified'] = bool(r.get('is_classified'))
    return jsonify(rows)
