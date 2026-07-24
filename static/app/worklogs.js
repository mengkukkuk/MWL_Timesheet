async function loadWorklogs() {
    if (!currentMemberId) return;
    const year  = document.getElementById('year-select').value;
    const month = document.getElementById('month-select').value;

    const [data, holiday]  = await Promise.all([
            api(`/api/worklogs?member_id=${currentMemberId}&year=${year}&month=${month}`),
            api(`/api/holidays?member_id=${currentMemberId}&year=${year}&month=${month}`)
    ]);
    if (!data) return;

    worklogData = data;
    holidayData = Array.isArray(holiday) ? holiday : [];

    document.getElementById('btn-add-worklog').classList.toggle('hidden', !canEditMember(currentMemberId));

    // The Work Log table/calendar are now a React island (#worklog-view-root,
    // WorklogIsland.tsx) — stash the payload and notify it to (re)render.
    window.__mwlWorklogs = {
        worklogs: worklogData,
        holidays: holidayData,
        year: parseInt(year, 10),
        month: parseInt(month, 10),
    };
    window.dispatchEvent(new CustomEvent('mwl:worklogs'));
}

// ── Bulk select (selection state now lives in the React island; this module
// var is the target-ids buffer the island passes in when it opens the bulk
// modal / triggers a bulk delete) ──
let _bulkTargetIds = [];

async function bulkDeleteWorklogs(ids) {
    if (Array.isArray(ids)) _bulkTargetIds = ids;
    const targets = _bulkTargetIds;
    if (!targets.length) return;
    if (!confirm(`Delete ${targets.length} selected entr${targets.length === 1 ? 'y' : 'ies'}?`)) return;
    let ok = 0, fail = 0;
    for (const id of targets) {
        const res = await api(`/api/worklogs/${id}`, { method: 'DELETE' });
        if (res && !res.error) ok++; else fail++;
    }
    if (ok) toast(`Deleted ${ok} entr${ok === 1 ? 'y' : 'ies'}`);
    if (fail) toast(`${fail} delete${fail === 1 ? '' : 's'} failed`, 'error');
    _bulkTargetIds = [];
    await loadWorklogs();
}

function openBulkEditModal(ids) {
    if (Array.isArray(ids)) _bulkTargetIds = ids;
    if (!_bulkTargetIds.length) return;
    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const setVal  = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    const setChk  = (id, v) => { const el = document.getElementById(id); if (el) el.checked = v; };
    setText('wl-bulk-edit-count', String(_bulkTargetIds.length));
    setChk('bulk-apply-project', false);
    setChk('bulk-apply-status',  false);
    setChk('bulk-apply-note',    false);
    setVal('bulk-note',   '');
    setVal('bulk-status', 'Done');
    const sel = document.getElementById('bulk-project');

    if (sel) {
        sel.innerHTML = '<option value="">Select...</option>';
        pdes.forEach(p => {
            if(p.Status !== 'Closed' && p.Status !== 'Hold') {
                const opt = document.createElement('option');
                opt.value = p.Description;
                opt.textContent = p.Description;
                sel.appendChild(opt);
            }
        });
    }
    const modal = document.getElementById('wl-bulk-edit-modal');
    if (modal) modal.classList.remove('hidden');
}

function closeBulkEditModal() {
    document.getElementById('wl-bulk-edit-modal').classList.add('hidden');
}

async function confirmBulkEdit(ev) {
    ev.preventDefault();
    const applyProj   = document.getElementById('bulk-apply-project').checked;
    const applyStatus = document.getElementById('bulk-apply-status').checked;
    const applyNote   = document.getElementById('bulk-apply-note').checked;
    if (!applyProj && !applyStatus && !applyNote) {
        toast('Select at least one field to apply', 'error');
        return;
    }
    const newProj   = document.getElementById('bulk-project').value;
    const newStatus = document.getElementById('bulk-status').value;
    const newNote   = document.getElementById('bulk-note').value;
    const ids = _bulkTargetIds;
    let ok = 0, fail = 0;
    // PUT requires the full payload — fetch each existing entry from worklogData,
    // override only the bulk-changed fields, and send back.
    for (const id of ids) {
        const w = worklogData.find(x => x.id === id);
        if (!w) { fail++; continue; }
        const memberId = isElevated() ? currentMemberId : currentUser.member_id;
        const payload = {
            log_date:   w.log_date,
            project:    applyProj   ? newProj   : (w.projects || ''),
            project_des:    applyProj   ? newProj   : (w.description || ''),
            task:       w.task || '',
            start_time: w.start_time || null,
            end_time:   w.end_time   || null,
            status:     applyStatus ? newStatus : (w.status || 'Pending'),
            note:       applyNote   ? newNote   : (w.note || ''),
            member_id:  memberId,
        };
        const res = await api(`/api/worklogs/${id}`, { method: 'PUT', body: payload });
        if (res && !res.error) ok++; else fail++;
    }
    if (ok) toast(`Updated ${ok} entr${ok === 1 ? 'y' : 'ies'}`);
    if (fail) toast(`${fail} update${fail === 1 ? '' : 's'} failed`, 'error');
    closeBulkEditModal();
    await loadWorklogs();
}

try {
    window.bulkDeleteWorklogs = bulkDeleteWorklogs;
    window.openBulkEditModal = openBulkEditModal;
    window.closeBulkEditModal = closeBulkEditModal;
    window.confirmBulkEdit = confirmBulkEdit;
} catch (e) {}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

// ── Time input helpers (native <input type="time">, 24-hour) ──

// ── Time preset rendering (dynamic, loaded from API) ──
let _timePresetsCache = null;

async function _loadAndRenderPresets() {
    try {
        if (!_timePresetsCache) {
            _timePresetsCache = await api('/api/settings/time-presets');
        }
        _renderPresetButtons('start', _timePresetsCache && _timePresetsCache.start);
        _renderPresetButtons('end',   _timePresetsCache && _timePresetsCache.end);
    } catch (e) {
        // silently skip — buttons just won't appear
    }
}

function _renderPresetButtons(kind, presets) {
    const container = document.getElementById(`wl-${kind}-presets`);
    if (!container) return;
    container.innerHTML = '';
    (presets || []).forEach(p => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'time-preset-btn';
        btn.textContent = p.label;
        btn.addEventListener('click', () => setTimePreset(`wl-${kind}`, p.value));
        container.appendChild(btn);
    });
}

// Called by settings.js when admin saves changes so next modal open re-fetches
window._invalidateTimePresetsCache = () => { _timePresetsCache = null; };

// Auto-advance HH→MM on 2 digits; clamp values on blur
function _initTimeInputBehavior() {
    ['start', 'end'].forEach(kind => {
        const hhEl = document.getElementById(`wl-${kind}-hh`);
        const mmEl = document.getElementById(`wl-${kind}-mm`);
        if (!hhEl || !mmEl) return;

        hhEl.addEventListener('input', () => {
            // strip non-digits
            hhEl.value = hhEl.value.replace(/\D/g, '');
            const v = parseInt(hhEl.value, 10);
            if (hhEl.value.length === 2 || v > 2) mmEl.focus();
        });
        mmEl.addEventListener('input', () => {
            mmEl.value = mmEl.value.replace(/\D/g, '');
        });
        hhEl.addEventListener('blur', () => {
            if (hhEl.value === '') return;
            hhEl.value = String(Math.min(23, Math.max(0, parseInt(hhEl.value, 10) || 0))).padStart(2, '0');
        });
        mmEl.addEventListener('blur', () => {
            if (mmEl.value === '') return;
            mmEl.value = String(Math.min(59, Math.max(0, parseInt(mmEl.value, 10) || 0))).padStart(2, '0');
        });
        // select all on focus for quick overwrite
        [hhEl, mmEl].forEach(el => el.addEventListener('focus', () => el.select()));
    });
}
_initTimeInputBehavior();

// Ensure functions are reachable from inline onclick handlers
try {
    window.openAddWorklog = openAddWorklog;
    window.openAddWorklogMulti = openAddWorklogMulti;
    window.editWorklog = editWorklog;
    window.deleteWorklog = deleteWorklog;
    window.setTimePreset = setTimePreset;
} catch (e) {
    // ignore in restricted environments
}

function setTimeInputs(prefix, timeStr) {
    const hhEl = document.getElementById(prefix + '-hh');
    const mmEl = document.getElementById(prefix + '-mm');
    if (!hhEl || !mmEl) return;
    if (!timeStr) {
        if (prefix === 'wl-start') { hhEl.value = '08'; mmEl.value = '30'; }
        else { hhEl.value = ''; mmEl.value = ''; }
        return;
    }
    const parts = timeStr.split(':');
    hhEl.value = parts[0] !== undefined ? String(parseInt(parts[0], 10) || 0).padStart(2, '0') : '';
    mmEl.value = parts[1] !== undefined ? String(parseInt(parts[1], 10) || 0).padStart(2, '0') : '';
}

function setTimePreset(prefix, timeStr24) {
    setTimeInputs(prefix, timeStr24);
}

function getTimeInputValue(prefix) {
    const hhEl = document.getElementById(prefix + '-hh');
    const mmEl = document.getElementById(prefix + '-mm');
    if (!hhEl || !mmEl || hhEl.value === '') return null;
    const hh = String(Math.min(23, Math.max(0, parseInt(hhEl.value, 10) || 0))).padStart(2, '0');
    const mm = String(Math.min(59, Math.max(0, parseInt(mmEl.value, 10) || 0))).padStart(2, '0');
    return `${hh}:${mm}`;
}

function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}


// ── Date range helpers ──
function dateRange(from, to) {
    const dates = [];
    const cur = new Date(from + 'T00:00:00');
    const end = new Date((to && to >= from ? to : from) + 'T00:00:00');
    while (cur <= end) {
        const y = cur.getFullYear();
        const m = String(cur.getMonth() + 1).padStart(2, '0');
        const d = String(cur.getDate()).padStart(2, '0');
        dates.push(`${y}-${m}-${d}`);
        cur.setDate(cur.getDate() + 1);
    }
    return dates;
}

function setDateRangeMode(show) {
    document.getElementById('wl-date-to-div').classList.toggle('hidden', !show);
    document.getElementById('wl-date-from-label').textContent = show ? t('modal.from') : t('modal.date');
    if (!show) document.getElementById('wl-date-to').value = '';
}

// ── Existing-ranges display (below Task input) ──
function renderExistingRanges() {
    const box  = document.getElementById('wl-existing-ranges');
    const list = document.getElementById('wl-existing-ranges-list');
    if (!box || !list) return;
    list.innerHTML = '';
    box.classList.add('hidden');

    if (!currentMemberId || !Array.isArray(worklogData)) return;

    const fromStr = document.getElementById('wl-date-from').value;
    const toStr   = document.getElementById('wl-date-to').value;
    if (!fromStr) return;

    const dates = toStr ? dateRange(fromStr, toStr) : [fromStr];
    const editingId = Number(document.getElementById('wl-id').value) || null;

    let total = 0;
    dates.forEach(d => {
        const entries = worklogData.filter(w =>
            w.log_date === d &&
            Number(w.member_id) === Number(currentMemberId) &&
            (!editingId || Number(w.id) !== editingId) &&
            w.start_time && w.end_time
        ).sort((a, b) => a.start_time.localeCompare(b.start_time));

        if (!entries.length) return;
        total += entries.length;

        if (dates.length > 1) {
            const dateLi = document.createElement('li');
            dateLi.className = 'existing-ranges-date';
            dateLi.textContent = d;
            list.appendChild(dateLi);
        }

        entries.forEach(w => {
            const li = document.createElement('li');
            const taskTxt = w.task ? ` — ${w.task}` : '';
            li.textContent = `${w.start_time} – ${w.end_time}${taskTxt}`;
            list.appendChild(li);
        });
    });

    if (total > 0) box.classList.remove('hidden');
}

// ── Modal ──
function openAddWorklog() {
    if (!currentMemberId) { toast(t('toast.select_member'), 'error'); return; }
    if (!canEditMember(currentMemberId)) { toast(t('toast.own_entries_only'), 'error'); return; }
    document.getElementById('modal-title').textContent = t('modal.add_entry');
    document.getElementById('wl-id').value = '';
    document.getElementById('wl-date-from').value = new Date().toISOString().split('T')[0];
    document.getElementById('wl-project').value = '';
    document.getElementById('wl-task').value = '';
    setTimeInputs('wl-start', '08:30');
    setTimeInputs('wl-end', '');
    document.getElementById('wl-status').value = 'In Progress';
    const cb1 = document.getElementById('wl-is-allowance');
    if (cb1) cb1.checked = false;
    document.getElementById('wl-note').value = '';
    setDateRangeMode(true);
    populateProjectDropdown();
    renderExistingRanges();
    _loadAndRenderPresets();
    document.getElementById('modal-overlay').classList.remove('hidden');
}

function openAddWorklogMulti() {
    _multiAddMode = true;
    document.getElementById('modal-title').textContent = t('modal.add_multi_entry');
    document.getElementById('wl-id').value = '';
    document.getElementById('wl-date-from').value = new Date().toISOString().split('T')[0];
    document.getElementById('wl-project').value = '';
    document.getElementById('wl-task').value = '';
    setTimeInputs('wl-start', '08:30');
    setTimeInputs('wl-end', '');
    document.getElementById('wl-status').value = 'In Progress';
    const cb2 = document.getElementById('wl-is-allowance');
    if (cb2) cb2.checked = false;
    document.getElementById('wl-note').value = '';
    setDateRangeMode(true);
    populateProjectDropdown();
    populateMultiMemberList();
    document.getElementById('multi-member-section').classList.remove('hidden');
    document.getElementById('modal-save-btn').textContent = t('modal.save_selected');
    renderExistingRanges();
    _loadAndRenderPresets();
    document.getElementById('modal-overlay').classList.remove('hidden');
}

function populateMultiMemberList() {
    const container = document.getElementById('multi-member-list');
    container.innerHTML = '';
    members.forEach(m => {
        const label = document.createElement('label');
        label.className = 'flex items-center gap-2 py-1 px-1 rounded cursor-pointer hover:bg-white';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = m.id;
        cb.id = `multi-member-${m.id}`;
        cb.className = 'rounded';
        cb.checked = Number(currentMemberId) === m.id;
        const span = document.createElement('span');
        span.className = 'text-sm text-gray-700';
        span.textContent = `${m.name} — ${m.department}`;
        label.appendChild(cb);
        label.appendChild(span);
        container.appendChild(label);
    });
}

function toggleAllMultiMembers(checked) {
    document.querySelectorAll('#multi-member-list input[type="checkbox"]')
        .forEach(cb => cb.checked = checked);
}

function editWorklog(w) {
    if (!canEditMember(currentMemberId)) { toast(t('toast.own_edit_only'), 'error'); return; }
    document.getElementById('modal-title').textContent = t('modal.edit_entry');
    document.getElementById('wl-id').value = w.id;
    document.getElementById('wl-date-from').value = w.log_date;
    setDateRangeMode(false);
    populateProjectDropdown();
    document.getElementById('wl-project').value = w.project || '';
    document.getElementById('wl-task').value = w.task || '';
    setTimeInputs('wl-start', w.start_time || '');
    setTimeInputs('wl-end',   w.end_time   || '');
    document.getElementById('wl-status').value = w.status || 'Pending';
    const cbEdit = document.getElementById('wl-is-allowance');
    if (cbEdit) cbEdit.checked = Number(w.is_allowance) === 1;
    document.getElementById('wl-note').value = w.note || '';
    renderExistingRanges();
    _loadAndRenderPresets();
    document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
    _multiAddMode = false;
    setDateRangeMode(false);
    document.getElementById('multi-member-section').classList.add('hidden');
    document.getElementById('modal-save-btn').textContent = t('modal.save');
    const rangesBox = document.getElementById('wl-existing-ranges');
    const rangesList = document.getElementById('wl-existing-ranges-list');
    if (rangesBox) rangesBox.classList.add('hidden');
    if (rangesList) rangesList.innerHTML = '';
    document.getElementById('modal-overlay').classList.add('hidden');
}

//Edit Project dropdown (p.[Field_name])
function populateProjectDropdown() {
    const sel = document.getElementById('wl-project');
    const val = sel.value;
    sel.innerHTML = '<option value="">Select...</option>';
    pdes.forEach(p => {
        if(p.Status !== 'Closed' && p.Status !== 'Hold') {
            const opt = document.createElement('option');
            opt.value = p.Description;
            opt.textContent = p.Description;
            sel.appendChild(opt);
        }
    });
    sel.value = val;
}

async function saveWorklog(e) {
    e.preventDefault();
    const id       = document.getElementById('wl-id').value;
    const dateFrom = document.getElementById('wl-date-from').value;
    const dateTo   = document.getElementById('wl-date-to').value;
    const dates    = id ? [dateFrom] : dateRange(dateFrom, dateTo);   // edit = always single day

    const basePayload = {
        log_date: dateFrom,   // overridden per-day in loops below
        project:    document.getElementById('wl-project').value,
        task:       document.getElementById('wl-task').value,
        start_time: getTimeInputValue('wl-start') || null,
        end_time:   getTimeInputValue('wl-end')   || null,
        status:     document.getElementById('wl-status').value,
        note:       document.getElementById('wl-note').value,
        is_allowance: !!document.getElementById('wl-is-allowance')?.checked,
    };

    if (id) {
        // Edit existing entry
        const memberId = isElevated() ? currentMemberId : currentUser.member_id;
        const res = await api(`/api/worklogs/${id}`, { method: 'PUT', body: { ...basePayload, member_id: memberId } });
        if (!res) return;
        if (res.error) { toast(res.error, 'error');
                         toast(t('toast.overlap'), 'error_overlap');
                         return; }
        toast(t('toast.entry_updated'));
    } else if (_multiAddMode) {
        // Multi-member × date range
        const checkedIds = [...document.querySelectorAll('#multi-member-list input[type="checkbox"]:checked')]
            .map(cb => Number(cb.value));
        if (checkedIds.length === 0) { toast(t('toast.select_one_member'), 'error'); return; }
        let ok = 0;
        for (const mid of checkedIds) {
            for (const d of dates) {
                const res = await api('/api/worklogs', { method: 'POST', body: { ...basePayload, log_date: d, member_id: mid } });
                if (res && res.id) ok++;
            }
        }
        const dayLabel = dates.length > 1 ? ` × ${dates.length} days` : '';
        toast(t('toast.added_multi', ok, checkedIds.length, dayLabel));
    } else {
        // Single member × date range
        const memberId = isElevated() ? currentMemberId : currentUser.member_id;
        let ok = 0;
        for (const d of dates) {
            const res = await api('/api/worklogs', { method: 'POST', body: { ...basePayload, log_date: d, member_id: memberId } });
            if (res && res.id) ok++;
        }
        //Error
        if (ok === 0) {
            toast(t('toast.failed_save'), 'error');
            toast(t('toast.overlap'), 'error_overlap');
            return;
        }
        toast(dates.length > 1 ? t('toast.added_days', ok, dates.length) : t('toast.entry_added'));
    }
    closeModal();
    loadWorklogs();
}

async function deleteWorklog(id) {
    if (!confirm('Delete this entry?')) return;
    const res = await api(`/api/worklogs/${id}`, { method: 'DELETE' });
    if (!res) return;
    if (res.error) { toast(res.error, 'error'); return; }
    toast(t('toast.entry_deleted'));
    loadWorklogs();
}

// ── Projects ──
async function loadProjects() {

    let description;
    let data;

    [data, description]  = await Promise.all([
        api(`/api/projects`),
        api(`/api/description`)
    ]);

    if (data) projects = data;
    if (description) pdes = description;
}

function loadProjectsList() {
    const ul = document.getElementById('projects-list');
    ul.innerHTML = '';
    projects.forEach(p => {
        const li = document.createElement('li');
        li.className = 'flex items-center justify-between py-1.5 px-3 rounded-lg bg-gray-50';
        li.innerHTML = `
            <span class="text-sm">${esc(p.name)}</span>
            <button class="btn-icon danger" onclick="deleteProject(${p.id})" title="Remove">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
        `;
        ul.appendChild(li);
    });
}

async function addProject() {
    const input = document.getElementById('new-project-name');
    const name = input.value.trim();
    if (!name) return;
    const res = await api('/api/projects', { method: 'POST', body: { name } });
    if (!res) return;
    if (res.error) { toast(res.error, 'error'); return; }
    input.value = '';
    invalidateCache('/api/projects');
    await loadProjects();
    loadProjectsList();
    toast(t('toast.project_added'));
}

async function deleteProject(id) {
    if (!confirm('Remove this project?')) return;
    const res = await api(`/api/projects/${id}`, { method: 'DELETE' });
    if (!res) return;
    if (res.error) { toast(res.error, 'error'); return; }
    invalidateCache('/api/projects');
    await loadProjects();
    loadProjectsList();
    toast(t('toast.project_removed'));
}

// ── Wire existing-ranges live refresh ──
(function wireExistingRangesListeners() {
    const fromEl = document.getElementById('wl-date-from');
    const toEl   = document.getElementById('wl-date-to');
    if (fromEl) fromEl.addEventListener('change', renderExistingRanges);
    if (toEl)   toEl.addEventListener('change', renderExistingRanges);
})();

// ── Members (Settings) ──