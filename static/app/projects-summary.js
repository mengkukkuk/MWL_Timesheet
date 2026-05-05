// ── Projects Summary tab ──
// Per-project monthly hour totals with per-employee breakdown (elevated only).
// Backend: GET /api/projects-summary?year=Y&month=M
//
// Local year/month selectors (#ps-year, #ps-month) — independent of the
// global #year-select used by the Dashboard tab, since #month-select is
// currently scoped to the Worklog tab.

let _psSelectorsReady = false;
const _psExpanded = new Set();   // project_name strings whose employee rows are open

function populateProjectsSummarySelectors() {
    if (_psSelectorsReady) return;
    const yearSel = document.getElementById('ps-year');
    const monthSel = document.getElementById('ps-month');
    if (!yearSel || !monthSel) return;

    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth() + 1;

    yearSel.innerHTML = '';
    for (let y = curYear - 2; y <= curYear + 2; y++) {
        const opt = document.createElement('option');
        opt.value = y; opt.textContent = y;
        if (y === curYear) opt.selected = true;
        yearSel.appendChild(opt);
    }

    monthSel.innerHTML = '';
    for (let m = 1; m <= 12; m++) {
        const opt = document.createElement('option');
        opt.value = m; opt.textContent = MONTHS[m];
        if (m === curMonth) opt.selected = true;
        monthSel.appendChild(opt);
    }

    _psSelectorsReady = true;
}

async function loadProjectsSummary() {
    populateProjectsSummarySelectors();

    const year = document.getElementById('ps-year').value;
    const month = document.getElementById('ps-month').value;
    if (!year || !month) return;

    const data = await api(`/api/projects-summary?year=${year}&month=${month}`);
    if (!data) return;
    renderProjectsSummary(data);
}

function _psEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderProjectsSummary(data) {
    const tbody = document.getElementById('ps-tbody');
    const empty = document.getElementById('ps-empty');
    const wrap  = document.getElementById('ps-table-wrap');
    if (!tbody || !empty || !wrap) return;

    tbody.innerHTML = '';

    const projects = (data && data.projects) || [];
    if (projects.length === 0) {
        empty.classList.remove('hidden');
        wrap.classList.add('hidden');
        return;
    }
    empty.classList.add('hidden');
    wrap.classList.remove('hidden');

    projects.forEach((p, idx) => {
        const isOpen = _psExpanded.has(p.project_name);
        const projTr = document.createElement('tr');
        projTr.className = 'border-b border-gray-100 cursor-pointer hover:bg-gray-50';
        projTr.onclick = () => {
            if (_psExpanded.has(p.project_name)) _psExpanded.delete(p.project_name);
            else _psExpanded.add(p.project_name);
            renderProjectsSummary(data);
        };
        projTr.innerHTML = `
            <td class="py-2 px-3 text-gray-400">
                <svg class="w-4 h-4 inline transition-transform ${isOpen ? 'rotate-90' : ''}"
                     fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
                </svg>
            </td>
            <td class="py-2 px-3 font-medium">${_psEsc(p.project_name)}</td>
            <td class="py-2 px-3 text-right">${p.employees_count}</td>
            <td class="py-2 px-3 text-right font-semibold">${p.total_hours}</td>
        `;
        tbody.appendChild(projTr);

        if (isOpen) {
            (p.employees || []).forEach(emp => {
                const empTr = document.createElement('tr');
                empTr.className = 'border-b border-gray-50 bg-gray-50/50';
                empTr.innerHTML = `
                    <td></td>
                    <td class="py-1.5 px-3 pl-8 text-gray-700">${_psEsc(emp.name)}</td>
                    <td class="py-1.5 px-3 text-right text-xs text-gray-400">${_psEsc(emp.employee_id || '')}</td>
                    <td class="py-1.5 px-3 text-right">${emp.hours}</td>
                `;
                tbody.appendChild(empTr);
            });
        }
    });
}

// Expose for inline onchange handlers in the markup
try {
    window.loadProjectsSummary = loadProjectsSummary;
    window.populateProjectsSummarySelectors = populateProjectsSummarySelectors;
} catch (e) {}
