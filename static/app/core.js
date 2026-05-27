// ── State ──
let currentMemberId = null;
let currentUser = null;

function isElevated() {
    return currentUser && ['Super_Ultimate_ADMIN', 'Admin', 'Leader'].includes(currentUser.role);
}
let members = [];
let projects = [];
let worklogData = [];
let currentWorklogView = 'table'; // 'table' or 'calendar'
let _multiAddMode = false;
const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

// ── Lazy module loader ───────────────────────────────────────────────────────
// On-demand <script> injection for tab modules that aren't needed for first
// paint. Each module is fetched at most once; subsequent calls return the
// cached promise. Modules are listed by basename (without `.js`), and pulled
// from /static/app/<name>.js — same path used by the eager <script defer>
// tags in templates/index.html.
const _moduleLoadPromises = Object.create(null);
function loadModuleOnce(name) {
    if (_moduleLoadPromises[name]) return _moduleLoadPromises[name];
    _moduleLoadPromises[name] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        const _v = (window.STATIC_V || {})[name] || 0;
        s.src = `/static/app/${name}.js?v=${_v}`;
        s.async = false; // preserve global-init order if multiple lazy loads stack
        s.onload = () => resolve();
        s.onerror = () => {
            delete _moduleLoadPromises[name]; // allow retry on transient failure
            reject(new Error(`Failed to load module: ${name}`));
        };
        document.head.appendChild(s);
    });
    return _moduleLoadPromises[name];
}

// Lazy-load Chart.js (~70 KB gz) only when a chart-using view is opened.
// Returns a cached promise that resolves when window.Chart is available.
let _chartJsPromise = null;
function loadChartJs() {
    if (_chartJsPromise) return _chartJsPromise;
    if (typeof window.Chart !== 'undefined') {
        _chartJsPromise = Promise.resolve();
        return _chartJsPromise;
    }
    _chartJsPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js';
        s.async = false;
        s.onload = () => resolve();
        s.onerror = () => {
            _chartJsPromise = null;
            reject(new Error('Failed to load Chart.js'));
        };
        document.head.appendChild(s);
    });
    return _chartJsPromise;
}

// ── Init ──
async function initializeApp() {
    // Background glow tracking
    document.addEventListener('mousemove', e => {
        const x = (e.clientX / window.innerWidth) * 100;
        const y = (e.clientY / window.innerHeight) * 100;
        document.documentElement.style.setProperty('--mouse-x', `${x}%`);
        document.documentElement.style.setProperty('--mouse-y', `${y}%`);
    });

    const me = await api('/api/me');
    if (!me) return;
    currentUser = me;

    document.getElementById('nav-user').textContent = currentUser.username;

    if (!isElevated()) {
        document.getElementById('tab-settings').classList.add('hidden');
    } else {
        document.getElementById('btn-export-multiple').classList.remove('hidden');
        document.getElementById('btn-add-worklog-multi').classList.remove('hidden');
        document.getElementById('tab-projects-summary').classList.remove('hidden');
        // Pending-account approval badge: refresh now + every 60s.
        // settings.js is lazy-loaded — fetch it once for the badge ticker,
        // then refresh on a 60-second cadence.
        loadModuleOnce('settings').then(() => {
            if (typeof refreshPendingBadge === 'function') {
                refreshPendingBadge();
                setInterval(() => { try { refreshPendingBadge(); } catch (e) {} }, 60_000);
            }
        }).catch(() => { /* badge stays unrendered — non-critical */ });
    }

    populateYearSelect();
    populateMonthSelect();
    await loadMembers();
    // loadProjects is defined in another module (worklogs.js). wait for modulesLoaded if needed
    if (typeof loadProjects !== 'function') {
        await new Promise((resolve) => {
            const onLoaded = () => { document.removeEventListener('modulesLoaded', onLoaded); resolve(); };
            document.addEventListener('modulesLoaded', onLoaded);
        });
    }
    if (typeof loadProjects === 'function') await loadProjects();

    if (!isElevated() && currentUser.member_id) {
        currentMemberId = currentUser.member_id;
        document.getElementById('member-select').value = currentMemberId;
    }

    // Restore last selected tab from previous session (if available)
    try {
        const last = localStorage.getItem('lastTab');
        const allowedTabs = new Set(['dashboard', 'worklog', 'allowance', 'files', 'projects-summary', 'settings']);
        let toShow = allowedTabs.has(last) ? last : 'dashboard';
        // protect against unauthorized tabs
        if (toShow === 'settings' && !isElevated()) toShow = 'dashboard';
        if (toShow === 'projects-summary' && !isElevated()) toShow = 'dashboard';
        showTab(toShow);
        // Restore Squad Draft state (open/closed + selected project) after
        // core context (members/projects/currentUser) is ready. draft.js is
        // lazy-loaded — only fetch when needed, after first paint.
        loadModuleOnce('draft').then(() => {
            if (typeof restoreDraftPanelState === 'function') {
                return restoreDraftPanelState();
            }
        }).catch(() => { /* draft panel stays closed — non-critical */ });
    } catch (e) {
        onContextChange();
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}

//Add year in selection
function populateYearSelect() {
    const sel = document.getElementById('year-select');
    const now = new Date().getFullYear();
    for (let y = now - 2; y <= now + 2; y++) {
        const opt = document.createElement('option');
        opt.value = y; opt.textContent = y;
        if (y === now) opt.selected = true;
        sel.appendChild(opt);
    }
}

function populateMonthSelect() {
    const sel = document.getElementById('month-select');
    const now = new Date().getMonth() + 1;
    for (let m = 1; m <= 12; m++) {
        const opt = document.createElement('option');
        opt.value = m; opt.textContent = MONTHS[m];
        if (m === now) opt.selected = true;
        sel.appendChild(opt);
    }
}

// Month selector for the Overall Dashboard (separate from the worklog #month-select).
// Idempotent — only populates once.
function populateOverallMonthSelect() {
    const sel = document.getElementById('overall-month-select');
    if (!sel || sel.options.length > 0) return;
    const now = new Date().getMonth() + 1;
    for (let m = 1; m <= 12; m++) {
        const opt = document.createElement('option');
        opt.value = m; opt.textContent = MONTHS[m];
        if (m === now) opt.selected = true;
        sel.appendChild(opt);
    }
}

function onOverallMonthChange() {
    if (currentMemberId) return;   // only relevant in Overall view
    if (typeof loadOverallDashboard === 'function') loadOverallDashboard();
}
try { window.onOverallMonthChange = onOverallMonthChange; } catch (e) {}

// ── Tabs ──
async function showTab(name) {
    if (name === 'settings' && !isElevated()) return;
    if (name === 'projects-summary' && !isElevated()) return;
    ['dashboard', 'worklog', 'allowance', 'files', 'projects-summary', 'settings'].forEach(t => {
        const viewEl = document.getElementById('view-' + t);
        const tabEl  = document.getElementById('tab-' + t);
        if (viewEl) viewEl.classList.toggle('hidden', t !== name);
        if (tabEl)  tabEl.classList.toggle('active', t === name);
    });
    // persist last selected tab so page reload restores it
    try { localStorage.setItem('lastTab', name); } catch (e) {}

    // special handling for Worklog view when no member is selected
    if (name === 'worklog') {
        const noMemberEl  = document.getElementById('worklog-no-member');
        const contentEl   = document.getElementById('worklog-content');
        const tableView   = document.getElementById('worklog-table-view');
        const calView     = document.getElementById('worklog-calendar-view');
        if (!currentMemberId) {
            if (noMemberEl) noMemberEl.classList.remove('hidden');
            if (contentEl)  contentEl.classList.add('hidden');
        } else {
            if (noMemberEl) noMemberEl.classList.add('hidden');
            if (contentEl)  contentEl.classList.remove('hidden');
            // Restore the correct view without showing both at once
            if (tableView) tableView.classList.toggle('hidden', currentWorklogView !== 'table');
            if (calView)   calView.classList.toggle('hidden',   currentWorklogView !== 'calendar');
            loadWorklogs();
        }
        return;
    }

    // Allowance: mirrors worklog "no member" handling
    if (name === 'allowance') {
        const noMemberEl = document.getElementById('allowance-no-member');
        const contentEl  = document.getElementById('allowance-content');
        if (!currentMemberId) {
            if (noMemberEl) noMemberEl.classList.remove('hidden');
            if (contentEl)  contentEl.classList.add('hidden');
        } else {
            if (noMemberEl) noMemberEl.classList.add('hidden');
            if (contentEl)  contentEl.classList.remove('hidden');
            if (typeof populateAllowanceMonthSelect === 'function') populateAllowanceMonthSelect();
            if (typeof loadAllowance === 'function') loadAllowance();
        }
        return;
    }

    if (name === 'dashboard') onContextChange();
    if (name === 'settings') {
        // settings.js is lazy — wait for it before invoking its renderers.
        // loadProjectsList lives in worklogs.js (eager) so it can run immediately.
        loadProjectsList();
        await loadModuleOnce('settings');
        const lastPanel = localStorage.getItem('settings_panel') || 'members';
        if (typeof showSettingsPanel === 'function') showSettingsPanel(lastPanel);
        if (typeof loadMembersList === 'function') loadMembersList();
        if (typeof loadUsersList === 'function') loadUsersList();
        if (typeof loadPendingUsers === 'function') loadPendingUsers();
        if (currentUser && currentUser.role === 'Super_Ultimate_ADMIN'
            && typeof loadSettings === 'function') loadSettings();
    }
    if (name === 'files') {
        await loadModuleOnce('files');
        if (typeof loadFileTree === 'function') loadFileTree();
    }
    if (name === 'projects-summary') {
        await loadModuleOnce('projects-summary');
        if (typeof populateProjectsSummarySelectors === 'function') populateProjectsSummarySelectors();
        if (typeof loadProjectsSummary === 'function') loadProjectsSummary();
    }
}

// ── API helpers ──
async function api(url, opts = {}) {
    if (opts.body && typeof opts.body === 'object') {
        opts.headers = { 'Content-Type': 'application/json', ...opts.headers };
        opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(url, opts);
    if (res.status === 401) {
        window.location.href = '/login';
        return null;
    }
    if (res.status === 403) {
        toast('Permission denied', 'error');
        return null;
    }
    if (!res.ok && res.status !== 400) {
        toast('Server error - please try again', 'error');
        return null;
    }
    try {
        return await res.json();
    } catch (err) {
        if (res.status === 400) {
            return { error: 'Request failed' };
        }
        toast('Server error - please try again', 'error');
        return null;
    }
}

// ── Tiny in-memory cache for safe-to-cache GETs ──────────────────────────────
// Keyed by URL. Each entry = { ts, data }. Default TTL 60 s. Invalidated by
// callers after mutating endpoints (see invalidateCache).
const _apiCache = new Map();
async function cachedApi(url, ttlMs = 60_000) {
    const now = Date.now();
    const hit = _apiCache.get(url);
    if (hit && (now - hit.ts) < ttlMs) return hit.data;
    const data = await api(url);
    if (data !== null && data !== undefined) {
        _apiCache.set(url, { ts: now, data });
    }
    return data;
}
function invalidateCache(prefix) {
    if (!prefix) { _apiCache.clear(); return; }
    for (const k of _apiCache.keys()) {
        if (k.startsWith(prefix)) _apiCache.delete(k);
    }
}

function toast(msg, type = 'success') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.style.background = type === 'error' ? '#dc2626' : '#1f2937';
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 2500);
}

// ── Escape key: close any open modal ──
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const overlays = [
        'modal-overlay',
        'allowance-modal-overlay',
        'bulk-export-overlay',
        'add-project-role-overlay',
        'month-filter-overlay',
        'reset-pw-overlay',
        'change-role-overlay',
    ];
    for (const id of overlays) {
        const el = document.getElementById(id);
        if (el && !el.classList.contains('hidden')) {
            el.classList.add('hidden');
            break;
        }
    }
});

// ── Auth ──
async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login';
}

function canEditMember(memberId) {
    if (!currentUser) return false;
    return isElevated() || String(currentUser.member_id) === String(memberId);
}

// ── Members ──
async function loadMembers() {
    const data = await cachedApi('/api/members');
    if (!data) return;
    members = data;
    const sel = document.getElementById('member-select');
    const val = sel.value;
    sel.innerHTML = '<option value="">Select a member...</option>';
    members.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id; opt.textContent = `${m.name} — ${m.department}`;
        sel.appendChild(opt);
    });
    if (val) sel.value = val;
}

function onMemberChange() {
    const sel = document.getElementById('member-select');
    currentMemberId = sel.value || null;   // keep as string — EmployeeID is NVARCHAR
    // when a member is explicitly selected, ensure year-select is enabled
    const ys = document.getElementById('year-select'); if (ys) ys.disabled = false;
    // hide the overall-only month selector
    const mwrap = document.getElementById('overall-month-wrap');
    if (mwrap) mwrap.style.display = 'none';
    onContextChange();
}

function onContextChange() {
    const active = document.querySelector('.tab-btn.active');
    if (!currentMemberId) {
        document.getElementById('no-member-msg').classList.add('hidden');
        document.getElementById('dashboard-content').classList.add('hidden');
        document.getElementById('overall-dashboard').classList.remove('hidden');
        // Reveal + populate the Overall month selector (idempotent)
        const mwrap = document.getElementById('overall-month-wrap');
        if (mwrap) mwrap.style.display = '';
        if (typeof populateOverallMonthSelect === 'function') populateOverallMonthSelect();
        if (!active || active.id === 'tab-dashboard') loadOverallDashboard();
        return;
    }
    document.getElementById('overall-dashboard').classList.add('hidden');
    // Hide the Overall month selector when a specific member is in scope
    const mwrap = document.getElementById('overall-month-wrap');
    if (mwrap) mwrap.style.display = 'none';
    document.getElementById('no-member-msg').classList.add('hidden');
    document.getElementById('dashboard-content').classList.remove('hidden');

    if (active && active.id === 'tab-dashboard') loadDashboard();
    else if (active && active.id === 'tab-worklog') {
        // Unhide worklog content pane that showTab('worklog') hid while no member was selected
        const noMemberEl = document.getElementById('worklog-no-member');
        const contentEl  = document.getElementById('worklog-content');
        const tableView  = document.getElementById('worklog-table-view');
        const calView    = document.getElementById('worklog-calendar-view');
        if (noMemberEl) noMemberEl.classList.add('hidden');
        if (contentEl)  contentEl.classList.remove('hidden');
        if (tableView)  tableView.classList.toggle('hidden', currentWorklogView !== 'table');
        if (calView)    calView.classList.toggle('hidden',   currentWorklogView !== 'calendar');
        loadWorklogs();
    }
    else if (active && active.id === 'tab-allowance') {
        const noMemberEl = document.getElementById('allowance-no-member');
        const contentEl  = document.getElementById('allowance-content');
        if (noMemberEl) noMemberEl.classList.add('hidden');
        if (contentEl)  contentEl.classList.remove('hidden');
        if (typeof populateAllowanceMonthSelect === 'function') populateAllowanceMonthSelect();
        if (typeof loadAllowance === 'function') loadAllowance();
    }
}

// Select the Overall view (no single member)
function selectOverall() {
    const sel = document.getElementById('member-select');
    if (sel) sel.value = '';
    currentMemberId = null;
    // disable year-select to avoid linking year to overall view
    const ys = document.getElementById('year-select'); if (ys) ys.disabled = true;
    // reveal + populate the Overall-only month selector
    const mwrap = document.getElementById('overall-month-wrap');
    if (mwrap) mwrap.style.display = '';
    if (typeof populateOverallMonthSelect === 'function') populateOverallMonthSelect();
    showTab('dashboard');
}

// Expose for inline handlers
try { window.selectOverall = selectOverall; } catch (e) {}


