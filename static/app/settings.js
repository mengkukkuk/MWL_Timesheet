const ROLE_SUPER_ADMIN = 'Super_Ultimate_ADMIN';
const ROLE_ADMIN_STR   = 'Admin';
const ROLE_LEADER_STR  = 'Leader';

const ROLE_CSS = {
    [ROLE_SUPER_ADMIN]: 'text-indigo-600 font-semibold',
    [ROLE_ADMIN_STR]:   'text-orange-600 font-medium',
    [ROLE_LEADER_STR]:  'text-blue-500 font-medium',
};

// ── Team Members (Settings) — backed by dbo.Employee via /api/employees ──
// `id` in the rendered rows is the EmployeeID (business key).
let _employeesCache = [];

async function refreshMembersUI() {
    await loadMembersList();   // fetches + renders
}

async function loadEmployees() {
    const data = await cachedApi('/api/employees');
    _employeesCache = Array.isArray(data) ? data : [];
}

function clearMemberSelectionIfActive(memberId) {
    if (currentMemberId === memberId) {
        currentMemberId = null;
        document.getElementById('member-select').value = '';
        onContextChange();
    }
}

async function loadMembersList() {
    await loadEmployees();
    _renderMembersList();
}

function _renderMembersList() {
    const ul = document.getElementById('members-list');
    if (!ul) return;
    ul.innerHTML = '';
    _employeesCache.forEach(m => {
        m.jg = undefined;
        const li = document.createElement('li');
        li.className = 'rounded-lg bg-gray-50 overflow-hidden';
        li.id = `member-row-${m.id}`;
        const idBadge = `<span class="text-xs text-indigo-500 ml-2">EmpID: ${esc(m.staff_id || String(m.id))}</span>`;
        const levelBadge = m.level
            ? `<span class="text-xs text-purple-600 ml-2 font-medium">${esc(m.level)}</span>`
            : '';
        li.innerHTML = `
            <div class="flex items-center justify-between py-1.5 px-3">
                <div>
                    <span class="text-sm font-medium">${esc(m.name)}</span>
                    <span class="text-xs text-gray-500 ml-2">${esc(m.department || '')}</span>
                    ${idBadge}
                    ${m.position ? `<span class="text-xs text-gray-400 ml-2">${esc(m.position)}</span>` : ''}
                    ${levelBadge}
                </div>
                <div class="flex gap-1">
                    <button class="btn-icon" onclick="toggleEditMember(${m.id})" title="Edit">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                    </button>
                    <button class="btn-icon danger" onclick="deleteMember(${m.id})" title="Remove">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                </div>
            </div>
            <div id="edit-member-${m.id}" class="hidden px-3 pb-3 border-t border-gray-200 pt-2">
                <div class="grid grid-cols-2 gap-2 mb-2">
                    <input id="edit-m-name-${m.id}"     value="${esc(m.name)}"           placeholder="Name"               class="input-field text-sm">
                    <input id="edit-m-dept-${m.id}"     value="${esc(m.department||'')}" placeholder="Department"         class="input-field text-sm">
                    <input id="edit-m-position-${m.id}" value="${esc(m.position||'')}"   placeholder="Position (optional)" class="input-field text-sm">
                    <input id="edit-m-level-${m.id}"    value="${esc(m.level||'')}"      placeholder="Level (e.g. O3)"     class="input-field text-sm">
                    <input id="edit-m-jg-${m.id}"       value="${esc(m.jg||'')}"      placeholder="JG00"     class="input-field text-sm">
                </div>
                <p class="text-xs text-gray-400 mb-2">EmployeeID <strong>${esc(m.staff_id || String(m.id))}</strong> cannot be changed.</p>
                <div class="flex justify-end gap-2">
                    <button onclick="toggleEditMember(${m.id})" class="btn-secondary text-xs px-3">Cancel</button>
                    <button onclick="saveMemberEdit(${m.id})" class="btn-primary text-xs px-3">Save</button>
                </div>
            </div>
        `;
        ul.appendChild(li);
    });
}

function toggleEditMember(id) {
    document.getElementById(`edit-member-${id}`).classList.toggle('hidden');
}

async function saveMemberEdit(id) {
    const name     = document.getElementById(`edit-m-name-${id}`).value.trim();
    const dept     = document.getElementById(`edit-m-dept-${id}`).value.trim();
    const position = document.getElementById(`edit-m-position-${id}`).value.trim();
    const level    = document.getElementById(`edit-m-level-${id}`).value.trim();
    const jg    = document.getElementById(`edit-m-jg-${id}`).value.trim();

    if (!name) { toast('Name is required', 'error'); return; }
    // PUT /api/employees/<EmployeeID>
    const res = await api(`/api/employees/${id}`, {
        method: 'PUT',
        body: { name, department: dept, position, level ,jg}
    });
    if (!res) return;
    if (res.error) { toast(res.error, 'error'); return; }
    invalidateCache('/api/employees');
    invalidateCache('/api/members');
    await refreshMembersUI();
    toast(t('toast.member_updated'));
}

async function addMember() {
    const nameInput     = document.getElementById('new-member-name');
    const deptInput     = document.getElementById('new-member-dept');
    const staffIdInput  = document.getElementById('new-member-staffid');
    const positionInput = document.getElementById('new-member-position');
    const levelInput = document.getElementById('new-member-level');
    const jgInput = document.getElementById('new-member-jg');
    const name       = nameInput.value.trim();
    const department = deptInput.value.trim();
    const staff_id   = staffIdInput.value.trim();   // = EmployeeID
    const position   = positionInput.value.trim();
    const level   = levelInput.value.trim();
    const jg   = jgInput.value.trim();

    if (!name) { toast('Name is required', 'error'); return; }
    if (!staff_id) { toast('Employee ID is required', 'error'); return; }
    if (!/^\d+$/.test(staff_id)) { toast('Employee ID must be a number', 'error'); return; }
    const res = await api('/api/employees', { method: 'POST', body: { name, department, staff_id, position, level, jg } });
    if (!res) return;
    if (res.error) { toast(res.error, 'error'); return; }
    nameInput.value = '';
    deptInput.value = '';
    staffIdInput.value = '';
    positionInput.value = '';
    levelInput.value = '';
    jgInput.value = '';
    invalidateCache('/api/employees');
    invalidateCache('/api/members');
    await refreshMembersUI();
    toast(t('toast.member_added'));
}

async function deleteMember(id) {
    if (!confirm('Remove this employee from the directory?\n\nNote: any existing user accounts that referenced this Employee ID will keep working until the next migration phase.')) return;
    const result = await api(`/api/employees/${id}`, { method: 'DELETE' });
    if (!result) return;
    if (result.error) { toast(result.error, 'error'); return; }
    if (result.warning) toast(result.warning, 'error');
    invalidateCache('/api/employees');
    invalidateCache('/api/members');
    clearMemberSelectionIfActive(id);
    await refreshMembersUI();
    toast(t('toast.member_removed'));
}

// ── Users (Settings) ──
async function loadUsersList() {
    const ul = document.getElementById('users-list');
    if (!ul) return;
    const userList = await api('/api/users');
    if (!userList) return;
    ul.innerHTML = '';
    userList.forEach(u => {
        const li = document.createElement('li');
        li.className = 'flex items-center justify-between py-1.5 px-3 rounded-lg bg-gray-50';
        const roleClass = ROLE_CSS[u.role] || 'text-gray-500';
        const isSelf = u.id === currentUser.id;
        const isSuperAdmin = u.role === ROLE_SUPER_ADMIN;
        const canChangeRole = currentUser.role === ROLE_SUPER_ADMIN;
        const changeRoleBtn = (canChangeRole && !isSelf && !isSuperAdmin) ? `
            <button class="btn-icon" onclick="openChangeRoleModal(${u.id}, '${esc(u.username)}', '${u.role}')" title="Change Role">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                </svg>
            </button>` : '<span class="w-7"></span>';
        const deleteBtn = (isSelf || isSuperAdmin) ? '' : `
            <button class="btn-icon danger" onclick="deleteUser(${u.id})" title="Remove">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>`;
        const resetPwBtn = (currentUser.role === ROLE_SUPER_ADMIN) ? `
            <button class="btn-icon" onclick="openResetPasswordModal(${u.id}, '${esc(u.username)}')" title="Reset Password">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/></svg>
            </button>` : '<span class="w-7"></span>';
        const editEmailBtn = (!isSuperAdmin || isSelf) ? `
            <button class="btn-icon" onclick="openEditEmailModal(${u.id}, '${esc(u.username)}', '${esc(u.email || '')}')" title="Edit Email">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
            </button>` : '<span class="w-7"></span>';
        const statusBadge =
            u.status === 'Pending'  ? '<span class="text-xs ml-2 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Pending</span>' :
            u.status === 'Declined' ? '<span class="text-xs ml-2 px-1.5 py-0.5 rounded bg-red-100 text-red-700">Declined</span>' : '';
        li.innerHTML = `
            <div>
                <span class="text-sm font-medium">${esc(u.username)}</span>
                <span class="text-xs ${roleClass} ml-2">${u.role}</span>
                ${u.member_name ? `<span class="text-xs text-gray-400 ml-2">(${esc(u.member_name)})</span>` : ''}
                ${u.email ? `<span class="text-xs text-gray-400 ml-2">${esc(u.email)}</span>` : `<span class="text-xs text-gray-300 ml-2" data-i18n="settings.no_email">${t('settings.no_email')}</span>`}
                ${statusBadge}
            </div>
            <div class="flex items-center gap-1">${changeRoleBtn}${editEmailBtn}${resetPwBtn}${deleteBtn}</div>
        `;
        ul.appendChild(li);
    });
}

// ── Account approvals ──
async function loadPendingUsers() {
    const ul    = document.getElementById('pending-users-list');
    const empty = document.getElementById('pending-empty-msg');
    const inlineBadge = document.getElementById('pending-count-badge');
    if (!ul) return;
    const rows = await api('/api/users/pending');
    if (!rows) return;
    // Update inline header badge
    if (inlineBadge) {
        if (rows.length) {
            inlineBadge.textContent = String(rows.length);
            inlineBadge.classList.remove('hidden');
        } else {
            inlineBadge.classList.add('hidden');
        }
    }
    // Update top-nav badge too (single source of truth)
    refreshPendingBadge();
    if (!rows.length) {
        ul.innerHTML = '';
        if (empty) {
            ul.appendChild(empty);
            empty.classList.remove('hidden');
        }
        return;
    }
    ul.innerHTML = '';
    rows.forEach(u => {
        const li = document.createElement('li');
        li.className = 'rounded-lg bg-amber-50 border border-amber-200 px-3 py-2';
        const memberLine = u.member_name
            ? `<div class="text-xs text-gray-600 mt-0.5">${esc(u.member_name)} · ${esc(u.department || '')}${u.position ? ' · ' + esc(u.position) : ''}${u.staff_id ? ' · ID ' + esc(u.staff_id) : ''}</div>`
            : '';
        const created = u.created_at ? new Date(u.created_at).toLocaleString() : '';
        li.innerHTML = `
            <div class="flex items-center justify-between gap-3">
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                        <span class="text-sm font-semibold text-gray-800">${esc(u.username)}</span>
                        <span class="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Pending</span>
                        ${created ? `<span class="text-xs text-gray-400">${esc(created)}</span>` : ''}
                    </div>
                    ${memberLine}
                </div>
                <div class="flex gap-2 flex-shrink-0">
                    <button onclick="approvePendingUser(${u.id}, '${esc(u.username)}')"
                            class="text-xs px-3 py-1 rounded-md bg-green-600 text-white hover:bg-green-700 font-medium"
                            data-i18n="set.accept">Accept</button>
                    <button onclick="declinePendingUser(${u.id}, '${esc(u.username)}')"
                            class="text-xs px-3 py-1 rounded-md bg-red-100 text-red-700 hover:bg-red-200 font-medium"
                            data-i18n="set.decline">Decline</button>
                </div>
            </div>
        `;
        ul.appendChild(li);
    });
}

async function approvePendingUser(uid, username) {
    if (!confirm(`Approve "${username}"? They will be able to log in immediately.`)) return;
    const res = await api(`/api/users/${uid}/approve`, { method: 'POST' });
    if (!res) return;
    if (res.error) { toast(res.error, 'error'); return; }
    toast(`Approved ${username}`);
    await Promise.all([loadPendingUsers(), loadUsersList()]);
}

async function declinePendingUser(uid, username) {
    if (!confirm(`Decline "${username}"? Their account will be marked Declined and cannot log in. (Kept for audit.)`)) return;
    const res = await api(`/api/users/${uid}/decline`, { method: 'POST' });
    if (!res) return;
    if (res.error) { toast(res.error, 'error'); return; }
    toast(`Declined ${username}`);
    await Promise.all([loadPendingUsers(), loadUsersList()]);
}

// Top-nav red badge — polled separately so non-Settings tabs see it too.
async function refreshPendingBadge() {
    if (!isElevated()) return;
    const badge = document.getElementById('nav-pending-badge');
    if (!badge) return;
    const res = await api('/api/users/pending/count');
    if (!res || typeof res.count !== 'number') return;
    if (res.count > 0) {
        badge.textContent = String(res.count);
        badge.classList.remove('hidden');
        badge.style.display = 'flex';
    } else {
        badge.classList.add('hidden');
        badge.style.display = 'none';
    }
}

try {
    window.showSettingsPanel    = showSettingsPanel;
    window.loadPendingUsers     = loadPendingUsers;
    window.approvePendingUser   = approvePendingUser;
    window.declinePendingUser   = declinePendingUser;
    window.refreshPendingBadge  = refreshPendingBadge;
} catch (e) {}

function _updateRoleRadioStyles() {
    document.querySelectorAll('input[name="change-role-radio"]').forEach(r => {
        const label = r.closest('.role-radio-label');
        if (!label) return;
        if (r.checked) {
            label.classList.add('border-indigo-400', 'bg-indigo-50');
            label.classList.remove('border-gray-200');
        } else {
            label.classList.remove('border-indigo-400', 'bg-indigo-50');
            label.classList.add('border-gray-200');
        }
    });
}

function openChangeRoleModal(uid, username, currentRole) {
    document.getElementById('change-role-uid').value = uid;
    document.getElementById('change-role-label').textContent = `User: ${username}`;
    document.querySelectorAll('input[name="change-role-radio"]').forEach(r => {
        r.checked = r.value === currentRole;
        r.onchange = _updateRoleRadioStyles;
    });
    _updateRoleRadioStyles();
    document.getElementById('change-role-overlay').classList.remove('hidden');
}

function closeChangeRoleModal() {
    document.getElementById('change-role-overlay').classList.add('hidden');
}

async function saveChangeRole() {
    const uid = document.getElementById('change-role-uid').value;
    const selected = document.querySelector('input[name="change-role-radio"]:checked');
    if (!selected) { toast('Select a role', 'error'); return; }
    const res = await api(`/api/users/${uid}/role`, { method: 'PUT', body: { role: selected.value } });
    if (res && res.ok) {
        closeChangeRoleModal();
        toast(t('toast.role_updated'));
        loadUsersList();
    }
}

async function deleteUser(id) {
    if (!confirm('Delete this user account and their member profile (including all work logs)?')) return;
    const res = await api(`/api/users/${id}`, { method: 'DELETE' });
    if (!res) return;
    if (res.error) { toast(res.error, 'error'); return; }
    if (res.member_id) clearMemberSelectionIfActive(res.member_id);
    await Promise.all([loadMembers(), loadUsersList()]);
    loadMembersList();
    toast(t('toast.user_removed'));
}

function openResetPasswordModal(uid, username) {
    document.getElementById('reset-pw-uid').value = uid;
    document.getElementById('reset-pw-label').textContent = `Reset password for: ${username}`;
    document.getElementById('reset-pw-new').value = '';
    document.getElementById('reset-pw-confirm').value = '';
    document.getElementById('reset-pw-overlay').classList.remove('hidden');
}

function closeResetPasswordModal() {
    document.getElementById('reset-pw-overlay').classList.add('hidden');
}

async function saveResetPassword() {
    const uid = document.getElementById('reset-pw-uid').value;
    const pw = document.getElementById('reset-pw-new').value;
    const pw2 = document.getElementById('reset-pw-confirm').value;
    if (pw.length < 8) { toast('Password must be at least 8 characters', 'error'); return; }
    if (pw !== pw2) { toast('Passwords do not match', 'error'); return; }
    const res = await api(`/api/users/${uid}/password`, { method: 'PUT', body: { password: pw } });
    if (res && res.ok) {
        closeResetPasswordModal();
        toast(t('toast.pw_updated'));
    }
}

function openEditEmailModal(uid, username, email) {
    document.getElementById('edit-email-uid').value = uid;
    document.getElementById('edit-email-label').textContent = `Email for: ${username}`;
    document.getElementById('edit-email-input').value = email || '';
    document.getElementById('edit-email-overlay').classList.remove('hidden');
}

function closeEditEmailModal() {
    document.getElementById('edit-email-overlay').classList.add('hidden');
}

async function saveUserEmail() {
    const uid = document.getElementById('edit-email-uid').value;
    const email = document.getElementById('edit-email-input').value.trim();
    const res = await api(`/api/users/${uid}/email`, { method: 'PUT', body: { email } });
    if (res && res.ok) {
        closeEditEmailModal();
        toast(t('toast.email_updated'));
        loadUsersList();
    }
}

// ── Settings sub-menu navigation ──
function showSettingsPanel(name) {
    document.querySelectorAll('.settings-panel').forEach(p => p.classList.add('hidden'));
    document.querySelectorAll('.settings-nav-item').forEach(b => b.classList.remove('active'));
    const panel = document.getElementById('settings-panel-' + name);
    if (panel) panel.classList.remove('hidden');
    const btn = document.querySelector(`.settings-nav-item[data-panel="${name}"]`);
    if (btn) btn.classList.add('active');
    localStorage.setItem('settings_panel', name);
    if (name === 'time-presets') loadTimePresetsPanel();
}

// ── Worklog Visibility Settings (Super Admin only) ──
async function loadSettings() {
    const data = await api('/api/settings');
    if (!data) return;
    renderVisibilityToggle(data.worklog_open);
    document.getElementById('settings-nav-visibility').classList.remove('hidden');
}

function renderVisibilityToggle(isOpen) {
    const btn   = document.getElementById('visibility-toggle-btn');
    const knob  = document.getElementById('visibility-toggle-knob');
    const label = document.getElementById('visibility-label');
    const desc  = document.getElementById('visibility-desc');
    btn.dataset.open = isOpen ? '1' : '0';
    if (isOpen) {
        btn.style.backgroundColor = '#16a34a';
        knob.style.transform = 'translateX(1.75rem)';
        label.textContent = t('set.vis_on');
        desc.textContent  = t('set.vis_on_desc');
    } else {
        btn.style.backgroundColor = '#9ca3af';
        knob.style.transform = 'translateX(0.25rem)';
        label.textContent = t('set.vis_off');
        desc.textContent  = t('set.vis_off_desc');
    }
}

async function toggleWorklogVisibility() {
    const btn = document.getElementById('visibility-toggle-btn');
    const currentlyOn = btn.dataset.open === '1';
    const res = await api('/api/settings/worklog-visibility', {
        method: 'PUT', body: { open: !currentlyOn }
    });
    if (res && res.ok) renderVisibilityToggle(res.worklog_open);
}

// ── Time Presets Settings ──
let _presetsData = { start: [], end: [] };

async function loadTimePresetsPanel() {
    const data = await api('/api/settings/time-presets');
    if (!data) return;
    _presetsData = data;
    _renderPresetChips('start');
    _renderPresetChips('end');
}

function _renderPresetChips(kind) {
    const container = document.getElementById('preset-chips-' + kind);
    if (!container) return;
    container.innerHTML = '';
    (_presetsData[kind] || []).forEach((p, i) => {
        const chip = document.createElement('div');
        chip.className = 'flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-medium border border-indigo-100';
        chip.innerHTML = `<span>${esc(p.label)}</span><button type="button" onclick="removeTimePreset('${kind}',${i})" class="ml-1 text-indigo-300 hover:text-red-500 font-bold leading-none">&times;</button>`;
        container.appendChild(chip);
    });
}

async function addTimePreset(kind) {
    const valueEl = document.getElementById('new-preset-' + kind + '-value');
    const labelEl = document.getElementById('new-preset-' + kind + '-label');
    const raw = (valueEl ? valueEl.value : '').trim();
    if (!raw) { toast('Select a time', 'error'); return; }
    // <input type="time"> returns HH:MM in 24h format
    const value = raw.substring(0, 5);
    const label = labelEl && labelEl.value.trim() ? labelEl.value.trim() : value;
    _presetsData = { ..._presetsData, [kind]: [...(_presetsData[kind] || []), { label, value }] };
    const res = await api('/api/settings/time-presets', { method: 'PUT', body: _presetsData });
    if (!res || !res.ok) { toast('Failed to save preset', 'error'); return; }
    _renderPresetChips(kind);
    if (typeof window._invalidateTimePresetsCache === 'function') window._invalidateTimePresetsCache();
    if (valueEl) valueEl.value = '';
    if (labelEl) labelEl.value = '';
}

async function removeTimePreset(kind, index) {
    _presetsData = { ..._presetsData, [kind]: (_presetsData[kind] || []).filter((_, i) => i !== index) };
    const res = await api('/api/settings/time-presets', { method: 'PUT', body: _presetsData });
    if (!res || !res.ok) { toast('Failed to save preset', 'error'); return; }
    _renderPresetChips(kind);
    if (typeof window._invalidateTimePresetsCache === 'function') window._invalidateTimePresetsCache();
}

try {
    window.addTimePreset    = addTimePreset;
    window.removeTimePreset = removeTimePreset;
} catch (e) {}
