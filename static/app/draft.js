// ══════════════════════════════════════════════════════
//  SQUAD DRAFT — TFT-inspired team composition planner
//  Requires globals from core.js: members, projects, currentUser, isElevated, api, esc, toast
// ══════════════════════════════════════════════════════

// ── Tier thresholds for skill synergies (sum of levels across deployed members) ──
const DRAFT_TIERS = [
    { min: 15, label: 'DIAMOND', color: '#a78bfa', glow: '#7c3aed' },
    { min: 10, label: 'GOLD',    color: '#f59e0b', glow: '#d97706' },
    { min: 6,  label: 'SILVER',  color: '#94a3b8', glow: '#64748b' },
    { min: 2,  label: 'BRONZE',  color: '#b45309', glow: '#92400e' },
    { min: 1,  label: '',        color: '#4b5563', glow: '#374151' },
];

// ── Star tier colours (total power → star count → colour) ──
const STAR_COLORS = ['#6b7280', '#22c55e', '#3b82f6', '#a855f7', '#f59e0b'];

let _draftOpen        = false;
let _draftProjectId   = null;
let _draftSkillsMap   = {};      // { memberId: [{id,name,level}] }
let _draftDeployed    = {};      // { projectId: Set<memberId> }
let _draftSlotsByProject = {};   // { projectId: [memberId|null, ...] }
const _DRAFT_STATE_KEY = 'draftState';
const FIELD_SLOT_COUNT = 28;

// Template resolution for drafting image (SVG preferred). Resolves at runtime by checking static paths.
let DRAFT_TEMPLATE_URL = '/static/drafting_template.png';
async function _resolveTemplateUrl() {
    try {
        // Prefer SVG if available
        const svgResp = await fetch('/static/drafting_template.svg', { method: 'HEAD' });
        if (svgResp && svgResp.ok) {
            DRAFT_TEMPLATE_URL = '/static/drafting_template.svg';
            return DRAFT_TEMPLATE_URL;
        }
        const pngResp = await fetch('/static/drafting_template.png', { method: 'HEAD' });
        if (pngResp && pngResp.ok) {
            DRAFT_TEMPLATE_URL = '/static/drafting_template.png';
            return DRAFT_TEMPLATE_URL;
        }
    } catch (e) {
        // network/permission error, ignore and fallback
    }
    DRAFT_TEMPLATE_URL = '';
    return DRAFT_TEMPLATE_URL;
}

// Field image (background) resolution — prefer SVG then PNG
let DRAFT_FIELD_URL = '/static/field_image.png';
async function _resolveFieldUrl() {
    try {
        const svgResp = await fetch('/static/field_image.svg', { method: 'HEAD' });
        if (svgResp && svgResp.ok) { DRAFT_FIELD_URL = '/static/field_image.svg'; return DRAFT_FIELD_URL; }
        const pngResp = await fetch('/static/field_image.png', { method: 'HEAD' });
        if (pngResp && pngResp.ok) { DRAFT_FIELD_URL = '/static/field_image.png'; return DRAFT_FIELD_URL; }
    } catch (e) {}
    DRAFT_FIELD_URL = '';
    return DRAFT_FIELD_URL;
}

// ─────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────
function _getTier(total) {
    for (const t of DRAFT_TIERS) { if (total >= t.min) return t; }
    return DRAFT_TIERS[DRAFT_TIERS.length - 1];
}

function _memberPower(mid) {
    return (_draftSkillsMap[mid] || []).reduce((s, sk) => s + (sk.level || 0), 0);
}

function _starCount(power) {
    if (power >= 21) return 5;
    if (power >= 15) return 4;
    if (power >= 10) return 3;
    if (power >= 5)  return 2;
    if (power >= 1)  return 1;
    return 0;
}

function _starColor(stars) {
    return STAR_COLORS[Math.max(0, stars - 1)] || STAR_COLORS[0];
}

function _parseNames(str) {
    if (!str) return [];
    const s = str.trim();
    if (s.startsWith('[')) { try { return JSON.parse(s).filter(Boolean); } catch (e) {} }
    return s.split('#').map(n => n.trim()).filter(Boolean);
}

function _parseMemberIds(raw) {
    const vals = _parseNames(raw);
    const ids = [];
    vals.forEach(v => {
        const n = Number(v);
        if (Number.isFinite(n)) ids.push(n);
    });
    return ids;
}

function _levelColor(level) {
    return STAR_COLORS[Math.min(level, 5) - 1] || STAR_COLORS[0];
}

function _ensureProjectSlotState(pid) {
    if (!pid) return [];
    if (!_draftSlotsByProject[pid] || !Array.isArray(_draftSlotsByProject[pid])) {
        _draftSlotsByProject[pid] = Array(FIELD_SLOT_COUNT).fill(null);
    }
    if (_draftSlotsByProject[pid].length !== FIELD_SLOT_COUNT) {
        const next = Array(FIELD_SLOT_COUNT).fill(null);
        _draftSlotsByProject[pid].forEach((mid, idx) => {
            if (idx < FIELD_SLOT_COUNT) next[idx] = mid || null;
        });
        _draftSlotsByProject[pid] = next;
    }
    return _draftSlotsByProject[pid];
}

function _syncDeployedFromSlots(pid) {
    const slots = _ensureProjectSlotState(pid);
    _draftDeployed[pid] = new Set(slots.filter(Boolean));
}

function _seedSlotsFromMemberIds(pid, memberIds) {
    const slots = _ensureProjectSlotState(pid);
    for (let i = 0; i < FIELD_SLOT_COUNT; i++) slots[i] = null;
    let cursor = 0;
    memberIds.forEach(mid => {
        if (cursor < FIELD_SLOT_COUNT) {
            slots[cursor] = Number(mid);
            cursor += 1;
        }
    });
    _syncDeployedFromSlots(pid);
}

function _removeMemberFromSlots(pid, memberId) {
    const slots = _ensureProjectSlotState(pid);
    let changed = false;
    for (let i = 0; i < slots.length; i++) {
        if (Number(slots[i]) === Number(memberId)) {
            slots[i] = null;
            changed = true;
        }
    }
    if (changed) {
        _syncDeployedFromSlots(pid);
        _saveDraftState();
    }
    return changed;
}

function _placeMemberInSlot(pid, memberId, slotIdx) {
    const slots = _ensureProjectSlotState(pid);
    if (slotIdx < 0 || slotIdx >= slots.length) return false;
    _removeMemberFromSlots(pid, memberId);
    slots[slotIdx] = Number(memberId);
    _syncDeployedFromSlots(pid);
    _saveDraftState();
    return true;
}

function _saveDraftState() {
    try {
        const slotsCopy = {};
        for (const [k, arr] of Object.entries(_draftSlotsByProject || {})) {
            slotsCopy[k] = Array.isArray(arr) ? arr.map(v => (v === null ? null : Number(v))) : null;
        }
        localStorage.setItem(_DRAFT_STATE_KEY, JSON.stringify({
            open: !!_draftOpen,
            projectId: _draftProjectId ? Number(_draftProjectId) : null,
            slots: slotsCopy,
        }));
    } catch (e) {}
}

function _canDeployDraft() {
    return typeof isElevated === 'function' && isElevated();
}

function _updateDraftActionVisibility() {
    const deployBtn = document.querySelector('.draft-save-btn');
    if (!deployBtn) return;
    deployBtn.classList.toggle('hidden', !_canDeployDraft());
}

function _loadDraftState() {
    try {
        const raw = localStorage.getItem(_DRAFT_STATE_KEY);
        if (!raw) return { open: false, projectId: null, slots: {} };
        const parsed = JSON.parse(raw);
        const slots = {};
        if (parsed && parsed.slots && typeof parsed.slots === 'object') {
            for (const [k, v] of Object.entries(parsed.slots)) {
                if (!Array.isArray(v)) continue;
                const arr = Array(FIELD_SLOT_COUNT).fill(null);
                v.forEach((val, idx) => { if (idx < FIELD_SLOT_COUNT) arr[idx] = val === null ? null : Number(val); });
                slots[k] = arr;
            }
        }
        return {
            open: !!parsed.open,
            projectId: Number.isFinite(Number(parsed.projectId)) ? Number(parsed.projectId) : null,
            slots,
        };
    } catch (e) {
        return { open: false, projectId: null, slots: {} };
    }
}

// ─────────────────────────────────────────────────────
//  Open / Close
// ─────────────────────────────────────────────────────
async function openDraftPanel() {
    // Fetch latest skills
    try {
        const res = await api('/api/skills');
        _draftSkillsMap = (res && typeof res === 'object') ? res : {};
        // Convert string keys (from JSON) to numbers
        const fixed = {};
        for (const [k, v] of Object.entries(_draftSkillsMap)) {
            fixed[parseInt(k)] = v;
        }
        _draftSkillsMap = fixed;
        // Resolve which template to use (SVG preferred) so display is crisp for vector graphics
        try { await _resolveTemplateUrl(); } catch (e) { /* ignore */ }
        // Resolve field image (background) and apply to board if present
        try { await _resolveFieldUrl(); } catch (e) { /* ignore */ }
        try {
            const board = document.getElementById('draft-board-units');
            if (board && DRAFT_FIELD_URL) {
                board.style.backgroundImage = `url('${DRAFT_FIELD_URL}')`;
                board.style.backgroundSize = 'contain';
                board.style.backgroundPosition = 'center';
                board.style.backgroundRepeat = 'no-repeat';
            }
        } catch (e) { /* ignore */ }
    } catch (e) {
        _draftSkillsMap = {};
    }

    // Build initial deployed state from saved slots or existing project assignments
    _draftDeployed = {};
    const saved = _loadDraftState();
    _draftSlotsByProject = {};
    if (saved && saved.slots) {
        for (const [k, arr] of Object.entries(saved.slots)) {
            _draftSlotsByProject[Number(k)] = Array.isArray(arr) ? arr.map(v => (v === null ? null : Number(v))) : Array(FIELD_SLOT_COUNT).fill(null);
        }
    }
    projects.forEach(p => {
        if (!_draftSlotsByProject.hasOwnProperty(p.id)) {
            const mainIds = _parseMemberIds(p.main_members);
            const knownIds = new Set(members.map(m => Number(m.id)));
            const mids = mainIds.filter(id => knownIds.has(Number(id)));
            _seedSlotsFromMemberIds(p.id, mids);
        } else {
            _ensureProjectSlotState(p.id);
            _syncDeployedFromSlots(p.id);
        }
    });

    // Default to first project ONLY if current selection is invalid
    if (!_draftProjectId || !projects.find(p => p.id === _draftProjectId)) {
        _draftProjectId = projects.length ? projects[0].id : null;
    }
    _draftOpen = true;
    _saveDraftState();

    const overlay = document.getElementById('draft-overlay');
    overlay.classList.add('draft-open');   // display:none → display:flex + fade in

    renderDraftPanel();
}

function closeDraftPanel() {
    const overlay = document.getElementById('draft-overlay');
    overlay.classList.remove('draft-open');  // display:flex → display:none (via CSS default)
    _draftOpen = false;
    _saveDraftState();
}

// ─────────────────────────────────────────────────────
//  Top-level render
// ─────────────────────────────────────────────────────
function renderDraftPanel() {
    _updateDraftActionVisibility();
    _renderTabs();
    _renderSynergies();
    _renderBoard();
    _renderRoster();
}

// ─────────────────────────────────────────────────────
//  Project tabs
// ─────────────────────────────────────────────────────
function _renderTabs() {
    const el = document.getElementById('draft-project-tabs');
    if (!el) return;
    el.innerHTML = projects.map(p => `
        <button class="draft-tab${p.id === _draftProjectId ? ' active' : ''}"
                onclick="selectDraftProject(${p.id})">
            ${esc(p.name)}
        </button>`).join('');
}

function selectDraftProject(pid) {
    _draftProjectId = pid;
    _saveDraftState();
    renderDraftPanel();
}

async function restoreDraftPanelState() {
    const st = _loadDraftState();
    if (st.projectId) _draftProjectId = st.projectId;

    if (!st.open) return;
    if (typeof isElevated === 'function' && !isElevated()) {
        _draftOpen = false;
        _saveDraftState();
        return;
    }
    await openDraftPanel();
}

// ─────────────────────────────────────────────────────
//  Left panel — Synergies
// ─────────────────────────────────────────────────────
function _renderSynergies() {
    const panel = document.getElementById('draft-synergies');
    const footer = document.getElementById('draft-team-size');
    if (!panel) return;

    const deployed = _draftDeployed[_draftProjectId] || new Set();

    // Aggregate skill levels from all deployed members
    const totals = {};
    deployed.forEach(mid => {
        (_draftSkillsMap[mid] || []).forEach(sk => {
            totals[sk.name] = (totals[sk.name] || 0) + sk.level;
        });
    });

    const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    const teamPower = [...deployed].reduce((s, mid) => s + _memberPower(mid), 0);

    if (footer) {
        footer.innerHTML = deployed.size
            ? `<span class="syn-footer-label">Team</span>
               <span class="syn-footer-val">${deployed.size} members</span>
               <span class="syn-footer-sep">·</span>
               <span class="syn-footer-val" style="color:#f59e0b">${teamPower} pts</span>`
            : `<span class="syn-footer-label opacity-40">No members deployed</span>`;
    }

    if (!entries.length) {
        panel.innerHTML = `
            <div class="synergy-empty">
                <svg class="w-10 h-10 mx-auto mb-3 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                          d="M13 10V3L4 14h7v7l9-11h-7z"/>
                </svg>
                <p>Deploy members<br>to see synergies</p>
            </div>`;
        return;
    }

    const maxTotal = entries[0][1] || 1;

    panel.innerHTML = entries.map(([name, total]) => {
        const tier  = _getTier(total);
        const pct   = Math.min(100, Math.round((total / Math.max(maxTotal, 15)) * 100));
        const stars = _starCount(total);
        return `
            <div class="synergy-row" title="${esc(name)}: ${total} pts total">
                <div class="synergy-badge" style="background:${tier.color}22;border:1px solid ${tier.color}66;color:${tier.color}">
                    ${total}
                </div>
                <div class="synergy-info">
                    <div class="synergy-name-row">
                        <span class="synergy-name">${esc(name)}</span>
                        ${tier.label ? `<span class="synergy-tier" style="color:${tier.color}">${tier.label}</span>` : ''}
                    </div>
                    <div class="synergy-bar-track">
                        <div class="synergy-bar-fill"
                             style="width:${pct}%;background:linear-gradient(90deg,${tier.glow},${tier.color});box-shadow:0 0 6px ${tier.color}90">
                        </div>
                    </div>
                </div>
            </div>`;
    }).join('');
}

// ─────────────────────────────────────────────────────
//  Center panel — Field (deployed units)
// ─────────────────────────────────────────────────────
function _renderBoard() {
    const board    = document.getElementById('draft-board-units');
    const powerBar = document.getElementById('draft-power-bar');
    const powerNum = document.getElementById('draft-power-num');
    if (!board) return;

    const deployed = _draftDeployed[_draftProjectId] || new Set();
    const slots = _ensureProjectSlotState(_draftProjectId);

    // Power bar
    const teamPower = [...deployed].reduce((s, mid) => s + _memberPower(mid), 0);
    const maxPossible = members.reduce((s, m) => s + _memberPower(m.id), 0) || 1;
    const pct = Math.min(100, Math.round((teamPower / maxPossible) * 100));
    if (powerNum) powerNum.textContent = teamPower;
    if (powerBar) {
        const col = pct > 65 ? '#f59e0b' : pct > 35 ? '#3b82f6' : '#4b5563';
        powerBar.style.width = pct + '%';
        powerBar.style.background = `linear-gradient(90deg, ${col}cc, ${col})`;
        powerBar.style.boxShadow   = `0 0 10px ${col}90`;
    }

    board.innerHTML = slots.map((mid, idx) => {
        const m = members.find(x => Number(x.id) === Number(mid));
        const row = Math.floor(idx / 7);
        const rowClass = row % 2 === 1 ? 'odd' : 'even';

        if (m) {
            return `
                <div class="draft-board-slot ${rowClass} is-filled"
                     data-slot="${idx}"
                     ondragover="allowDraftDrop(event)"
                     ondrop="onDraftSlotDrop(${idx}, event)">
                    <div class="draft-unit"
                         draggable="true"
                         ondragstart="onDraftUnitDragStart(${idx}, event)"
                         onclick="toggleDraftMember(${m.id})"
                         title="Remove ${esc(m.name)}">
                        ${_hexUnitHTML(m, true, true)}
                    </div>
                </div>`;
        }
        return `
            <div class="draft-board-slot ${rowClass} is-empty"
                 data-slot="${idx}"
                 ondragover="allowDraftDrop(event)"
                 ondrop="onDraftSlotDrop(${idx}, event)">
                <div class="draft-slot-ghost"></div>
            </div>`;
    }).join('');
}

// ─────────────────────────────────────────────────────
//  Right panel — Roster
// ─────────────────────────────────────────────────────
function _renderRoster() {
    const list    = document.getElementById('draft-roster-list');
    const counter = document.getElementById('draft-roster-count');
    if (!list) return;

    const deployed = _draftDeployed[_draftProjectId] || new Set();
    const sorted   = [...members].sort((a, b) => _memberPower(b.id) - _memberPower(a.id));

    if (counter) counter.textContent = members.length;

    list.innerHTML = sorted.map(m => {
        const isOn   = deployed.has(m.id);
        // Hex tile color comes from the member's HIGHEST individual skill level
        // (not total power, since stars/pts are no longer shown to the user)
        const allSkills = (_draftSkillsMap[m.id] || []);
        const topLevel  = allSkills.reduce((max, s) => Math.max(max, s.level || 0), 0);
        const color     = topLevel > 0 ? _levelColor(topLevel) : STAR_COLORS[0];

        return `
            <div class="roster-unit${isOn ? ' roster-unit-on' : ''}"
                 draggable="true"
                 ondragstart="onDraftRosterDragStart(${m.id}, event)"
                 onclick="toggleDraftMember(${m.id})"
                 style="--rc:${color}">
                <div class="roster-hex">
                    ${_hexUnitHTML(m, false, isOn)}
                </div>
                <div class="roster-info">
                    <div class="roster-name">${esc(m.name)}</div>
                    <div class="roster-skills">
                        ${allSkills.map(s => {
                            const c = _levelColor(s.level);
                            return `
                                <span class="roster-skill-chip" style="--chip-c:${c}">
                                    <span class="roster-skill-chip-name">${esc(s.name)}</span><span class="roster-skill-chip-lvl">${s.level}</span>
                                </span>`;
                        }).join('')}
                        ${allSkills.length === 0 ? '<span class="roster-skill-none">No skills</span>' : ''}
                    </div>
                </div>
                <div class="roster-status${isOn ? ' on' : ''}">
                    ${isOn
                        ? `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>`
                        : `<svg class="w-4 h-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>`
                    }
                </div>
            </div>`;
    }).join('');
}

// ─────────────────────────────────────────────────────
//  Hex unit HTML builder
// ─────────────────────────────────────────────────────
function _hexUnitHTML(m, large, isDeployed = false) {
    const allSkills = (_draftSkillsMap[m.id] || []).slice(0, 10);
    const skillCount = allSkills.length;
    const avatar = (m.name || '?').charAt(0).toUpperCase();
    const avatarUrl = m.avatar_url || '';

    // Skill grid columns scale with skill count to keep card width steady
    let cols = 1;
    if (skillCount <= 1) cols = 1;
    else if (skillCount <= 4) cols = 2;
    else if (skillCount <= 9) cols = 3;
    else cols = 4;

    const skillsHtml = allSkills.map(s => {
        const c = _levelColor(s.level);
        return `<div class="template-skill-chip" style="--chip-c:${c}"><span class="ts-name">${esc(s.name)}</span><span class="ts-lvl">${s.level}</span></div>`;
    }).join('');

    const avatarHtml = avatarUrl
        ? `<img src="${avatarUrl}" alt="" class="template-avatar-img" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'${avatar}',className:'template-avatar-fallback'}))">`
        : `<span class="template-avatar-fallback">${avatar}</span>`;

    if (!large) {
        // Compact roster tile — avatar only
        return `
            <div class="template-outer template-sm ${isDeployed ? 'template-deployed' : ''}">
                <div class="template-body">
                    <div class="template-avatar">${avatarHtml}</div>
                    ${isDeployed ? `<div class="template-tick">✓</div>` : ''}
                </div>
            </div>`;
    }

    // Full board card: avatar → name → skills, all in normal flow inside one container
    return `
        <div class="template-outer template-lg ${isDeployed ? 'template-deployed' : ''}">
            <div class="template-card">
                <div class="template-avatar">${avatarHtml}</div>
                <div class="template-name" title="${esc(m.name)}">${esc(m.name.split(' ')[0])}</div>
                <div class="template-skill-grid" style="grid-template-columns: repeat(${cols}, minmax(0, 1fr));">
                    ${skillsHtml || '<div class="template-no-skills">No skills</div>'}
                </div>
            </div>
        </div>`;
}

// ─────────────────────────────────────────────────────
//  Toggle deploy / undeploy
// ─────────────────────────────────────────────────────
function toggleDraftMember(mid) {
    if (!_draftProjectId) return;
    const slots = _ensureProjectSlotState(_draftProjectId);
    if ((_draftDeployed[_draftProjectId] || new Set()).has(mid)) {
        _removeMemberFromSlots(_draftProjectId, mid);
    } else {
        const idx = slots.findIndex(v => !v);
        if (idx < 0) {
            toast('Field is full', 'error');
            return;
        }
        _placeMemberInSlot(_draftProjectId, mid, idx);
    }
    _renderSynergies();
    _renderBoard();
    _renderRoster();
}

function onDraftRosterDragStart(memberId, ev) {
    if (!ev || !ev.dataTransfer) return;
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/member-id', String(memberId));
}

function onDraftUnitDragStart(slotIdx, ev) {
    if (!ev || !ev.dataTransfer || !_draftProjectId) return;
    const slots = _ensureProjectSlotState(_draftProjectId);
    const mid = slots[slotIdx];
    if (!mid) return;
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/member-id', String(mid));
    ev.dataTransfer.setData('text/from-slot', String(slotIdx));
}

function allowDraftDrop(ev) {
    if (!ev) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
}

function onDraftSlotDrop(slotIdx, ev) {
    if (!ev || !_draftProjectId) return;
    ev.preventDefault();
    const raw = ev.dataTransfer ? ev.dataTransfer.getData('text/member-id') : '';
    const memberId = Number(raw);
    if (!Number.isFinite(memberId)) return;
    _placeMemberInSlot(_draftProjectId, memberId, slotIdx);
    _renderSynergies();
    _renderBoard();
    _renderRoster();
}

// ─────────────────────────────────────────────────────
//  Save deployment → persists as project main_members
// ─────────────────────────────────────────────────────
async function saveDraftDeployment() {
    if (!_canDeployDraft()) {
        toast('Permission denied', 'error');
        return;
    }
    if (!_draftProjectId) return;
    const project = projects.find(p => p.id === _draftProjectId);
    if (!project) {
        toast('Project not found', 'error');
        return;
    }

    const btn = document.querySelector('.draft-save-btn');
    const originalHTML = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="animate-spin mr-2">⏳</span> DEPLOYING...';
    }

    try {
        const draftedIds   = [...(_draftDeployed[_draftProjectId] || new Set())];
        const draftedIdSet = new Set(draftedIds.map(Number));
        const currentIds = _parseMemberIds(project.main_members);
        const currentIdSet = new Set(currentIds.map(Number));

        const toAdd = [...draftedIdSet].filter(id => !currentIdSet.has(id));
        const toRemove = [...currentIdSet].filter(id => !draftedIdSet.has(id));

        if (!toAdd.length && !toRemove.length) {
            toast('No changes to save');
            if (btn) { btn.disabled = false; btn.innerHTML = originalHTML; }
            return;
        }

        let ok = 0, fail = 0;
        for (const memberId of toAdd) {
            const r = await api(`/api/projects/${_draftProjectId}/assign`, {
                method: 'POST', body: { member_id: memberId, type: 'main' },
            });
            if (r && r.ok) ok++; else fail++;
        }
        for (const memberId of toRemove) {
            const r = await api(`/api/projects/${_draftProjectId}/unassign`, {
                method: 'POST', body: { member_id: memberId, type: 'main' },
            });
            if (r && r.ok) ok++; else fail++;
        }

        if (fail) toast(`${fail} change(s) failed`, 'error');
        if (ok) {
            toast(`${project.name} — deployed ${draftedIds.length} member(s)`);
        }

        // Refresh project list in memory
        const fresh = await api('/api/projects');
        if (fresh) {
            window.projects = fresh;
            fresh.forEach(p => {
                const old = projects.find(x => x.id === p.id);
                if (old) Object.assign(old, p);
            });
        }

        renderDraftPanel();
        window.dispatchEvent(new Event('mwl:dashboard'));

    } catch (err) {
        console.error('Deployment failed:', err);
        toast('Deployment failed: ' + err.message, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalHTML;
        }
    }
}

// ─────────────────────────────────────────────────────
//  Show/hide DRAFT button based on role
// ─────────────────────────────────────────────────────
function _updateDraftButtonVisibility() {
    const btn = document.getElementById('btn-draft');
    if (btn) btn.classList.toggle('hidden', !isElevated());
    _updateDraftActionVisibility();
}

// Hook into existing init flow via polling (no risk of load-order issues)
(function _watchForInit() {
    const check = () => {
        if (typeof currentUser !== 'undefined' && currentUser) {
            _updateDraftButtonVisibility();
        } else {
            setTimeout(check, 300);
        }
    };
    setTimeout(check, 500);
})();

// ─────────────────────────────────────────────────────
//  Expose to global (onclick in HTML)
// ─────────────────────────────────────────────────────
try {
    window.openDraftPanel      = openDraftPanel;
    window.closeDraftPanel     = closeDraftPanel;
    window.selectDraftProject  = selectDraftProject;
    window.toggleDraftMember   = toggleDraftMember;
    window.saveDraftDeployment = saveDraftDeployment;
    window.restoreDraftPanelState = restoreDraftPanelState;
    window.onDraftRosterDragStart = onDraftRosterDragStart;
    window.onDraftUnitDragStart = onDraftUnitDragStart;
    window.allowDraftDrop = allowDraftDrop;
    window.onDraftSlotDrop = onDraftSlotDrop;
} catch (e) {}
