// ── Allowance tab ─────────────────────────────────────────
// CRUD UI for dbo.Allowance.
// Backend: app/allowance.py
//   GET    /api/allowance?member_id=&year=&month=
//   POST   /api/allowance
//   PUT    /api/allowance/<id>
//   DELETE /api/allowance/<id>
//
// Mirrors the Worklog tab UX (table + [+ Add] → modal).
// Form fields: date, project (Description from pdes), type (Normal | Special).
// IsEditRow column on each row acts as a row-lock: when 0, edit/delete are
// hidden in the UI AND rejected by the API (defense in depth).

let allowanceData = [];

// ── Month dropdown (separate from Worklog's #month-select) ───────────
function populateAllowanceMonthSelect() {
    const sel = document.getElementById('allowance-month-select');
    if (!sel || sel.options.length > 0) return;   // populate once
    const now = new Date().getMonth() + 1;
    for (let m = 1; m <= 12; m++) {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = (typeof MONTHS !== 'undefined') ? MONTHS[m] : String(m);
        if (m === now) opt.selected = true;
        sel.appendChild(opt);
    }
}

// ── Data load ────────────────────────────────────────────
async function loadAllowance() {
    if (!currentMemberId) return;
    populateAllowanceMonthSelect();
    const year  = document.getElementById('year-select').value;
    const month = document.getElementById('allowance-month-select').value;

    const data = await api(`/api/allowance?member_id=${currentMemberId}&year=${year}&month=${month}`);
    if (!data) return;
    allowanceData = Array.isArray(data) ? data : [];

    // Show / hide [+ Add Allowance] based on permission
    const addBtn = document.getElementById('btn-add-allowance');
    if (addBtn) addBtn.classList.toggle('hidden', !canEditMember(currentMemberId));

    renderAllowance(allowanceData);
}

// ── Render table ─────────────────────────────────────────
function renderAllowance(data) {
    const tbody = document.getElementById('allowance-body');
    const empty = document.getElementById('allowance-empty');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!data || data.length === 0) {
        if (empty) empty.classList.remove('hidden');
        return;
    }
    if (empty) empty.classList.add('hidden');

    const canEdit = canEditMember(currentMemberId);

    data.forEach(a => {
        const tr = document.createElement('tr');
        tr.className = 'border-b border-gray-100 hover:bg-gray-50';

        const dateStr = (typeof formatDate === 'function')
            ? formatDate(a.log_date)
            : (a.log_date || '');

        // type pill — reuse status badge styles
        const typeCls = a.type === 'S' ? 'badge-manday' : 'badge-pending';
        const typeLabel = a.type === 'S'
            ? (typeof t === 'function' ? t('al.type_special') : 'Special')
            : (typeof t === 'function' ? t('al.type_normal')  : 'Normal');

        const isEditable = Number(a.IsEditRow) === 1;
        let actionsCell = '';
        if (canEdit && isEditable) {
            actionsCell = `
                <button class="btn-icon" onclick='editAllowance(${JSON.stringify(a)})' title="Edit">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                </button>
                <button class="btn-icon danger" onclick="deleteAllowance(${a.ID})" title="Delete">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                </button>`;
        } else if (canEdit && !isEditable) {
            // Locked row — show a muted lock icon so users know why buttons are gone
            actionsCell = `
                <span class="inline-flex items-center text-gray-300" title="Row is locked">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 11c.886 0 1.616.713 1.616 1.5S12.886 14 12 14s-1.616-.713-1.616-1.5S11.114 11 12 11zM17 11V7a5 5 0 00-10 0v4M5 11h14a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2z"/>
                    </svg>
                </span>`;
        }

        tr.innerHTML = `
            <td class="py-2 px-3 whitespace-nowrap">${esc(dateStr)}</td>
            <td class="py-2 px-3"><span class="project-name-cell" title="${esc(a.ProjectCode || '')}">${esc(a.Description || '')}</span></td>
            <td class="py-2 px-3"><span class="badge ${typeCls}">${esc(typeLabel)}</span></td>
            <td class="py-2 px-3 text-right whitespace-nowrap">${actionsCell}</td>
        `;
        tbody.appendChild(tr);
    });
}

// ── Modal handling ───────────────────────────────────────
function _populateAllowanceProjectDropdown(selectedValue) {
    const sel = document.getElementById('al-project');
    if (!sel) return;
    sel.innerHTML = '<option value="">Select...</option>';
    if (Array.isArray(pdes)) {
        pdes.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.Description;
            opt.textContent = p.Description;
            sel.appendChild(opt);
        });
    }
    if (selectedValue) sel.value = selectedValue;
}

function openAddAllowance() {
    if (!currentMemberId) { toast(t('toast.select_member'), 'error'); return; }
    if (!canEditMember(currentMemberId)) { toast(t('toast.own_entries_only'), 'error'); return; }

    document.getElementById('allowance-modal-title').textContent = t('al.modal_add_title');
    document.getElementById('al-id').value      = '';
    document.getElementById('al-date').value    = new Date().toISOString().split('T')[0];
    document.getElementById('al-type').value    = 'Normal';
    _populateAllowanceProjectDropdown('');
    document.getElementById('allowance-modal-overlay').classList.remove('hidden');
}

function editAllowance(a) {
    if (!canEditMember(currentMemberId)) { toast(t('toast.own_entries_only'), 'error'); return; }
    if (Number(a.IsEditRow) !== 1) { toast(t('al.locked_msg') || 'Row is locked', 'error'); return; }

    document.getElementById('allowance-modal-title').textContent = t('al.modal_edit_title');
    document.getElementById('al-id').value   = a.ID;
    document.getElementById('al-date').value = a.log_date || '';
    document.getElementById('al-type').value = 'Normal';
    _populateAllowanceProjectDropdown(a.Description || '');
    document.getElementById('allowance-modal-overlay').classList.remove('hidden');
}

function closeAllowanceModal() {
    const ov = document.getElementById('allowance-modal-overlay');
    if (ov) ov.classList.add('hidden');
}

async function saveAllowance(e) {
    e.preventDefault();
    const id        = document.getElementById('al-id').value;
    const log_date  = document.getElementById('al-date').value;
    const project   = document.getElementById('al-project').value;
    const al_type   = document.getElementById('al-type').value;

    if (!log_date) { toast('Date is required', 'error'); return; }
    if (!project)  { toast('Project is required', 'error'); return; }
    if (al_type !== 'Normal' && al_type !== 'Special') {
        toast('Invalid type', 'error'); return;
    }

    const memberId = isElevated() ? currentMemberId : currentUser.member_id;
    const body = { log_date, project, type: al_type, member_id: memberId };

    let res;
    if (id) {
        res = await api(`/api/allowance/${id}`, { method: 'PUT', body });
    } else {
        res = await api('/api/allowance', { method: 'POST', body });
    }

    if (!res) return;
    if (res.error) { toast(res.error, 'error'); return; }

    toast(id ? (t('al.toast_updated') || 'Allowance updated')
             : (t('al.toast_added')   || 'Allowance added'));
    closeAllowanceModal();
    loadAllowance();
}

async function deleteAllowance(aid) {
    const msg = (typeof t === 'function' && t('al.confirm_delete'))
                || 'Delete this allowance entry?';
    if (!confirm(msg)) return;
    const res = await api(`/api/allowance/${aid}`, { method: 'DELETE' });
    if (!res) return;
    if (res.error) { toast(res.error, 'error'); return; }
    toast(t('al.toast_deleted') || 'Allowance deleted');
    loadAllowance();
}

// Expose for inline onclick handlers
try {
    window.loadAllowance         = loadAllowance;
    window.openAddAllowance      = openAddAllowance;
    window.editAllowance         = editAllowance;
    window.saveAllowance         = saveAllowance;
    window.deleteAllowance       = deleteAllowance;
    window.closeAllowanceModal   = closeAllowanceModal;
    window.populateAllowanceMonthSelect = populateAllowanceMonthSelect;
} catch (_) {}
