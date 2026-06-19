// ── Projects Summary tab ──────────────────────────────────
// Modern dashboard: KPI cards + Chart.js bar/donut + detail table.
// Backend: GET /api/projects-summary?year=Y&month=M  (elevated only)

let _psSelectorsReady = false;
const _psExpanded = new Set();
let _psBarChart   = null;
let _psDonutChart = null;

const PS_COLORS = [
    '#4f46e5','#10b981','#f59e0b','#ef4444','#8b5cf6',
    '#14b8a6','#f97316','#ec4899','#3b82f6','#84cc16',
    '#0ea5e9','#a855f7','#22c55e','#eab308','#d946ef'
];

// ── Selectors ────────────────────────────────────────────

function populateProjectsSummarySelectors() {
    if (_psSelectorsReady) return;
    const yearSel  = document.getElementById('ps-year');
    const monthSel = document.getElementById('ps-month');
    if (!yearSel || !monthSel) return;

    const now      = new Date();
    const curYear  = now.getFullYear();
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

// ── Data load ────────────────────────────────────────────

async function loadProjectsSummary() {
    populateProjectsSummarySelectors();
    const year  = document.getElementById('ps-year').value;
    const month = document.getElementById('ps-month').value;
    if (!year || !month) return;
    const data = await api(`/api/projects-summary?year=${year}&month=${month}`);
    if (!data) return;
    await loadChartJs();
    renderProjectsSummary(data);
}

// ── Helpers ──────────────────────────────────────────────

function _psEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function _el(id) { return document.getElementById(id); }

// ── KPI cards ────────────────────────────────────────────

function _psUpdateKPIs(projects) {
    const totalProjects = projects.length;
    const totalHours    = projects.reduce((s, p) => s + p.total_hours, 0);
    const unique        = new Set();
    projects.forEach(p => p.employees.forEach(e => unique.add(e.employee_id)));
    const avgHours = totalProjects ? totalHours / totalProjects : 0;

    if (_el('ps-kpi-projects'))  _el('ps-kpi-projects').textContent  = totalProjects;
    if (_el('ps-kpi-hours'))     _el('ps-kpi-hours').textContent     = totalHours.toFixed(1);
    if (_el('ps-kpi-employees')) _el('ps-kpi-employees').textContent = unique.size;
    if (_el('ps-kpi-avg'))       _el('ps-kpi-avg').textContent       = avgHours.toFixed(1);
}

// ── Bar chart ────────────────────────────────────────────

function _psRenderBarChart(projects) {
    const canvas = _el('ps-bar-canvas');
    const wrap   = _el('ps-bar-wrap');
    if (!canvas || !wrap) return;

    const chartH = Math.min(Math.max(180, projects.length * 44 + 60), 480);
    wrap.style.height = chartH + 'px';

    if (_psBarChart) { _psBarChart.destroy(); _psBarChart = null; }

    const labels = projects.map(p => p.project_department);
    const values = projects.map(p => p.total_hours);
    const colors = projects.map((_, i) => PS_COLORS[i % PS_COLORS.length]);

    _psBarChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: colors.map(c => c + '28'),
                borderColor: colors,
                borderWidth: 2,
                borderRadius: 6,
                borderSkipped: false,
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 600, easing: 'easeOutQuart' },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1e293b',
                    titleColor: '#94a3b8',
                    bodyColor: '#f1f5f9',
                    padding: 10,
                    cornerRadius: 8,
                    callbacks: {
                        title: ctx => {
                            const proj = projects[ctx[0].dataIndex];
                            return proj.project_description || proj.project_department;
                        },
                        label: ctx => `  ${ctx.raw.toFixed(1)} hours`
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    grid: { color: '#f1f5f9', drawBorder: false },
                    border: { display: false },
                    ticks: {
                        font: { size: 11 },
                        color: '#94a3b8',
                        callback: v => v + 'h'
                    }
                },
                y: {
                    grid: { display: false, drawBorder: false },
                    border: { display: false },
                    ticks: {
                        font: { size: 12, weight: '500' },
                        color: '#374151',
                        maxRotation: 0,
                        callback: function(val) {
                            const lbl = this.getLabelForValue(val);
                            return lbl.length > 24 ? lbl.slice(0, 22) + '…' : lbl;
                        }
                    }
                }
            }
        }
    });
}

// ── Donut chart ──────────────────────────────────────────

function _psRenderDonutChart(projects, totalHours) {
    const canvas   = _el('ps-donut-canvas');
    const legendEl = _el('ps-legend');
    if (!canvas) return;

    const TOP_N    = 8;
    let items      = [...projects];
    if (items.length > TOP_N) {
        const othersH = items.slice(TOP_N).reduce((s, p) => s + p.total_hours, 0);
        items = [...items.slice(0, TOP_N), { project_department: 'Others', total_hours: othersH }];
    }

    const labels = items.map(p => p.project_department);
    const values = items.map(p => p.total_hours);
    const colors = items.map((_, i) => PS_COLORS[i % PS_COLORS.length]);

    if (_psDonutChart) { _psDonutChart.destroy(); _psDonutChart = null; }

    _psDonutChart = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: colors,
                borderColor: '#fff',
                borderWidth: 3,
                hoverBorderWidth: 2,
                hoverOffset: 8,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%',
            animation: { duration: 700, easing: 'easeOutQuart' },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1e293b',
                    titleColor: '#94a3b8',
                    bodyColor: '#f1f5f9',
                    padding: 10,
                    cornerRadius: 8,
                    callbacks: {
                        title: ctx => {
                            const item = items[ctx[0].dataIndex];
                            return item.project_description || item.project_department;
                        },
                        label: ctx => {
                            const pct = totalHours > 0
                                ? (ctx.raw / totalHours * 100).toFixed(1) : '0.0';
                            return `  ${ctx.raw.toFixed(1)}h  (${pct}%)`;
                        }
                    }
                }
            }
        }
    });

    if (legendEl) {
        legendEl.innerHTML = items.map((p, i) => {
            const pct = totalHours > 0
                ? (p.total_hours / totalHours * 100).toFixed(1) : '0.0';
            return `<div class="ps-legend-item" title="${_psEsc(p.project_description || '')}">
                <span class="ps-legend-swatch" style="background:${colors[i]}"></span>
                <span class="ps-legend-name">${_psEsc(p.project_department)}</span>
                <span class="ps-legend-pct">${pct}%</span>
            </div>`;
        }).join('');
    }
}

// ── Detail table ─────────────────────────────────────────

function _psRenderTable(projects, totalHours) {
    const tbody = _el('ps-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    projects.forEach((p, idx) => {
        const isOpen    = _psExpanded.has(p.project_department);
        const color     = PS_COLORS[idx % PS_COLORS.length];
        const sharePct  = totalHours > 0 ? (p.total_hours / totalHours * 100) : 0;

        const projTr = document.createElement('tr');
        projTr.className = 'ps-proj-row' + (isOpen ? ' expanded' : '');
        projTr.onclick = () => {
            if (_psExpanded.has(p.project_department)) _psExpanded.delete(p.project_department);
            else _psExpanded.add(p.project_department);
            _psRenderTable(projects, totalHours);
        };
        projTr.innerHTML = `
            <td class="py-3 px-4 w-8">
                <svg class="ps-chevron w-4 h-4 ${isOpen ? 'open' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
                </svg>
            </td>
            <td class="py-3 px-4">
                <span class="inline-flex items-center gap-2">
                    <span class="ps-proj-color-bar" style="background:${color};height:1.1em;align-self:stretch;"></span>
                    <span class="project-name-cell" style="font-size:.875rem;font-weight:600;color:#1e293b;" title="${_psEsc(p.project_description || '')}">${_psEsc(p.project_department)}</span>
                </span>
            </td>
            <td class="py-3 px-4 text-right">
                <span style="font-size:.8125rem;color:#64748b;font-weight:500;">${p.employees_count}</span>
            </td>
            <td class="py-3 px-4 text-right">
                <span class="ps-hours-badge">${p.total_hours.toFixed(1)}</span>
            </td>
            <td class="py-3 px-4" style="min-width:140px;">
                <div class="flex items-center gap-2">
                    <div class="ps-share-bar-bg flex-1">
                        <div class="ps-share-bar-fill" style="--bar-color:${color};width:${sharePct.toFixed(1)}%;"></div>
                    </div>
                    <span class="ps-share-pct">${sharePct.toFixed(1)}%</span>
                </div>
            </td>`;
        tbody.appendChild(projTr);

        if (isOpen) {
            (p.employees || []).forEach(emp => {
                const empTr = document.createElement('tr');
                empTr.className = 'ps-emp-row';
                empTr.innerHTML = `
                    <td class="py-2 px-4"></td>
                    <td class="py-2 px-4 pl-10">
                        <span style="font-size:.8125rem;color:#475569;">${_psEsc(emp.name)}</span>
                    </td>
                    <td class="py-2 px-4 text-right">
                        <span style="font-size:.75rem;color:#94a3b8;">${_psEsc(emp.employee_id || '')}</span>
                    </td>
                    <td class="py-2 px-4 text-right">
                        <span class="ps-hours-badge emp">${emp.hours.toFixed(1)}</span>
                    </td>
                    <td class="py-2 px-4"></td>`;
                tbody.appendChild(empTr);
            });
        }
    });
}

// ── Main render ──────────────────────────────────────────

function renderProjectsSummary(data) {
    const empty      = _el('ps-empty');
    const tableWrap  = _el('ps-table-wrap');
    const chartsRow  = _el('ps-charts-row');
    const kpiSection = _el('ps-kpi-section');

    const projects   = (data && data.projects) || [];
    const totalHours = projects.reduce((s, p) => s + p.total_hours, 0);

    const periodEl = _el('ps-bar-period-label');
    if (periodEl && data) {
        periodEl.textContent = `${MONTHS[data.month]} ${data.year}`;
    }

    if (projects.length === 0) {
        if (empty)      empty.classList.remove('hidden');
        if (tableWrap)  tableWrap.classList.add('hidden');
        if (chartsRow)  chartsRow.style.display = 'none';
        if (kpiSection) kpiSection.style.display = 'none';
        if (_psBarChart)   { _psBarChart.destroy();   _psBarChart   = null; }
        if (_psDonutChart) { _psDonutChart.destroy();  _psDonutChart = null; }
        return;
    }

    if (empty)      empty.classList.add('hidden');
    if (tableWrap)  tableWrap.classList.remove('hidden');
    if (chartsRow)  chartsRow.style.display = '';
    if (kpiSection) kpiSection.style.display = '';

    _psUpdateKPIs(projects);
    _psRenderBarChart(projects);
    _psRenderDonutChart(projects, totalHours);
    _psRenderTable(projects, totalHours);
}

try {
    window.loadProjectsSummary = loadProjectsSummary;
    window.populateProjectsSummarySelectors = populateProjectsSummarySelectors;
} catch (e) {}
