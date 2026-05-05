from flask import Blueprint
from flask import jsonify
from flask import render_template
from flask import request

import app as app_pkg

from .auth import admin_required
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
        "UPDATE settings SET value=? WHERE [key]='worklog_open'",
        ('1' if app_pkg._worklog_open else '0',),
    )
    return jsonify({'ok': True, 'worklog_open': app_pkg._worklog_open})
