// ── Month Filter Modal ──
const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
let _monthExportCtx = null;

function openMonthFilterModal(ctx) {
    _monthExportCtx = ctx;
    const list = document.getElementById('month-cb-list');
    list.innerHTML = '';
    const _abbr = t('months.abbr');
    _abbr.slice(1).forEach((name, i) => {
        const label = document.createElement('label');
        label.className = 'flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-50 cursor-pointer';
        label.innerHTML = `
            <input type="checkbox" class="month-cb w-4 h-4 text-indigo-600 rounded" value="${i + 1}" checked>
            <span class="text-sm text-gray-700">${name}</span>`;
        list.appendChild(label);
    });
    document.getElementById('month-select-all').checked = true;
    document.getElementById('month-filter-overlay').classList.remove('hidden');
}

function closeMonthFilterModal() {
    document.getElementById('month-filter-overlay').classList.add('hidden');
    _monthExportCtx = null;
}

function toggleMonthSelectAll() {
    const checked = document.getElementById('month-select-all').checked;
    document.querySelectorAll('.month-cb').forEach(cb => cb.checked = checked);
}

function confirmMonthExport() {
    const months = Array.from(document.querySelectorAll('.month-cb:checked')).map(cb => cb.value);
    if (months.length === 0) { toast(t('toast.select_one_month'), 'error'); return; }
    const ctx = _monthExportCtx;
    closeMonthFilterModal();
    const mp = months.join(',');
    if (ctx.mode === 'single') {
        window.location.href = `/api/export/excel?member_id=${ctx.memberId}&year=${ctx.year}&months=${mp}`;
    } else {
        toast(`Preparing ZIP for ${ctx.memberIds.length} member${ctx.memberIds.length > 1 ? 's' : ''}...`);
        window.location.href = `/api/export/excel/bulk?member_ids=${ctx.memberIds.join(',')}&year=${ctx.year}&months=${mp}`;
    }
}

// ── Export ──
function exportToExcel() {
    if (!currentMemberId) { toast(t('toast.select_member'), 'error'); return; }
    const year = document.getElementById('year-select').value;
    openMonthFilterModal({ mode: 'single', memberId: currentMemberId, year });
}

// ── Bulk Export ──
function openBulkExportModal() {
    // Sync year with the main year selector
    const currentYear = document.getElementById('year-select').value;
    const yearSel = document.getElementById('bulk-year-select');
    yearSel.innerHTML = '';
    const now = new Date().getFullYear();
    for (let y = now - 2; y <= now + 1; y++) {
        const opt = document.createElement('option');
        opt.value = y;
        opt.textContent = y;
        if (String(y) === String(currentYear)) opt.selected = true;
        yearSel.appendChild(opt);
    }

    // Populate member checkboxes (all checked by default)
    const list = document.getElementById('bulk-member-list');
    list.innerHTML = '';
    const sel = document.getElementById('member-select');
    Array.from(sel.options).slice(1).forEach(opt => {
        const label = document.createElement('label');
        label.className = 'flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-50 cursor-pointer';
        label.innerHTML = `
            <input type="checkbox" class="bulk-member-cb w-4 h-4 text-indigo-600 rounded" value="${opt.value}" checked>
            <span class="text-sm text-gray-700">${esc(opt.textContent)}</span>
        `;
        list.appendChild(label);
    });

    document.getElementById('bulk-select-all').checked = true;
    document.getElementById('bulk-export-overlay').classList.remove('hidden');
}

function closeBulkExportModal() {
    document.getElementById('bulk-export-overlay').classList.add('hidden');
}

function toggleBulkSelectAll() {
    const checked = document.getElementById('bulk-select-all').checked;
    document.querySelectorAll('.bulk-member-cb').forEach(cb => cb.checked = checked);
}

function exportBulkMembers() {
    const ids = Array.from(document.querySelectorAll('.bulk-member-cb:checked')).map(cb => cb.value);
    if (ids.length === 0) { toast('Select at least one member', 'error'); return; }
    const year = document.getElementById('bulk-year-select').value;
    closeBulkExportModal();
    openMonthFilterModal({ mode: 'bulk', memberIds: ids, year });
}

