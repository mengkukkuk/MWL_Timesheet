import json as _json
import re as _re

from flask import Blueprint
from flask import jsonify
from flask import render_template
from flask import request

import app as app_pkg

from .auth import admin_required
from .auth import elevated_required
from .auth import login_required

core_bp = Blueprint('core', __name__)

@core_bp.route('/')
@login_required
def index():
    return render_template('index.html')


@core_bp.route('/api/settings', methods=['GET'])
@login_required
def get_settings():
    return jsonify({'worklog_open': app_pkg._worklog_open})


@core_bp.route('/api/settings/worklog-visibility', methods=['PUT'])
@admin_required
def set_worklog_visibility():
    data = request.json or {}
    app_pkg._worklog_open = bool(data.get('open', False))
    app_pkg.db.execute(
        "UPDATE settings SET value=? WHERE \"key\"='worklog_open'",
        ('1' if app_pkg._worklog_open else '0',),
    )
    return jsonify({'ok': True, 'worklog_open': app_pkg._worklog_open})


_DEFAULT_TIME_PRESETS = {
    'start': [
        {'label': '8:30',  'value': '08:30'},  
        {'label': '13:30', 'value': '13:30'},
    ],
    'end': [
        {'label': '10:30', 'value': '10:30'},
        {'label': '13:30', 'value': '13:30'},
        {'label': '17:30', 'value': '17:30'},
        {'label': '18:30', 'value': '18:30'},
    ],
}


@core_bp.route('/api/settings/time-presets', methods=['GET'])
@login_required
def get_time_presets():
    row = app_pkg.db.query("SELECT value FROM settings WHERE \"key\"='time_presets'", fetchone=True)
    if row:
        try:
            data = _json.loads(row['value'])
        except (ValueError, TypeError):
            data = _DEFAULT_TIME_PRESETS
    else:
        data = _DEFAULT_TIME_PRESETS
    return jsonify(data)


@core_bp.route('/api/settings/time-presets', methods=['PUT'])
@login_required
@elevated_required
def set_time_presets():
    data = request.json or {}
    start = data.get('start', [])
    end = data.get('end', [])
    _time_re = _re.compile(r'^\d{2}:\d{2}$')
    for item in start + end:
        if not isinstance(item, dict):
            return jsonify({'error': 'Invalid preset format'}), 400
        if not _time_re.match(item.get('value', '')):
            return jsonify({'error': f"Invalid time value: {item.get('value')}"}), 400
        if not isinstance(item.get('label', ''), str):
            return jsonify({'error': 'Label must be a string'}), 400
    payload = _json.dumps({'start': start, 'end': end})
    existing = app_pkg.db.query("SELECT 1 FROM settings WHERE \"key\"='time_presets'", fetchone=True)
    if existing:
        app_pkg.db.execute("UPDATE settings SET value=? WHERE \"key\"='time_presets'", (payload,))
    else:
        app_pkg.db.execute("INSERT INTO settings (\"key\", value) VALUES ('time_presets', ?)", (payload,))
    return jsonify({'ok': True})
