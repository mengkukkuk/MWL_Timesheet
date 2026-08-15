"""Profile avatars on dbo.Employee.

PDPA contract:
  • READ  — any logged-in user may view any avatar (it's the same image they'd
            see on a name-badge in the office).
  • WRITE — only the employee themselves OR the Super_Ultimate_ADMIN may
            upload / replace / delete. Leader/Admin do NOT have write access.

Storage layout:
  storage/avatars/<uuid>.<ext>   — relative path persisted in
                                   dbo.Employee.AvatarPath. UUID-only filename
                                   prevents traversal and collisions, same
                                   defense as the file-share blob layout.

Validation:
  • size ≤ 2 MB
  • MIME ∈ {image/jpeg, image/png, image/webp}
  • magic-byte sniff on the first 12 bytes (refuses spoofed extensions /
    HTML masquerading as image)
"""
import os
import traceback
import uuid

from flask import Blueprint
from flask import current_app
from flask import jsonify
from flask import request
from flask import send_file
from flask import session

import app as app_pkg

from .auth import login_required
from .constants import ROLE_SUPER_ADMIN

avatars_bp = Blueprint('avatars', __name__)

MAX_AVATAR_BYTES = 2 * 1024 * 1024  # 2 MB

# (sniffed mime, file extension) keyed by magic-byte signature
_MAGIC = [
    (b'\xff\xd8\xff',         'image/jpeg', '.jpg'),
    (b'\x89PNG\r\n\x1a\n',    'image/png',  '.png'),
]
# WebP: "RIFF" .... "WEBP"  (4-byte size between)
def _sniff(buf):
    for sig, mime, ext in _MAGIC:
        if buf.startswith(sig):
            return mime, ext
    if len(buf) >= 12 and buf[0:4] == b'RIFF' and buf[8:12] == b'WEBP':
        return 'image/webp', '.webp'
    return None, None


def _can_write(employee_id):
    """Self-edit OR Super_Ultimate_ADMIN. Per PDPA: Leader/Admin cannot edit
    others' photos.

    Comparison is normalised: session['member_id'] is the NVARCHAR EmployeeID
    (string) and may carry legacy trailing whitespace on older logins; the URL
    arg arrives stripped. Coerce both sides to stripped strings so the self-
    edit branch fires reliably regardless of how the value was minted.
    """
    if session.get('role') == ROLE_SUPER_ADMIN:
        return True
    sess = session.get('member_id')
    if sess is None or employee_id is None:
        return False
    return str(sess).strip() == str(employee_id).strip()


def _avatar_dir():
    base = current_app.config.get('AVATAR_STORAGE_DIR')
    if not base:
        raise RuntimeError("AVATAR_STORAGE_DIR is not configured")
    try:
        os.makedirs(base, exist_ok=True)
    except OSError as exc:
        raise OSError(f"Cannot create avatar storage dir {base!r}: {exc}") from exc
    return base


def _resolve_blob_path(stored_name):
    """Build absolute path from DB AvatarPath; reject anything that escapes."""
    base = os.path.realpath(_avatar_dir())
    candidate = os.path.realpath(os.path.join(base, stored_name.replace('/', os.sep)))
    
    # On Windows, path comparisons should be case-insensitive to avoid false-positives
    # for path traversal when drive letters or folder names differ in casing.
    is_windows = os.name == 'nt'
    check_base = base.lower() if is_windows else base
    check_candidate = candidate.lower() if is_windows else candidate
    
    if not (check_candidate == check_base or check_candidate.startswith(check_base + os.sep)):
        raise ValueError(f'resolved path escapes avatar storage root: {candidate} vs {base}')
    return candidate


def _delete_blob_silent(stored_name):
    if not stored_name:
        return
    try:
        path = _resolve_blob_path(stored_name)
        if os.path.exists(path):
            os.remove(path)
    except (ValueError, OSError) as exc:
        current_app.logger.warning("avatar: blob removal failed for %r: %s", stored_name, exc)


@avatars_bp.route('/api/avatars/<eid>', methods=['GET'])
@login_required
def get_avatar(eid):
    eid = eid.strip()
    row = app_pkg.db.query(
        'SELECT AvatarPath AS "AvatarPath", AvatarMime AS "AvatarMime" FROM Employee WHERE EmployeeID=?',
        (eid,), fetchone=True,
    )
    if not row or not row.get('AvatarPath'):
        return jsonify({'error': 'no avatar'}), 404
    try:
        path = _resolve_blob_path(row['AvatarPath'])
    except ValueError:
        return jsonify({'error': 'invalid stored path'}), 500
    if not os.path.exists(path):
        return jsonify({'error': 'avatar missing on disk'}), 410
    return send_file(
        path,
        mimetype=row.get('AvatarMime') or 'application/octet-stream',
        as_attachment=False,
        conditional=True,
        max_age=300,  # 5 min — cache-bust via ?v=<updated_at> from frontend
    )


@avatars_bp.route('/api/avatars/<eid>', methods=['POST'])
@login_required
def upload_avatar(eid):
    eid = eid.strip()
    if not _can_write(eid):
        return jsonify({'error': 'permission denied'}), 403

    try:
        emp = app_pkg.db.query(
            'SELECT EmployeeID, AvatarPath AS "AvatarPath" FROM Employee WHERE EmployeeID=?',
            (eid,), fetchone=True,
        )
        if not emp:
            current_app.logger.warning(f"Avatar upload failed: employee {eid} not found")
            return jsonify({'error': 'employee not found'}), 404
        current_app.logger.debug(f"Found employee record: {eid}")
    except Exception as exc:
        current_app.logger.error(f"Database error querying employee {eid}: {exc}", exc_info=True)
        return jsonify({'error': f'database error: {exc}'}), 500

    if 'file' not in request.files:
        return jsonify({'error': 'no file in request'}), 400
    f = request.files['file']
    if not f or not f.filename:
        return jsonify({'error': 'empty file'}), 400

    blob = f.stream.read(MAX_AVATAR_BYTES + 1)
    if len(blob) > MAX_AVATAR_BYTES:
        return jsonify({'error': f'Image must be {MAX_AVATAR_BYTES // (1024*1024)} MB or smaller'}), 413
    if not blob:
        return jsonify({'error': 'empty file'}), 400

    sniffed_mime, ext = _sniff(blob[:16])
    if not sniffed_mime:
        return jsonify({'error': 'Unsupported image format. Use JPEG, PNG, or WebP.'}), 400

    # Persist new blob first, swap DB pointer, then unlink old blob.
    stored_name = f"{uuid.uuid4().hex}{ext}"
    abs_path = os.path.join(_avatar_dir(), stored_name)
    try:
        with open(abs_path, 'wb') as out:
            out.write(blob)
    except OSError as exc:
        return jsonify({'error': f'storage write failed: {exc}'}), 500

    old_path = emp.get('AvatarPath')
    app_pkg.db.execute(
        """UPDATE Employee
              SET AvatarPath=?, AvatarMime=?, AvatarUpdatedAt=CURRENT_TIMESTAMP
            WHERE EmployeeID=?""",
        (stored_name, sniffed_mime, eid),
    )
    _delete_blob_silent(old_path)

    return jsonify({
        'id': eid,
        'avatar_url': f'/api/avatars/{eid}',
        'mime': sniffed_mime,
        'size_bytes': len(blob),
    }), 201


@avatars_bp.route('/api/avatars/<eid>', methods=['DELETE'])
@login_required
def delete_avatar(eid):
    eid = eid.strip()
    if not _can_write(eid):
        return jsonify({'error': 'permission denied'}), 403

    row = app_pkg.db.query(
        'SELECT AvatarPath AS "AvatarPath" FROM Employee WHERE EmployeeID=?',
        (eid,), fetchone=True,
    )
    if not row:
        return jsonify({'error': 'employee not found'}), 404

    app_pkg.db.execute(
        """UPDATE Employee
              SET AvatarPath=NULL, AvatarMime=NULL, AvatarUpdatedAt=CURRENT_TIMESTAMP
            WHERE EmployeeID=?""",
        (eid,),
    )
    _delete_blob_silent(row.get('AvatarPath'))
    return jsonify({'ok': True})
