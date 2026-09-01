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

    updateMissingEntryCount();
    clearFilters(false);
    populateFilterProject();
    applyFilters();
}

async function prevMonth() {
    const year  = parseInt(document.getElementById('year-select').value, 10);
    const month = parseInt(document.getElementById('month-select').value, 10);

    if (month === 1) {
        document.getElementById('year-select').value = (year - 1).toString();
        document.getElementById('month-select').value = '12';
    } else {
        document.getElementById('month-select').value = (month - 1).toString();
    }

    setDirClass(document.getElementById('worklog-body'), 'prev');
    setDirClass(document.getElementById('cal-body'), 'prev');
    await loadWorklogs();
}

async function nextMonth() {
    const year  = parseInt(document.getElementById('year-select').value, 10);
    const month = parseInt(document.getElementById('month-select').value, 10);

    if (month === 12) {
        document.getElementById('year-select').value = (year + 1).toString();
        document.getElementById('month-select').value = '1';
    } else {
        document.getElementById('month-select').value = (month + 1).toString();
    }

    setDirClass(document.getElementById('worklog-body'), 'next');
    setDirClass(document.getElementById('cal-body'), 'next');
    await loadWorklogs();
}

function populateFilterProject() {
    const sel = document.getElementById('filter-project');
    const val = sel.value;
    sel.innerHTML = `<option value="">${t('wl.all_projects')}</option>`;
    const seen = new Set();
    worklogData.forEach(w => {
        if (w.project && !seen.has(w.project)) {
            seen.add(w.project);
            const opt = document.createElement('option');
            opt.value = w.project;
            opt.textContent = w.project;
            sel.appendChild(opt);
        }
    });
    sel.value = val;
}

function applyFilters() {
    const search  = document.getElementById('filter-search').value.toLowerCase().trim();
    const status  = document.getElementById('filter-status').value;
    const project = document.getElementById('filter-project').value;

    const filtered = worklogData.filter(w => {
        if (status  && w.status  !== status)  return false;
        if (project && w.project !== project) return false;
        if (search) {
            const hay = `${w.project || ''} ${w.task || ''} ${w.note || ''}`.toLowerCase();
            if (!hay.includes(search)) return false;
        }
        return true;
    });

    const countEl = document.getElementById('filter-count');
    if (search || status || project) {
        countEl.textContent = t('wl.filter_count', filtered.length, worklogData.length);
        countEl.classList.remove('hidden');
    } else {
        countEl.classList.add('hidden');
    }

    renderCurrentView(filtered);
}

function updateMissingEntryCount() {
    const bar   = document.getElementById('missing-count-bar');
    const label = document.getElementById('missing-count-label');
    if (!bar || !label) return;

    if (!currentMemberId) { bar.classList.add('hidden'); return; }

    const year  = parseInt(document.getElementById('year-select').value);
    const month = parseInt(document.getElementById('month-select').value);
    const daysInMonth = new Date(year, month, 0).getDate();

    const daysWithEntry = new Set();
    const holidayWithEntry = new Set();
    worklogData.forEach(w => {
        if (!w.log_date) return;
        daysWithEntry.add(parseInt(w.log_date.split('-')[2]));
    });

    holidayData.forEach(h => {
        if (!h.date) return;
        holidayWithEntry.add(parseInt(h.date.split('-')[2]));
    });

    let missing = 0;
    for (let d = 1; d <= daysInMonth; d++) {
        const dow = new Date(year, month - 1, d).getDay(); // 0=Sun, 6=Sat
        if (dow === 0 || dow === 6) continue;        // skip weekends
        if (holidayWithEntry.has(d)) continue;       // skip holidays
        if (!daysWithEntry.has(d)) missing++;
    }

    if (missing === 0) {
        bar.classList.add('hidden');
    } else {
        label.textContent = `Total missing entry = ${missing} day${missing !== 1 ? 's' : ''}`;
        bar.classList.remove('hidden');
    }
}

function clearFilters(rerender = true) {
    document.getElementById('filter-search').value  = '';
    document.getElementById('filter-status').value  = '';
    document.getElementById('filter-project').value = '';
    document.getElementById('filter-count').classList.add('hidden');
    if (rerender) renderCurrentView(worklogData);
}

function renderCurrentView(data) {
    if (currentWorklogView === 'calendar') {
        renderWorklogs(data);       // keep table in sync (hidden)
        renderCalendar(data);
    } else {
        renderWorklogs(data);
    }
}

// ── View Toggle ──
function setWorklogView(view) {
    currentWorklogView = view;
    document.getElementById('toggle-table').classList.toggle('active', view === 'table');
    document.getElementById('toggle-calendar').classList.toggle('active', view === 'calendar');
    document.getElementById('worklog-table-view').classList.toggle('hidden', view !== 'table');
    document.getElementById('worklog-calendar-view').classList.toggle('hidden', view !== 'calendar');
    if (view === 'calendar') {
        applyFilters();   // re-render calendar with current filters
    }
}

// ── Worklog multi-select state ──
let worklogSelectedIds = new Set();
let _worklogVisibleData = [];

function renderWorklogs(data) {
    const canEdit = canEditMember(currentMemberId);
    const tbody   = document.getElementById('worklog-body');
    const empty   = document.getElementById('worklog-empty');
    const thCb    = document.getElementById('wl-th-checkbox');
    tbody.innerHTML = '';
    _worklogVisibleData = data;
    // Drop selections that are no longer visible (e.g. month changed)
    const visibleIds = new Set(data.map(w => w.id));
    [...worklogSelectedIds].forEach(id => { if (!visibleIds.has(id)) worklogSelectedIds.delete(id); });
    if (thCb) thCb.style.display = canEdit ? '' : 'none';

    if (data.length === 0) {
        empty.classList.remove('hidden');
        const emptyAddBtn = empty.querySelector('button');
        if (emptyAddBtn) emptyAddBtn.classList.toggle('hidden', !canEdit);
        _updateWorklogBulkBar();
        return;
    }
    empty.classList.add('hidden');

    data.forEach((w, idx) => {
        const tr = document.createElement('tr');
        tr.className = 'border-b border-gray-100';
        revealStagger(tr, idx);
        const dateStr   = formatDate(w.log_date);
        const statusCls = w.status === 'Done' ? 'badge-done' : w.status === 'In Progress' ? 'badge-progress' : w.status === 'Man day' ? 'badge-manday' : 'badge-pending';
        const isSelected = worklogSelectedIds.has(w.id);
        const rowEditable = canEdit && Number(w.IsEditRow) !== 0;
        const cbCell = rowEditable
            ? `<td class="py-2 px-2 text-center"><input type="checkbox" data-wl-cb="${w.id}" ${isSelected ? 'checked' : ''} onclick="onWorklogRowToggle(event, ${w.id})" class="rounded"></td>`
            : (canEdit ? `<td></td>` : '');
        const actions   = rowEditable ? `
                <button class="btn-icon" onclick='editWorklog(${JSON.stringify(w)})' title="Edit">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                </button>
                <button class="btn-icon danger" onclick="deleteWorklog(${w.id})" title="Delete">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                </button>` : '';
        tr.innerHTML = `
            ${cbCell}
            <td class="py-2 px-2 whitespace-nowrap">${dateStr}</td>
            <td class="py-2 px-2"><span class="project-name-cell" title="${esc(w.project_description || w.project || '')}">${esc(w.project || '')}</span></td>
            <td class="py-2 px-2">${esc(w.task || '')}</td>
            <td class="py-2 px-2 text-center">${w.start_time || ''}</td>
            <td class="py-2 px-2 text-center">${w.end_time || ''}</td>
            <td class="py-2 px-2 text-right font-medium">${w.hours != null ? w.hours.toFixed(2) : ''}</td>
            <td class="py-2 px-2 text-center"><span class="badge ${statusCls}">${w.status || ''}</span></td>
            <td class="py-2 px-2 text-gray-500">${esc(w.note || '')}</td>
            <td class="py-2 px-2 whitespace-nowrap">${actions}</td>
        `;
        tbody.appendChild(tr);
    });
    _updateWorklogBulkBar();
}

function onWorklogRowToggle(ev, id) {
    ev.stopPropagation();
    if (ev.target.checked) worklogSelectedIds.add(id);
    else worklogSelectedIds.delete(id);
    _updateWorklogBulkBar();
}

function onWorklogSelectAll(ev) {
    const checked = ev.target.checked;
    _worklogVisibleData.forEach(w => {
        if (checked) worklogSelectedIds.add(w.id);
        else worklogSelectedIds.delete(w.id);
    });
    document.querySelectorAll('[data-wl-cb]').forEach(cb => { cb.checked = checked; });
    _updateWorklogBulkBar();
}

function clearWorklogSelection() {
    worklogSelectedIds.clear();
    document.querySelectorAll('[data-wl-cb]').forEach(cb => { cb.checked = false; });
    const all = document.getElementById('wl-select-all');
    if (all) { all.checked = false; all.indeterminate = false; }
    _updateWorklogBulkBar();
}

function _updateWorklogBulkBar() {
    const bar = document.getElementById('wl-bulk-bar');
    const count = document.getElementById('wl-bulk-count');
    const all = document.getElementById('wl-select-all');
    if (!bar || !count) return;
    const n = worklogSelectedIds.size;
    bar.classList.toggle('hidden', n === 0);
    count.textContent = String(n);
    if (all) {
        const visN = _worklogVisibleData.length;
        const sel = _worklogVisibleData.filter(w => worklogSelectedIds.has(w.id)).length;
        all.checked = visN > 0 && sel === visN;
        all.indeterminate = sel > 0 && sel < visN;
    }
}

async function bulkDeleteWorklogs() {
    const ids = [...worklogSelectedIds];
    if (!ids.length) return;
    if (!confirm(`Delete ${ids.length} selected entr${ids.length === 1 ? 'y' : 'ies'}?`)) return;
    let ok = 0, fail = 0;
    for (const id of ids) {
        const res = await api(`/api/worklogs/${id}`, { method: 'DELETE' });
        if (res && !res.error) ok++; else fail++;
    }
    if (ok) toast(`Deleted ${ok} entr${ok === 1 ? 'y' : 'ies'}`);
    if (fail) toast(`${fail} delete${fail === 1 ? '' : 's'} failed`, 'error');
    clearWorklogSelection();
    await loadWorklogs();
}

function openBulkEditModal() {
    if (!worklogSelectedIds.size) return;
    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const setVal  = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    const setChk  = (id, v) => { const el = document.getElementById(id); if (el) el.checked = v; };
    setText('wl-bulk-edit-count', String(worklogSelectedIds.size));
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
    const ids = [...worklogSelectedIds];
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
    clearWorklogSelection();
    await loadWorklogs();
}

try {
    window.onWorklogRowToggle = onWorklogRowToggle;
    window.onWorklogSelectAll = onWorklogSelectAll;
    window.clearWorklogSelection = clearWorklogSelection;
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
    return withBusy(document.getElementById('modal-save-btn'), _saveWorklogEntries);
}

async function _saveWorklogEntries() {
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
    populateProjectsFilterStatus();
    populateProjectsFilterDept();
    applyProjectsFilter();
}

function populateProjectsFilterStatus() {
    const sel = document.getElementById('projects-filter-status');
    if (!sel) return;
    const val = sel.value;
    sel.innerHTML = `<option value="">${t('set.all_status')}</option>`;
    const seen = new Set();
    pdes.forEach(p => {
        const status = (p.Status || '').trim();
        if (status && !seen.has(status)) {
            seen.add(status);
            const opt = document.createElement('option');
            opt.value = status;
            opt.textContent = status;
            sel.appendChild(opt);
        }
    });
    sel.value = val;
}

function populateProjectsFilterDept() {
    const sel = document.getElementById('projects-filter-dept');
    if (!sel) return;
    const val = sel.value;
    sel.innerHTML = `<option value="">${t('set.all_departments')}</option>`;
    const depts = [...new Set(pdes.map(p => (p.ProjectDepartment || '').trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));
    depts.forEach(dept => {
        const opt = document.createElement('option');
        opt.value = dept;
        opt.textContent = dept;
        sel.appendChild(opt);
    });
    sel.value = val;
}

function applyProjectsFilter() {
    const searchEl = document.getElementById('projects-filter-search');
    const statusEl = document.getElementById('projects-filter-status');
    const deptEl = document.getElementById('projects-filter-dept');
    const search = searchEl ? searchEl.value.toLowerCase().trim() : '';
    const status = statusEl ? statusEl.value : '';
    const dept = deptEl ? deptEl.value : '';

    const filtered = pdes.filter(p => {
        if (status && (p.Status || '').trim() !== status) return false;
        if (dept && (p.ProjectDepartment || '').trim() !== dept) return false;
        if (search) {
            const hay = `${p.Projectcode || ''} ${p.Description || ''}`.toLowerCase();
            if (!hay.includes(search)) return false;
        }
        return true;
    });

    renderProjectsRows(filtered);
}

function renderProjectsRows(list) {
    const ul = document.getElementById('projects-list');
    ul.innerHTML = '';
    list.forEach(p => {
        const li = document.createElement('li');
        li.className = 'proj-row proj-row-body';

        const codeSpan = document.createElement('span');
        codeSpan.className = 'proj-col-code';
        codeSpan.textContent = p.Projectcode || '';
        codeSpan.title = p.Projectcode || '';

        const descSpan = document.createElement('span');
        descSpan.className = 'proj-col-desc';
        descSpan.textContent = p.Description || '';
        descSpan.title = p.Description || '';

        const deptWrap = document.createElement('span');
        deptWrap.className = 'proj-col-dept';
        if (p.ProjectDepartment) {
            const deptBadge = document.createElement('span');
            deptBadge.className = 'badge badge-dept';
            deptBadge.textContent = p.ProjectDepartment;
            deptBadge.title = p.ProjectDepartment;
            deptWrap.appendChild(deptBadge);
        }
        
        const statusWrap = document.createElement('span');
        statusWrap.className = 'proj-col-status';
        const badge = document.createElement('span');
        badge.className = `badge ${_projStatusBadgeClass(p.Status)}`;
        badge.textContent = p.Status || '';
        statusWrap.appendChild(badge);

        li.append(codeSpan, descSpan, statusWrap, deptWrap);
        ul.appendChild(li);
    });
}

function _projStatusBadgeClass(status) {
    const map = {
        initiative: 'badge-proj-initiative',
        exclusive:  'badge-proj-exclusive',
        monitoring: 'badge-proj-monitoring',
        execute:    'badge-proj-execute',
        warranty:   'badge-proj-warranty',
        hold:       'badge-proj-hold',
        closed:     'badge-proj-closed',
    };
    return map[String(status || '').trim().toLowerCase()] || 'badge-proj-default';
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
