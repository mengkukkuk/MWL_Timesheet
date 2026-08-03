async function loadDashboard() {
    if (!currentMemberId) return;
    console.time('loadDashboard');
    const year = document.getElementById('year-select').value;
    const data = await api(`/api/dashboard?member_id=${currentMemberId}&year=${year}`);
    if (!data) {
        console.timeEnd('loadDashboard');
        return;
    }

    document.getElementById('dash-total-hours').textContent = data.total_hours;
    document.getElementById('dash-total-done').textContent = data.total_done;
    document.getElementById('dash-total-ip').textContent = data.total_in_progress;
    document.getElementById('dash-lvl').textContent = data.member.level;
    document.getElementById('dash-name').textContent = data.member.name;
    document.getElementById('dash-dept').textContent = data.member.department;
    document.getElementById('dash-empid').textContent = "ID : " + currentMemberId;
    _renderDashAvatar(currentMemberId, data.member.name, data.member.avatar_url);

    // Render skills box
    const skillsGrid = document.getElementById('dashboard-member-grid');
    if (skillsGrid) {
        if (!_skillsByMember[currentMemberId]) {
            try {
                const s = await api(`/api/members/${currentMemberId}/skills`);
                _skillsByMember[currentMemberId] = s || [];
            } catch (e) { _skillsByMember[currentMemberId] = []; }
        }
        const canEdit = isElevated() || String(currentMemberId) === String(currentUser.member_id);
        skillsGrid.innerHTML = `
            <div class="rounded-2xl p-5 text-white shadow-sm w-full" style="background:#4f46e5">
                ${_renderMemberSkillsBox(currentMemberId, canEdit, 16)}
            </div>
        `;
    }

    //Render monthly breakdown
    const tbody = document.getElementById('dash-months');
    tbody.innerHTML = '';
    data.months.forEach(m => {
        const tr = document.createElement('tr');
        tr.className = 'month-row border-b border-gray-100';
        tr.onclick = () => {
            document.getElementById('month-select').value = m.month;
            showTab('worklog');
        };
        tr.innerHTML = `
            <td class="py-2 px-3 font-medium">${t('months.full')[m.month] || m.name}</td>
            <td class="py-2 px-3 text-right">${m.total_hours}</td>
            <td class="py-2 px-3 text-right"><span class="badge badge-done">${m.done}</span></td>
            <td class="py-2 px-3 text-right">${(m.missing && m.missing > 0)
                ? `<span class="inline-flex items-center text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded px-2 py-0.5">${m.missing}</span>`
                : `<span class="text-gray-400 text-xs">0</span>`}</td>
            <td class="py-2 px-3 text-right"><span class="badge badge-manday">${m.man_day}</span></td>
            <td class="py-2 px-3 text-right text-gray-400">
                <svg class="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
                </svg>
            </td>
        `;
        tbody.appendChild(tr);
    });

    loadProjectRoles();
    console.timeEnd('loadDashboard');
}

// ── Project Roles ──
let _addProjectRoleType = null;

async function loadProjectRoles() {
    if (!currentMemberId) return;
    const canManage = isElevated() || String(currentMemberId) === String(currentUser.member_id);

    // Show/hide + buttons based on permission
    document.getElementById('btn-add-main').classList.toggle('hidden', !canManage);
    document.getElementById('btn-add-support').classList.toggle('hidden', !canManage);

    const data = await api(`/api/members/${currentMemberId}/project-roles`);
    if (!data) return;

    const renderTags = (containerId, items, type, bgStyle) => {
        const el = document.getElementById(containerId);
        el.innerHTML = items.length
            ? items.map(p => `
                <span class="inline-flex items-center gap-1 text-white text-xs font-medium px-2.5 py-1 rounded" style="background:${bgStyle}">
                    ${esc(p.name)}
                    ${canManage ? `<button onclick="removeProjectRole(${p.id},'${type}')" class="ml-1 opacity-70 hover:opacity-100 leading-none" title="Remove">×</button>` : ''}
                </span>`).join('')
            : '';
    };

    renderTags('main-project-tags',    data.main,    'main',    '#4f46e5');
    renderTags('support-project-tags', data.support, 'support', '#059669');
}

function openAddProjectModal(type) {
    _addProjectRoleType = type;
    document.getElementById('add-project-role-title').textContent =
        type === 'main' ? t('modal.add_main_project') : t('modal.add_support_project');
    const sel = document.getElementById('add-project-role-select');
    sel.innerHTML = '<option value="">— Select a project —</option>';
    projects.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        sel.appendChild(opt);
    });
    document.getElementById('add-project-role-overlay').classList.remove('hidden');
}

function closeAddProjectModal() {
    document.getElementById('add-project-role-overlay').classList.add('hidden');
    _addProjectRoleType = null;
}

async function confirmAddProjectRole() {
    const pid = document.getElementById('add-project-role-select').value;
    if (!pid) { toast(t('toast.select_project'), 'error'); return; }
    const res = await api(`/api/projects/${pid}/assign`, {
        method: 'POST',
        body: { member_id: currentMemberId, type: _addProjectRoleType }
    });
    if (res && res.ok) {
        closeAddProjectModal();
        loadProjectRoles();
        toast(t('toast.project_added'));
    }
}

async function removeProjectRole(pid, type) {
    const res = await api(`/api/projects/${pid}/unassign`, {
        method: 'POST',
        body: { member_id: currentMemberId, type }
    });
    if (res && res.ok) {
        loadProjectRoles();
        toast(t('toast.project_removed'));
    }
}

// ── Overall Dashboard ──
let _skillsByMember = {};      // { member_id: [{id,name,level}, ...] }
let _skillSortMode  = 'level'; // 'level' | 'name'

function _renderSkillBarHTML(level) {
    const lvl = Math.max(1, Math.min(5, parseInt(level) || 1));
    let segs = '';
    for (let i = 1; i <= 5; i++) {
        segs += `<span class="skill-seg ${i <= lvl ? 'on' : ''}"></span>`;
    }
    return `<span class="skill-bar" data-lvl="${lvl}" title="Level ${lvl}/5">${segs}</span>`;
}

function _sortSkills(skills) {
    const arr = [...(skills || [])];
    if (_skillSortMode === 'name') {
        arr.sort((a, b) => a.name.localeCompare(b.name));
    } else {
        arr.sort((a, b) => (b.level - a.level) || a.name.localeCompare(b.name));
    }
    return arr;
}

const SKILL_PREVIEW_COUNT = 3;

function _renderMemberSkillsBox(memberId, canEdit, limit = SKILL_PREVIEW_COUNT) {
    const skills = _sortSkills(_skillsByMember[memberId] || []);
    const visible  = skills.slice(0, limit);
    const overflow = skills.length - visible.length;
    const maxLen = skills.reduce((m, s) => Math.max(m, Math.min(15, s.name.length)), 4);

    const editBtn = canEdit
        ? `<button class="skill-action-btn" onclick="event.stopPropagation(); openSkillsManager(${memberId})" title="Manage skills">
               <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                   <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
               </svg>
           </button>`
        : '';

    const sortBtn = skills.length > 1
        ? `<button class="skill-action-btn" onclick="event.stopPropagation(); toggleSkillSort()" title="Sort: ${_skillSortMode === 'level' ? 'by level' : 'by name'}">
               <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                   <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                         d="${_skillSortMode === 'level' ? 'M3 4h13M3 8h9M3 12h5M13 16l3-3m0 0l3 3m-3-3v8' : 'M3 7h18M6 12h12M9 17h6'}"/>
               </svg>
           </button>`
        : '';

    const rows = visible.length
        ? visible.map(s => `
            <div class="skill-row">
                <span class="skill-name">${esc(s.name)}</span>
                ${_renderSkillBarHTML(s.level)}
            </div>`).join('')
        : `<div class="skill-empty">${canEdit ? 'No skills yet — click ✎ to add' : 'No skills yet'}</div>`;

    const more = overflow > 0
        ? `<div class="skill-more">+${overflow} more</div>`
        : '';

    const listClass = limit > SKILL_PREVIEW_COUNT ? 'skill-list-matrix' : 'skill-list';

    return `
        <div class="member-skills-box" style="--skill-name-w:${maxLen}ch">
            <div class="member-skills-head">
                <span class="skill-title">Skills</span>
                <span class="flex items-center gap-1">${sortBtn}${editBtn}</span>
            </div>
            <div class="${listClass}">${rows}${more}</div>
        </div>
    `;
}

async function loadOverallDashboard() {
    // Resolve year + month for the missing-entry per-card badge
    const yrEl = document.getElementById('year-select');
    const moEl = document.getElementById('overall-month-select');
    const yr = (yrEl && yrEl.value) ? parseInt(yrEl.value) : new Date().getFullYear();
    const mo = (moEl && moEl.value) ? parseInt(moEl.value) : (new Date().getMonth() + 1);

    // Fetch skills and missing-entry map in parallel
    let _missingMap = {};
    try {
        const [skills, missing] = await Promise.all([
            api('/api/skills'),
            api(`/api/dashboard/missing?year=${yr}&month=${mo}`),
        ]);
        _skillsByMember = skills && typeof skills === 'object' ? skills : {};
        _missingMap = (missing && typeof missing === 'object' && !Array.isArray(missing)) ? missing : {};
    } catch (e) {
        _skillsByMember = {};
        _missingMap = {};
    }

    // Build member→projects map from the already-loaded projects array (no extra API calls)
    const memberProjects = {};
    members.forEach(m => { memberProjects[m.id] = { main: [], support: [] }; });

    projects.forEach(p => {
        const parseProjectMembers = (str) => {
            if (!str) return [];
            const s = str.trim();
            if (s.startsWith('[')) { try { return JSON.parse(s).filter(n => n); } catch (e) {} }
            return s.split('#').map(n => n.trim()).filter(n => n);
        };
        const hasMember = (items, member) => items.some(item => {
            const numericId = Number(item);
            if (Number.isFinite(numericId) && numericId === Number(member.id)) return true;
            return String(item).trim() === member.name;
        });
        const mainMembers = parseProjectMembers(p.main_members);
        const suppMembers = parseProjectMembers(p.support_members);
        members.forEach(m => {
            if (hasMember(mainMembers, m)) memberProjects[m.id].main.push(p.name);
            if (hasMember(suppMembers, m)) memberProjects[m.id].support.push(p.name);
        });
    });

    const countEl = document.getElementById('overall-member-count');
    if (countEl) countEl.textContent = t('dash.members_count', members.length);

    const grid = document.getElementById('overall-member-grid');
    grid.innerHTML = '';

    members.forEach(m => {
        const roles = memberProjects[m.id];
        const hasProjects = roles.main.length > 0 || roles.support.length > 0;

        const card = document.createElement('div');
        card.className = 'rounded-2xl p-5 text-white text-center cursor-pointer transition-all duration-150 hover:scale-105 hover:shadow-lg select-none';
        card.style.background = hasProjects ? '#4f46e5' : '#9ca3af';

        const mainText = roles.main.length ? esc(roles.main.join(', ')) : '<span class="opacity-50">—</span>';
        const suppText = roles.support.length ? esc(roles.support.join(', ')) : '<span class="opacity-50">—</span>';

        const canEditThis = isElevated() || (currentUser && String(currentUser.member_id) === String(m.id));
        const canEditAvatar = canEditAvatarFor(m.id);
        const skillsHTML = _renderMemberSkillsBox(m.id, canEditThis);
        const avatarHTML = _renderGridAvatar(m, canEditAvatar);

        // Per-card "Missing N days" badge (hidden if 0 or no row in map)
        const eidKey = String(m.staff_id || '');
        const missCount = (_missingMap && _missingMap[eidKey]) ? Number(_missingMap[eidKey]) : 0;
        const missingLabel = (typeof t === 'function')
            ? t('dash.missing_n_days', missCount)
            : `Missing ${missCount} day${missCount !== 1 ? 's' : ''}`;
        const missingHTML = missCount > 0 ? `
            <div class="mt-2 flex justify-center">
                <span class="inline-flex items-center gap-1 text-[10px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded px-2 py-0.5">
                    <svg class="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                    </svg>
                    ${esc(missingLabel)}
                </span>
            </div>` : '';

        card.innerHTML = `
            ${avatarHTML}
            <div class="font-semibold text-sm leading-tight mb-1">${esc(m.name)}</div>
            <div class="text-xs opacity-80 mb-0.5">ID : ${esc(m.staff_id || '—')}</div>
            <div class="text-xs opacity-80 mb-3">Position : ${esc(m.position || '—')}</div>
            <div class="text-left rounded-xl p-2.5 text-xs space-y-1" style="background:rgba(0,0,0,0.15)">
                <div class="flex gap-1"><span class="opacity-70 shrink-0">Main :</span><span class="font-medium truncate">${mainText}</span></div>
                <div class="flex gap-1"><span class="opacity-70 shrink-0">Support :</span><span class="font-medium truncate">${suppText}</span></div>
            </div>
            ${skillsHTML}
            ${missingHTML}
        `;

        card.onclick = () => {
            document.getElementById('member-select').value = m.id;
            currentMemberId = m.id;
            onContextChange();
        };

        grid.appendChild(card);
    });
}

//Overall Dashboard prev and next month
//Prev month is the month before the current month
//Next month is the current month
//If the current month is January, the prev month is December of the previous year
//If the current month is December, the next month is January of the next year



function toggleSkillSort() {
    _skillSortMode = (_skillSortMode === 'level') ? 'name' : 'level';
    if (currentMemberId) {
        loadDashboard();
    }
    loadOverallDashboard();
}

// ── Skills Manager Modal ──
let _skillsEditMemberId = null;
let _skillsEditDraft = [];   // [{id?, name, level, _new?, _deleted?, _dirty?}]

function openSkillsManager(memberId) {
    _skillsEditMemberId = memberId;
    _skillsEditDraft = (_skillsByMember[memberId] || []).map(s => ({
        id: s.id, name: s.name, level: s.level,
    }));
    const member = members.find(m => m.id === memberId);
    const titleEl = document.getElementById('skills-modal-title');
    if (titleEl) titleEl.textContent = `Skills — ${member ? member.name : ''}`;
    renderSkillsEditor();
    document.getElementById('skills-modal-overlay').classList.remove('hidden');
}

function closeSkillsManager() {
    document.getElementById('skills-modal-overlay').classList.add('hidden');
    _skillsEditMemberId = null;
    _skillsEditDraft = [];
}

function renderSkillsEditor() {
    const list = document.getElementById('skills-editor-list');
    if (!list) return;
    const sorted = (() => {
        const arr = _skillsEditDraft.filter(s => !s._deleted);
        if (_skillSortMode === 'name') {
            return [...arr].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        }
        return [...arr].sort((a, b) => (b.level - a.level) || (a.name || '').localeCompare(b.name || ''));
    })();

    // New (unsaved) rows always render at the bottom, outside the sort.
    const newRows   = _skillsEditDraft.filter(s => s._new && !s._deleted);
    const sortedOld = sorted.filter(s => !s._new);

    if (sortedOld.length === 0 && newRows.length === 0) {
        list.innerHTML = `<div class="text-sm text-gray-400 italic text-center py-6">No skills yet — add one below.</div>`;
        return;
    }

    list.innerHTML = [...sortedOld, ...newRows].map(s => {
        const idx = _skillsEditDraft.indexOf(s);
        let segs = '';
        for (let i = 1; i <= 5; i++) {
            segs += `<span class="skill-seg ${i <= s.level ? 'on' : ''}" data-lvl-set="${i}" data-row="${idx}"></span>`;
        }
        return `
            <div class="skill-edit-row">
                <input type="text" class="skill-name-input" data-row="${idx}" maxlength="120"
                       placeholder="Skill name" value="${esc(s.name || '')}">
                <span class="skill-bar skill-bar-edit" data-lvl="${s.level}">${segs}</span>
                <span class="skill-level-num">${s.level}/5</span>
                <button class="skill-del-btn" data-row="${idx}" title="Delete">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                    </svg>
                </button>
            </div>`;
    }).join('');

    // Wire interactions
    list.querySelectorAll('.skill-name-input').forEach(inp => {
        inp.addEventListener('input', (ev) => {
            const i = parseInt(ev.target.dataset.row);
            if (_skillsEditDraft[i]) {
                _skillsEditDraft[i].name = ev.target.value;
                _skillsEditDraft[i]._dirty = true;
            }
        });
    });
    list.querySelectorAll('.skill-seg[data-lvl-set]').forEach(seg => {
        seg.addEventListener('click', (ev) => {
            const i = parseInt(ev.currentTarget.dataset.row);
            const v = parseInt(ev.currentTarget.dataset.lvlSet);
            if (_skillsEditDraft[i]) {
                _skillsEditDraft[i].level = v;
                _skillsEditDraft[i]._dirty = true;
                renderSkillsEditor();
            }
        });
    });
    list.querySelectorAll('.skill-del-btn').forEach(btn => {
        btn.addEventListener('click', (ev) => {
            const i = parseInt(ev.currentTarget.dataset.row);
            if (_skillsEditDraft[i]) {
                _skillsEditDraft[i]._deleted = true;
                renderSkillsEditor();
            }
        });
    });
}

function addSkillRow() {
    _skillsEditDraft.push({ name: '', level: 3, _new: true, _dirty: true });
    renderSkillsEditor();
    // Focus the newly added input
    setTimeout(() => {
        const inputs = document.querySelectorAll('#skills-editor-list .skill-name-input');
        if (inputs.length) inputs[inputs.length - 1].focus();
    }, 0);
}

function setSkillsModalSort(mode) {
    _skillSortMode = mode;
    document.getElementById('skills-sort-level').classList.toggle('active', mode === 'level');
    document.getElementById('skills-sort-name').classList.toggle('active', mode === 'name');
    renderSkillsEditor();
}

async function saveSkillsManager() {
    const mid = _skillsEditMemberId;
    if (!mid) return;

    // Validate: no empty names, no duplicate names
    const seen = new Set();
    for (const s of _skillsEditDraft) {
        if (s._deleted) continue;
        const nm = (s.name || '').trim();
        if (!nm) { toast('Skill name is required', 'error'); return; }
        const key = nm.toLowerCase();
        if (seen.has(key)) { toast(`Duplicate skill: ${nm}`, 'error'); return; }
        seen.add(key);
        if (s.level < 1 || s.level > 5) { toast('Level must be 1–5', 'error'); return; }
    }

    let ok = 0, fail = 0;
    for (const s of _skillsEditDraft) {
        try {
            if (s._deleted && s.id) {
                const r = await api(`/api/skills/${s.id}`, { method: 'DELETE' });
                if (r && r.ok) ok++; else fail++;
            } else if (s._new && !s._deleted) {
                const r = await api(`/api/members/${mid}/skills`, {
                    method: 'POST',
                    body: { name: s.name.trim(), level: s.level },
                });
                if (r && r.id) ok++; else fail++;
            } else if (s.id && s._dirty && !s._deleted) {
                const r = await api(`/api/skills/${s.id}`, {
                    method: 'PUT',
                    body: { name: s.name.trim(), level: s.level },
                });
                if (r && r.id) ok++; else fail++;
            }
        } catch (e) { fail++; }
    }

    if (fail) toast(`${fail} skill change${fail === 1 ? '' : 's'} failed`, 'error');
    if (ok)   toast(`Saved ${ok} skill change${ok === 1 ? '' : 's'}`);

    closeSkillsManager();
    if (currentMemberId) {
        await loadDashboard();
    }
    await loadOverallDashboard();
}

// Expose to inline onclick handlers
try {
    window.openSkillsManager   = openSkillsManager;
    window.closeSkillsManager  = closeSkillsManager;
    window.addSkillRow         = addSkillRow;
    window.saveSkillsManager   = saveSkillsManager;
    window.toggleSkillSort     = toggleSkillSort;
    window.setSkillsModalSort  = setSkillsModalSort;
} catch (e) {}

// ── Profile avatars ─────────────────────────────────────────────────────────
// PDPA: only the employee themselves OR mengkukkuk (Super_Ultimate_ADMIN) may
// upload/replace/delete their photo. Leader/Admin can see, but not edit.
function canEditAvatarFor(employeeId) {
    if (!currentUser) return false;
    if (currentUser.role === 'Super_Ultimate_ADMIN') return true;
    return String(currentUser.member_id) === String(employeeId);
}

function _avatarFallbackChar(name) {
    return ((name || '?').trim().charAt(0) || '?').toUpperCase();
}

function _renderGridAvatar(m, canEdit) {
    const fallback = _avatarFallbackChar(m.name);
    const editable = canEdit ? 'avatar-editable' : '';
    const title    = canEdit ? 'title="Click to change photo"' : '';
    const onclick  = canEdit
        ? `onclick="event.stopPropagation(); pickAvatar(${m.id})"`
        : '';
    const removeBtn = (canEdit && m.avatar_url)
        ? `<button type="button" class="avatar-remove" title="Remove photo" aria-label="Remove photo" onclick="event.stopPropagation(); removeAvatar(${m.id})">&times;</button>`
        : '';
    if (m.avatar_url) {
        return `
            <div class="avatar-wrap avatar-grid ${editable}" ${title} ${onclick}>
                <img src="${m.avatar_url}" alt="" class="avatar-img" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'${fallback}',className:'avatar-letter'}))">
                ${removeBtn}
            </div>`;
    }
    return `
        <div class="avatar-wrap avatar-grid avatar-fallback ${editable}" ${title} ${onclick}
             style="background:rgba(255,255,255,0.2)">
            <span class="avatar-letter">${fallback}</span>
        </div>`;
}

function _renderDashAvatar(memberId, name, avatarUrl) {
    const wrap = document.getElementById('dash-avatar-wrap');
    if (!wrap) return;
    const canEdit  = canEditAvatarFor(memberId);
    const fallback = _avatarFallbackChar(name);
    wrap.classList.toggle('avatar-editable', canEdit);
    wrap.title = canEdit ? 'Click to change photo' : '';
    wrap.onclick = canEdit ? () => pickAvatar(memberId) : null;
    const removeBtn = (canEdit && avatarUrl)
        ? `<button type="button" class="avatar-remove" title="Remove photo" aria-label="Remove photo" onclick="event.stopPropagation(); removeAvatar(${memberId})">&times;</button>`
        : '';
    if (avatarUrl) {
        wrap.innerHTML = `<img src="${avatarUrl}" alt="" class="avatar-img" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'${fallback}',className:'avatar-letter text-indigo-600'}))">${removeBtn}`;
    } else {
        wrap.innerHTML = `<span id="dash-avatar" class="avatar-letter text-indigo-600">${fallback}</span>`;
    }
}

function pickAvatar(employeeId) {
    if (!canEditAvatarFor(employeeId)) {
        toast('You can only edit your own profile photo', 'error');
        return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
            toast('Image must be 2 MB or smaller', 'error');
            return;
        }
        const fd = new FormData();
        fd.append('file', file);
        try {
            const res = await fetch(`/api/avatars/${employeeId}`, {
                method: 'POST', body: fd, credentials: 'same-origin',
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                toast(data.error || 'Upload failed', 'error');
                return;
            }
            toast('Profile photo updated', 'success');
            // Refresh both views — the cache-busted URL the API returns
            // is captured by reloading members + dashboard from source.
            if (typeof loadMembers === 'function') await loadMembers();
            if (currentMemberId == employeeId && typeof loadDashboard === 'function') {
                await loadDashboard();
            }
            if (typeof loadOverallDashboard === 'function') await loadOverallDashboard();
        } catch (e) {
            toast('Upload failed: ' + e.message, 'error');
        }
    };
    input.click();
}

async function removeAvatar(employeeId) {
    if (!canEditAvatarFor(employeeId)) {
        toast('You can only edit your own profile photo', 'error');
        return;
    }
    if (!confirm('Remove your profile photo?')) return;
    try {
        const res = await fetch(`/api/avatars/${employeeId}`, {
            method: 'DELETE', credentials: 'same-origin',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            toast(data.error || 'Remove failed', 'error');
            return;
        }
        toast('Profile photo removed', 'success');
        if (typeof loadMembers === 'function') await loadMembers();
        if (currentMemberId == employeeId && typeof loadDashboard === 'function') {
            await loadDashboard();
        }
        if (typeof loadOverallDashboard === 'function') await loadOverallDashboard();
    } catch (e) {
        toast('Remove failed: ' + e.message, 'error');
    }
}

try {
    window.canEditAvatarFor = canEditAvatarFor;
    window.pickAvatar        = pickAvatar;
    window.removeAvatar      = removeAvatar;
} catch (e) {}

// ── Worklogs ──
