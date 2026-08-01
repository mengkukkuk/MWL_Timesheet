// File Share module — folder tree + uploads/downloads
// Depends on: api(), toast(), esc(), isElevated(), currentUser (from core.js)

let fileCurrentFolderId = null;   // null = root
let fileTreeCache = [];
let fileDragDepth = 0;
let fileListCache = [];           // current folder's files, for lookup by id
let fileSelectedIds = new Set();  // ids of selected files (cleared on folder change)
let fileSearchTerm = '';          // case-insensitive substring filter
let fileSortKey = 'name';         // 'name' | 'size' | 'date' | 'uploader'
let fileSortDir = 'asc';          // 'asc' | 'desc'
let fileSearchDebounce = null;
let fileTreeCollapsed = new Set();  // folder ids currently collapsed in the sidebar tree
try {
    fileTreeCollapsed = new Set(JSON.parse(localStorage.getItem('mwl_files_collapsed') || '[]'));
} catch (e) { fileTreeCollapsed = new Set(); }

function fmtBytes(n) {
    if (n == null) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

function fmtDateShort(iso) {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
    } catch (e) { return iso; }
}

// ── Tree ──
async function loadFileTree() {
    const tree = await api('/api/files/tree');
    if (!tree) return;
    fileTreeCache = tree;
    expandAncestors(fileCurrentFolderId);
    renderFileTree();
    loadFolderContents(fileCurrentFolderId);
    loadFileStats();
    loadFolderStats();
}

async function loadFileStats() {
    const host = document.getElementById('file-stats-bar');
    const meta = document.getElementById('file-usage-meta');
    const bar  = document.getElementById('file-usage-bar');
    const warn = document.getElementById('file-usage-warning');
    if (!host) return;
    const s = await api('/api/files/stats');
    if (!s) { host.innerHTML = ''; if (meta) meta.innerHTML = ''; return; }

    host.innerHTML = `
        <span class="inline-flex items-center gap-1">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17v-2a4 4 0 014-4h4m-9-6h10M5 11h2m-2-6h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z"/></svg>
            ${s.file_count} file${s.file_count === 1 ? '' : 's'}
        </span>
        <span class="mx-1">·</span>
        <span>${s.folder_count} folder${s.folder_count === 1 ? '' : 's'}</span>
    `;

    const capPct = s.cap_bytes > 0 ? Math.min(100, (s.used_bytes / s.cap_bytes) * 100) : 0;
    if (meta) {
        meta.innerHTML = `
            <span>${fmtBytes(s.used_bytes)} <span class="text-gray-400">of</span> ${fmtBytes(s.cap_bytes)} cap</span>
        `;
    }
    if (bar) {
        bar.style.width = capPct.toFixed(1) + '%';
        bar.classList.remove('bg-indigo-500', 'bg-amber-500', 'bg-red-500');
        if      (capPct >= 95) bar.classList.add('bg-red-500');
        else if (capPct >= 80) bar.classList.add('bg-amber-500');
        else                   bar.classList.add('bg-indigo-500');
    }
    if (warn) {
        const messages = [];
        if (s.cap_bytes && s.used_bytes >= s.cap_bytes) {
            messages.push(`Storage cap reached — uploads blocked until files are deleted.`);
        } else if (capPct >= 90) {
            messages.push(`Storage ${capPct.toFixed(0)}% full — consider deleting old files.`);
        }
        if (s.free_disk_bytes > 0 && s.free_disk_bytes < s.min_free_bytes) {
            messages.push(`Server disk low: only ${fmtBytes(s.free_disk_bytes)} free.`);
        }
        if (messages.length) {
            warn.textContent = messages.join(' ');
            warn.classList.remove('hidden');
        } else {
            warn.textContent = '';
            warn.classList.add('hidden');
        }
    }
}

function updateUploadDestination() {
    const el = document.getElementById('file-upload-dest');
    if (!el) return;
    if (fileCurrentFolderId == null) { el.textContent = 'Root'; return; }
    const name = findFolderName(fileCurrentFolderId);
    el.textContent = name || `Folder #${fileCurrentFolderId}`;
}

function renderFileTree() {
    const host = document.getElementById('file-tree');
    if (!host) return;

    let html = `<div class="folder-tree-node ${fileCurrentFolderId === null ? 'active' : ''}"
                     data-folder-id="root" onclick="selectFolder(null)">
                    <svg class="w-4 h-4 inline-block -mt-0.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
                    </svg>
                    <span class="ml-1">Root</span>
                </div>`;
    html += renderTreeNodes(fileTreeCache, 1);
    host.innerHTML = html;
}

function renderTreeNodes(nodes, depth) {
    if (!nodes || !nodes.length) return '';
    return nodes.map(n => {
        const isActive = fileCurrentFolderId === n.id;
        const pad = 8 + depth * 12;
        const canManage = isElevated();
        const hasChildren = !!(n.children && n.children.length);
        const collapsed = hasChildren && fileTreeCollapsed.has(n.id);
        const toggle = hasChildren ? `
            <button type="button" onclick="event.stopPropagation(); toggleFolderCollapse(${n.id})"
                    class="folder-tree-toggle inline-flex items-center justify-center w-4 h-4 -mt-0.5 text-gray-400 hover:text-gray-600 flex-shrink-0"
                    title="${collapsed ? esc(t('files.expand') || 'Expand') : esc(t('files.collapse') || 'Collapse')}">
                <svg class="w-3 h-3 transition-transform duration-150 ${collapsed ? '' : 'rotate-90'}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7"/>
                </svg>
            </button>` : `<span class="inline-block w-4 h-4 flex-shrink-0"></span>`;
        return `
        <div class="folder-tree-node ${isActive ? 'active' : ''}" style="padding-left:${pad}px"
             data-folder-id="${n.id}" onclick="if (!event.target.closest('[data-folder-menu]')) selectFolder(${n.id})"
             ${canManage ? `draggable="true" ondragstart="onFolderDragStart(event, ${n.id})" ondragend="onFileDragEnd(event)"` : ''}>
            ${toggle}
            <svg class="w-4 h-4 inline-block -mt-0.5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
            </svg>
            <span class="ml-1">${esc(n.name)}</span>
            ${n.is_classified ? `<span class="ml-1 text-amber-500" title="${esc(t('files.classified'))}">&#128274;</span>` : ''}
            ${canManage ? `
                <button type="button" data-folder-menu="${n.id}"
                        class="folder-tree-menu-btn float-right" title="More actions"
                        aria-label="More actions" aria-haspopup="menu" aria-expanded="false">&#8943;</button>
            ` : ''}
        </div>
        ${collapsed ? '' : renderTreeNodes(n.children, depth + 1)}`;
    }).join('');
}

function toggleFolderCollapse(fid) {
    if (fileTreeCollapsed.has(fid)) fileTreeCollapsed.delete(fid);
    else fileTreeCollapsed.add(fid);
    try {
        localStorage.setItem('mwl_files_collapsed', JSON.stringify([...fileTreeCollapsed]));
    } catch (e) { /* localStorage unavailable — collapse state just won't persist */ }
    renderFileTree();
}

// Returns the array of ancestor folder ids leading to fid (not including fid itself), or null if not found.
function _findFolderPath(fid, nodes, path) {
    for (const n of (nodes || [])) {
        if (n.id === fid) return path;
        const found = _findFolderPath(fid, n.children, [...path, n.id]);
        if (found) return found;
    }
    return null;
}

// Expands every ancestor of fid so the selected folder stays visible in the tree.
function expandAncestors(fid) {
    if (fid == null) return;
    const ancestors = _findFolderPath(fid, fileTreeCache, []);
    if (!ancestors || !ancestors.length) return;
    let changed = false;
    ancestors.forEach(id => {
        if (fileTreeCollapsed.delete(id)) changed = true;
    });
    if (changed) {
        try {
            localStorage.setItem('mwl_files_collapsed', JSON.stringify([...fileTreeCollapsed]));
        } catch (e) { /* localStorage unavailable */ }
    }
}

function selectFolder(fid) {
    fileCurrentFolderId = fid;
    clearFileSelection();
    fileSearchTerm = '';
    const search = document.getElementById('file-search');
    if (search) search.value = '';
    expandAncestors(fid);
    renderFileTree();
    updateUploadDestination();
    loadFolderContents(fid);
    loadFolderStats();
}

// ── Contents pane ──
async function loadFolderContents(fid) {
    const url = fid == null ? '/api/files/folder' : `/api/files/folder/${fid}`;
    const data = await api(url);
    if (!data) return;

    renderBreadcrumbs(data.breadcrumbs || []);
    renderSubfolders(data.folders || []);
    renderFiles(data.files || []);
}

function renderBreadcrumbs(crumbs) {
    const host = document.getElementById('file-breadcrumbs');
    if (!host) return;
    let html = `<a onclick="selectFolder(null)" class="cursor-pointer hover:text-indigo-600">Root</a>`;
    crumbs.forEach(c => {
        html += ` <span class="text-gray-300">/</span> `;
        html += `<a onclick="selectFolder(${c.id})" class="cursor-pointer hover:text-indigo-600">${esc(c.name)}</a>`;
    });
    host.innerHTML = html;
}

function renderSubfolders(folders) {
    const wrap = document.getElementById('file-subfolders-wrap');
    const host = document.getElementById('file-subfolders');
    if (!host || !wrap) return;
    if (!folders.length) { wrap.classList.add('hidden'); host.innerHTML = ''; return; }
    wrap.classList.remove('hidden');
    const canManage = isElevated();
    host.innerHTML = folders.map(f => `
        <div onclick="if (!event.target.closest('[data-folder-menu]')) selectFolder(${f.id})" data-folder-id="${f.id}"
             ${canManage ? `draggable="true" ondragstart="onFolderDragStart(event, ${f.id})" ondragend="onFileDragEnd(event)"` : ''}
             class="subfolder-card flex items-center gap-2 p-2 border border-gray-200 rounded-md cursor-pointer hover:bg-indigo-50 hover:border-indigo-300 transition-colors">
            <svg class="w-5 h-5 text-indigo-500 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                <path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z"/>
            </svg>
            <span class="text-sm text-gray-700 truncate">${esc(f.name)}</span>
            ${canManage ? `<button type="button" class="subfolder-menu-btn ml-auto flex-shrink-0"
                    data-folder-menu="${f.id}" title="More actions" aria-label="More actions"
                    aria-haspopup="menu" aria-expanded="false">&#8943;</button>` : ''}
        </div>
    `).join('');
}

function renderFiles(files) {
    fileListCache = files || [];
    _renderFileList();
    _updateBulkBar();
    _updateSortIndicators();
}

function _isImageMime(mime) {
    return typeof mime === 'string' && mime.startsWith('image/');
}

// Lightweight, dependency-free check used at row-render time to decide whether
// to show the Preview affordance. Kept in sync with the heavier `_documentKind()`
// in file-preview.js, which is only loaded once a preview is actually opened.
const _PREVIEWABLE_DOC_EXTS = new Set(['pdf', 'docx', 'xlsx', 'xls', 'pptx',
    'txt', 'log', 'md', 'markdown', 'csv', 'json', 'ini', 'conf', 'yaml', 'yml', 'xml']);

function _isPreviewableDoc(mime, name) {
    const parts = (name || '').split('.');
    const ext = parts.length > 1 ? parts.pop().toLowerCase() : '';
    if (mime === 'application/pdf' || mime === 'application/vnd.ms-excel') return true;
    if (typeof mime === 'string' && mime.startsWith('text/')) return true;
    return _PREVIEWABLE_DOC_EXTS.has(ext);
}

function _applyFilterSort(files) {
    let out = files.slice();
    if (fileSearchTerm) {
        const q = fileSearchTerm.toLowerCase();
        out = out.filter(f => (f.original_name || '').toLowerCase().includes(q));
    }
    const dir = fileSortDir === 'asc' ? 1 : -1;
    out.sort((a, b) => {
        let av, bv;
        switch (fileSortKey) {
            case 'size':     av = a.size_bytes || 0; bv = b.size_bytes || 0; break;
            case 'date':     av = a.uploaded_at || ''; bv = b.uploaded_at || ''; break;
            case 'uploader': av = (a.uploaded_by_name || '').toLowerCase();
                             bv = (b.uploaded_by_name || '').toLowerCase(); break;
            default:         av = (a.original_name  || '').toLowerCase();
                             bv = (b.original_name  || '').toLowerCase();
        }
        if (av < bv) return -1 * dir;
        if (av > bv) return  1 * dir;
        return 0;
    });
    return out;
}

function _renderFileList() {
    const host = document.getElementById('file-list');
    const empty = document.getElementById('file-empty-msg');
    if (!host) return;
    const visible = _applyFilterSort(fileListCache);
    if (!visible.length) {
        host.innerHTML = '';
        if (empty) {
            empty.classList.remove('hidden');
            empty.textContent = fileSearchTerm
                ? `No files match "${fileSearchTerm}".`
                : 'No files here yet. Drop files anywhere in this panel to upload.';
        }
        return;
    }
    if (empty) empty.classList.add('hidden');
    host.innerHTML = visible.map(f => {
        const canDelete = isElevated() || (currentUser && currentUser.id === f.uploaded_by);
        const canMove   = isElevated() || (currentUser && currentUser.id === f.uploaded_by);
        const canManage = isElevated();
        const isImg     = _isImageMime(f.mime_type);
        const isDoc     = !isImg && _isPreviewableDoc(f.mime_type, f.original_name);
        const canPreview = isImg || isDoc;
        const isSelected = fileSelectedIds.has(f.id);
        return `
        <div class="file-row ${isSelected ? 'selected' : ''}" data-file-id="${f.id}"
             ${canMove ? `draggable="true" ondragstart="onFileDragStart(event, ${f.id})" ondragend="onFileDragEnd(event)"` : ''}>
            <div class="file-row-checkbox">
                <input type="checkbox" data-file-cb="${f.id}" ${isSelected ? 'checked' : ''}
                       onclick="onFileCheckboxToggle(event, ${f.id})">
            </div>
            <div class="file-row-name">
                ${isImg
                    ? `<img class="file-row-thumb" src="/api/files/${f.id}/download?inline=1" alt="" loading="lazy" onclick="openFilePreview(${f.id})">`
                    : `<svg class="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                       </svg>`}
                <span class="file-row-name-text" title="${esc(f.original_name)}"
                      ${canPreview ? `onclick="openFilePreview(${f.id})"` : `onclick="window.location='/api/files/${f.id}/download'"`}
                      >${esc(f.original_name)}</span>
                ${f.is_classified ? `<span class="ml-1 text-amber-500 flex-shrink-0" title="${esc(t('files.classified'))}">&#128274;</span>` : ''}
                <button type="button" class="file-row-menu-btn" data-file-menu="${f.id}"
                        title="More actions" aria-label="More actions"
                        aria-haspopup="menu" aria-expanded="false">&#8943;</button>
            </div>
            <div class="file-row-size">${fmtBytes(f.size_bytes)}</div>
            <div class="file-row-uploader">${esc(f.uploaded_by_name || '')}</div>
            <div class="file-row-date">${fmtDateShort(f.uploaded_at)}</div>
        </div>`;
    }).join('');
}

// ── Overflow action menu ──
// One popover element, reused by every file row and subfolder card, mounted on
// <body> so it escapes .file-row-name's overflow:hidden. Opens on click (not
// hover) so it works on touch, where .file-row-actions used to be force-shown.
let _openMenuBtn = null;

const _MENU_ICONS = {
    preview:  '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>',
    download: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3"/>',
    move:     '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>',
    edit:     '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>',
    open:     '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>',
    trash:    '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a2 2 0 012-2h2a2 2 0 012 2v3"/>',
};

function _menuIcon(key) {
    return `<svg class="action-menu-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">${_MENU_ICONS[key] || ''}</svg>`;
}

function _ensureActionMenu() {
    let menu = document.getElementById('file-action-menu');
    if (menu) return menu;
    menu = document.createElement('div');
    menu.id = 'file-action-menu';
    menu.className = 'action-menu hidden';
    menu.setAttribute('role', 'menu');
    document.body.appendChild(menu);
    return menu;
}

function closeActionMenu() {
    const menu = document.getElementById('file-action-menu');
    if (menu) { menu.classList.add('hidden'); menu.innerHTML = ''; menu._items = null; }
    if (_openMenuBtn) {
        _openMenuBtn.setAttribute('aria-expanded', 'false');
        _openMenuBtn = null;
    }
}

function _openActionMenu(btn, items) {
    const menu = _ensureActionMenu();
    menu.innerHTML = items.map((it, i) => it.sep
        ? '<div class="action-menu-sep" role="separator"></div>'
        : `<button type="button" role="menuitem" data-menu-idx="${i}"
                   class="action-menu-item${it.danger ? ' danger' : ''}">
               ${_menuIcon(it.icon)}<span>${esc(it.label)}</span>
           </button>`).join('');
    menu._items = items;
    menu.classList.remove('hidden');

    // Anchor beside the selected row/node (not just the small "..." button),
    // so the popover reads as a flyout of the item rather than a stray corner
    // popup. Opens to the right of the item; flips to the left if it would
    // overflow off the right edge, and clamps vertically within the viewport.
    const anchor = btn.closest('.folder-tree-node, .file-row, .subfolder-card') || btn;
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    const openLeft = r.right + 6 + mw > window.innerWidth - 8;
    let left = openLeft ? r.left - mw - 6 : r.right + 6;
    let top = Math.min(r.top, window.innerHeight - mh - 8);
    menu.style.left = Math.max(8, left) + 'px';
    menu.style.top = Math.max(8, top) + 'px';
    menu.classList.toggle('flip-left', openLeft);
    // Tether the little caret to the row's vertical center so the popover
    // visibly connects to the item it belongs to, even if `top` got clamped.
    const arrowTop = Math.max(10, Math.min(mh - 18, (r.top + r.height / 2) - Math.max(8, top) - 4));
    menu.style.setProperty('--menu-arrow-top', arrowTop + 'px');

    _openMenuBtn = btn;
    btn.setAttribute('aria-expanded', 'true');
    const first = menu.querySelector('.action-menu-item');
    if (first) first.focus();
}

function _fileMenuItems(f) {
    const canDelete = isElevated() || (currentUser && currentUser.id === f.uploaded_by);
    const canMove   = canDelete;
    const canManage = isElevated();
    const isImg     = _isImageMime(f.mime_type);
    const canPreview = isImg || _isPreviewableDoc(f.mime_type, f.original_name);
    const items = [];
    if (canPreview) items.push({ label: 'Preview', icon: 'preview', run: () => openFilePreview(f.id) });
    items.push({ label: 'Download', icon: 'download', run: () => { window.location = `/api/files/${f.id}/download`; } });
    if (canMove)   items.push({ label: 'Move to…', icon: 'move', run: () => openMoveModal('files', [f.id]) });
    if (canManage) items.push({ label: t('files.edit') || 'Edit', icon: 'edit', run: () => openFileEditModal(f.id) });
    if (canDelete) { items.push({ sep: true }); items.push({ label: 'Delete', icon: 'trash', danger: true, run: () => deleteFile(f.id) }); }
    return items;
}

function _folderMenuItems(fid) {
    return [
        { label: 'Open', icon: 'open', run: () => selectFolder(fid) },
        { label: 'Move to…', icon: 'move', run: () => openMoveModal('folder', fid) },
        { label: t('files.edit') || 'Edit', icon: 'edit', run: () => openFolderEditModal(fid) },
        { sep: true },
        { label: 'Delete', icon: 'trash', danger: true, run: () => deleteFolder(fid) },
    ];
}

// Open/toggle from either a file row or a subfolder card.
document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-file-menu], [data-folder-menu]');
    if (!btn) return;
    ev.preventDefault();
    ev.stopPropagation();                     // don't trigger the row/card onclick
    if (_openMenuBtn === btn) { closeActionMenu(); return; }
    closeActionMenu();
    const fileAttr = btn.getAttribute('data-file-menu');
    if (fileAttr != null) {
        const f = fileListCache.find(x => x.id === parseInt(fileAttr, 10));
        if (f) _openActionMenu(btn, _fileMenuItems(f));
    } else {
        const fid = parseInt(btn.getAttribute('data-folder-menu'), 10);
        if (!isNaN(fid)) _openActionMenu(btn, _folderMenuItems(fid));
    }
});

// Run a chosen item.
document.addEventListener('click', (ev) => {
    const item = ev.target.closest('.action-menu-item');
    if (!item) return;
    ev.preventDefault();
    ev.stopPropagation();
    const menu = document.getElementById('file-action-menu');
    const entry = menu && menu._items && menu._items[parseInt(item.dataset.menuIdx, 10)];
    closeActionMenu();
    if (entry && typeof entry.run === 'function') entry.run();
});

// Dismiss on outside click, Escape, scroll or resize (the popover is fixed-
// positioned, so it would otherwise detach from its anchor).
document.addEventListener('click', (ev) => {
    if (!_openMenuBtn) return;
    if (ev.target.closest('#file-action-menu, [data-file-menu], [data-folder-menu]')) return;
    closeActionMenu();
});
document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || !_openMenuBtn) return;
    const btn = _openMenuBtn;
    closeActionMenu();
    btn.focus();
});
window.addEventListener('scroll', () => { if (_openMenuBtn) closeActionMenu(); }, true);
window.addEventListener('resize', () => { if (_openMenuBtn) closeActionMenu(); });

// ── Selection / bulk action bar ──
function onFileCheckboxToggle(ev, id) {
    ev.stopPropagation();
    if (ev.target.checked) fileSelectedIds.add(id);
    else fileSelectedIds.delete(id);
    const row = ev.target.closest('.file-row');
    if (row) row.classList.toggle('selected', ev.target.checked);
    _updateBulkBar();
}

function onSelectAllToggle(ev) {
    const visible = _applyFilterSort(fileListCache);
    if (ev.target.checked) {
        visible.forEach(f => fileSelectedIds.add(f.id));
    } else {
        visible.forEach(f => fileSelectedIds.delete(f.id));
    }
    _renderFileList();
    _updateBulkBar();
}

function clearFileSelection() {
    fileSelectedIds.clear();
    const all = document.getElementById('file-select-all');
    if (all) { all.checked = false; all.indeterminate = false; }
    _updateBulkBar();
    document.querySelectorAll('.file-row.selected').forEach(r => r.classList.remove('selected'));
    document.querySelectorAll('[data-file-cb]').forEach(cb => { cb.checked = false; });
}

function _updateBulkBar() {
    const bar = document.getElementById('file-bulk-bar');
    const count = document.getElementById('file-bulk-count');
    const all = document.getElementById('file-select-all');
    if (!bar || !count) return;
    const n = fileSelectedIds.size;
    bar.classList.toggle('hidden', n === 0);
    count.textContent = String(n);
    if (all) {
        const visible = _applyFilterSort(fileListCache);
        const visibleSelected = visible.filter(f => fileSelectedIds.has(f.id)).length;
        all.checked = visible.length > 0 && visibleSelected === visible.length;
        all.indeterminate = visibleSelected > 0 && visibleSelected < visible.length;
    }
}

async function bulkDownloadSelected() {
    if (!fileSelectedIds.size) return;
    const ids = Array.from(fileSelectedIds);
    toast(`Preparing zip of ${ids.length} file${ids.length === 1 ? '' : 's'}…`);
    try {
        const res = await fetch('/api/files/bulk/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids }),
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            toast(`Download failed: ${body.error || res.status}`, 'error');
            return;
        }
        // Stream the response into a Blob and trigger a download.
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        // Honour the server's Content-Disposition filename if present.
        const cd = res.headers.get('Content-Disposition') || '';
        const match = /filename="?([^";]+)"?/.exec(cd);
        a.download = match ? match[1] : 'files.zip';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
        toast(`Download error: ${e.message || e}`, 'error');
    }
}

async function bulkDeleteSelected() {
    if (!fileSelectedIds.size) return;
    const ids = Array.from(fileSelectedIds);
    if (!confirm(`Delete ${ids.length} file${ids.length === 1 ? '' : 's'}?`)) return;
    let res;
    try {
        res = await fetch('/api/files/bulk/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids }),
        });
    } catch (e) {
        toast(`Delete error: ${e.message || e}`, 'error');
        return;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        toast(`Delete failed: ${body.error || res.status}`, 'error');
        return;
    }
    const ok = (body.deleted || []).length;
    const fail = (body.failed || []).length;
    if (ok)   toast(`Deleted ${ok} file${ok === 1 ? '' : 's'}`);
    if (fail) toast(`${fail} delete${fail === 1 ? '' : 's'} failed (e.g. ${body.failed[0].reason})`, 'error');
    clearFileSelection();
    await loadFolderContents(fileCurrentFolderId);
    loadFileStats();
    loadFolderStats();
}

// ── Search + sort ──
function onFileSearchInput(ev) {
    const v = ev.target.value || '';
    if (fileSearchDebounce) clearTimeout(fileSearchDebounce);
    fileSearchDebounce = setTimeout(() => {
        fileSearchTerm = v.trim();
        _renderFileList();
        _updateBulkBar();
    }, 150);
}

function onFileSortClick(key) {
    if (fileSortKey === key) {
        fileSortDir = fileSortDir === 'asc' ? 'desc' : 'asc';
    } else {
        fileSortKey = key;
        fileSortDir = 'asc';
    }
    _renderFileList();
    _updateSortIndicators();
}

function _updateSortIndicators() {
    ['name', 'size', 'uploader', 'date'].forEach(k => {
        const el = document.getElementById('file-sort-' + k);
        if (!el) return;
        if (k !== fileSortKey) { el.textContent = ''; return; }
        el.textContent = fileSortDir === 'asc' ? '▲' : '▼';
    });
}

// ── Preview lightbox (images inline; documents delegate to file-preview.js) ──
function _filePreviewEls() {
    return {
        img: document.getElementById('file-preview-img'),
        pdf: document.getElementById('file-preview-pdf'),
        docx: document.getElementById('file-preview-docx'),
        xlsx: document.getElementById('file-preview-xlsx'),
        pptx: document.getElementById('file-preview-pptx'),
        text: document.getElementById('file-preview-text'),
        loading: document.getElementById('file-preview-loading'),
        unsupported: document.getElementById('file-preview-unsupported'),
    };
}

function _hideAllFilePreviewEls(els) {
    Object.values(els).forEach(el => { if (el) el.classList.add('hidden'); });
}

function openFilePreview(id) {
    const f = fileListCache.find(x => x.id === id);
    if (!f) return;
    const modal = document.getElementById('file-preview-modal');
    const name  = document.getElementById('file-preview-name');
    const dl    = document.getElementById('file-preview-download');
    const body  = modal && modal.querySelector('.file-preview-body');
    if (!modal) return;

    const els = _filePreviewEls();
    _hideAllFilePreviewEls(els);
    if (name) name.textContent = f.original_name || '';
    if (dl)   dl.href = `/api/files/${id}/download`;
    modal.classList.remove('hidden');

    if (_isImageMime(f.mime_type)) {
        if (body) body.classList.remove('doc-mode');
        const img = els.img;
        if (!img) return;
        img.src = `/api/files/${id}/download?inline=1`;
        img.classList.remove('zoomed', 'hidden');
        img.onclick = () => {
            img.classList.toggle('zoomed');
            if (body) body.classList.toggle('preview-zoomed', img.classList.contains('zoomed'));
        };
        return;
    }

    // Non-image: lazy-load the document preview module (and, inside it, the
    // vendor lib for this specific file type) before rendering.
    if (body) body.classList.add('doc-mode');
    if (els.loading) els.loading.classList.remove('hidden');
    loadModuleOnce('file-preview').then(() => {
        if (typeof renderDocumentPreview === 'function') {
            renderDocumentPreview(f, els);
        } else {
            throw new Error('preview module failed to initialize');
        }
    }).catch((e) => {
        if (els.loading) els.loading.classList.add('hidden');
        if (els.unsupported) {
            els.unsupported.textContent = `Preview failed: ${e.message || e}`;
            els.unsupported.classList.remove('hidden');
        }
    });
}

function closeFilePreview(ev) {
    if (ev && ev.target && ev.target.id !== 'file-preview-modal' && ev.type === 'click') {
        // clicking inside content shouldn't close (handled by stopPropagation)
        // but the outer overlay click *should* — that's why this handler is on the overlay
    }
    const modal = document.getElementById('file-preview-modal');
    const els = _filePreviewEls();
    if (modal) modal.classList.add('hidden');
    if (els.img) { els.img.src = ''; els.img.classList.remove('zoomed'); }
    if (typeof cleanupDocumentPreview === 'function') cleanupDocumentPreview(els);
    const body = modal && modal.querySelector('.file-preview-body');
    if (body) { body.classList.remove('preview-zoomed'); body.classList.remove('doc-mode'); }
}

// ── Folder stats (shown in header) ──
async function loadFolderStats() {
    const host = document.getElementById('file-folder-stats');
    if (!host) return;
    const url = fileCurrentFolderId == null
        ? '/api/files/folder/stats'
        : `/api/files/folder/${fileCurrentFolderId}/stats`;
    try {
        const s = await api(url);
        if (!s) { host.textContent = ''; return; }
        host.textContent = `${s.file_count} file${s.file_count === 1 ? '' : 's'} · ${fmtBytes(s.total_bytes)}`
            + (s.subfolder_count ? ` · ${s.subfolder_count} subfolder${s.subfolder_count === 1 ? '' : 's'}` : '');
    } catch (_) { host.textContent = ''; }
}

// ── Recent uploads modal ──
async function toggleRecentUploads() {
    const modal = document.getElementById('file-recent-modal');
    const body  = document.getElementById('file-recent-body');
    if (!modal || !body) return;
    body.innerHTML = '<p class="text-sm text-gray-400 px-2 py-4 text-center">Loading…</p>';
    modal.classList.remove('hidden');
    const rows = await api('/api/files/recent?limit=20');
    if (!rows || !rows.length) {
        body.innerHTML = '<p class="text-sm text-gray-400 px-2 py-4 text-center">No recent uploads.</p>';
        return;
    }
    body.innerHTML = rows.map(r => `
        <div class="recent-row">
            <svg class="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
            <div class="recent-row-info">
                <p class="recent-row-name" title="${esc(r.original_name)}">${esc(r.original_name)}</p>
                <p class="recent-row-meta">${fmtBytes(r.size_bytes)} · ${esc(r.uploaded_by_name || '')} · ${esc(r.folder_name || 'Root')} · ${fmtDateShort(r.uploaded_at)}</p>
            </div>
            <a href="/api/files/${r.id}/download" class="text-xs text-indigo-600 hover:underline">Download</a>
        </div>
    `).join('');
}

function closeRecentUploads(ev) {
    if (ev && ev.target && ev.target.id !== 'file-recent-modal' && ev.type === 'click') return;
    const modal = document.getElementById('file-recent-modal');
    if (modal) modal.classList.add('hidden');
}

// ── Drag-to-move (file rows → folder tree node or subfolder card) ──
// Drop targets are any element carrying data-folder-id: sidebar tree nodes
// (including Root, which uses the "root" sentinel) and subfolder cards.
let _fileDragIds = [];      // ids currently being dragged (already permission-filtered)
let _fileDragSkipped = 0;   // selected-but-not-movable count, reported after the move
let _folderDragId = null;   // folders move ONE at a time — deliberately a scalar
let _folderDragBlocked = new Set();  // ids that can't receive _folderDragId (self + descendants)
let _dragGhostEl = null;

// Mirrors the `canMove` rule used at row-render time. Needed because checkboxes
// render on every row (and select-all takes every visible file), while
// draggable="true" is only set for movable rows — so a Staff selection can
// legitimately contain files they cannot move.
function _movableFileIds(ids) {
    const elevated = isElevated();
    return ids.filter(id => {
        const f = fileListCache.find(x => x.id === id);
        return !!f && (elevated || (currentUser && currentUser.id === f.uploaded_by));
    });
}

// setDragImage needs the element in the document, so it's parked offscreen
// via .file-drag-ghost rather than hidden.
function _setDragGhost(ev, label) {
    const ghost = document.createElement('div');
    ghost.className = 'file-drag-ghost';
    ghost.textContent = label;
    document.body.appendChild(ghost);
    _dragGhostEl = ghost;
    ev.dataTransfer.setDragImage(ghost, 12, 12);
}

function onFileDragStart(ev, id) {
    // Grabbing a selected row drags the whole selection; grabbing an unselected
    // row drags just that row (standard file-manager behaviour).
    const base = fileSelectedIds.has(id) ? [...fileSelectedIds] : [id];
    _fileDragIds = _movableFileIds(base);
    _fileDragSkipped = base.length - _fileDragIds.length;
    if (!_fileDragIds.length) { ev.preventDefault(); _resetDragState(); return; }
    try {
        ev.dataTransfer.setData('text/plain', _fileDragIds.join(','));
        ev.dataTransfer.effectAllowed = 'move';
        if (_fileDragIds.length > 1) _setDragGhost(ev, `${_fileDragIds.length} files`);
    } catch (_) {}
    _fileDragIds.forEach(fid => {
        const row = document.querySelector(`.file-row[data-file-id="${fid}"]`);
        if (row) row.classList.add('drag-source');
    });
}

// ── Folder drag (one folder at a time) ──
// Collects fid plus every descendant — none of them may receive the folder,
// which mirrors the server's _is_descendant() cycle guard so the UI never
// offers a drop the API would reject.
function _folderSubtreeIds(fid) {
    const out = new Set([fid]);
    const node = findFolder(fid);
    const walk = (nodes) => (nodes || []).forEach(n => { out.add(n.id); walk(n.children); });
    if (node) walk(node.children);
    return out;
}

function onFolderDragStart(ev, fid) {
    ev.stopPropagation();               // don't let a nested row's handler also fire
    if (!isElevated()) { ev.preventDefault(); return; }
    _folderDragId = fid;
    _folderDragBlocked = _folderSubtreeIds(fid);
    try {
        ev.dataTransfer.setData('text/plain', `folder:${fid}`);
        ev.dataTransfer.effectAllowed = 'move';
        _setDragGhost(ev, findFolderName(fid) || 'Folder');
    } catch (_) {}
    document.querySelectorAll(`[data-folder-id="${fid}"]`)
        .forEach(el => el.classList.add('drag-source'));
}

// True when the node can legally receive whatever is currently in flight.
function _canDropOn(node) {
    const target = _dropTargetFolderId(node);
    if (target === undefined) return false;
    if (_folderDragId != null) {
        if (target != null && _folderDragBlocked.has(target)) return false;   // self / descendant
        return true;
    }
    return _fileDragIds.length > 0;
}

// Single place that unwinds every drag artefact: the in-flight id list, the
// upload overlay + its depth counter, row/target highlights and the drag ghost.
function _resetDragState() {
    _fileDragIds = [];
    _fileDragSkipped = 0;
    _folderDragId = null;
    _folderDragBlocked = new Set();
    fileDragDepth = 0;
    const ov = document.getElementById('file-drop-overlay');
    if (ov) ov.classList.add('hidden');
    document.querySelectorAll('.drag-source').forEach(r => r.classList.remove('drag-source'));
    document.querySelectorAll('.drop-target').forEach(n => n.classList.remove('drop-target'));
    if (_dragGhostEl) { _dragGhostEl.remove(); _dragGhostEl = null; }
}

function onFileDragEnd(ev) {
    _resetDragState();
}

// → null for Root, an int for a folder, undefined if the node isn't a target.
// Explicit about Root because parseInt('') is NaN and JSON.stringify turns NaN
// into null — which would silently *look* like a correct move to root.
function _dropTargetFolderId(node) {
    const raw = node.getAttribute('data-folder-id');
    if (raw === 'root') return null;
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? undefined : n;
}

// Sequential, not parallel: db.py caches one pyodbc connection per thread and
// Waitress's pool is small, so N concurrent POSTs cost threads for no gain.
// Matches the idiom already used by uploadFiles().
async function _moveFilesTo(ids, target) {
    let ok = 0;
    const failures = [];
    for (const id of ids) {
        try {
            const res = await fetch(`/api/files/${id}/move`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folder_id: target }),
            });
            const body = await res.json().catch(() => ({}));
            if (res.ok) ok++;
            else failures.push(body.error || res.status);
        } catch (e) {
            failures.push(e.message || e);
        }
    }
    return { ok, failures };
}

// Shared by drag-to-move and the "Move to…" picker so both report identically.
async function moveFilesToFolder(ids, target, skipped = 0) {
    if (!ids || !ids.length) return;
    const destName = target == null ? 'Root' : (findFolderName(target) || `Folder #${target}`);
    const { ok, failures } = await _moveFilesTo(ids, target);
    if (ok) toast(`Moved ${ok} file${ok === 1 ? '' : 's'} to ${destName}`);
    if (failures.length) {
        toast(`${failures.length} move${failures.length === 1 ? '' : 's'} failed (e.g. ${failures[0]})`, 'error');
    }
    if (skipped) {
        toast(`${skipped} file${skipped === 1 ? '' : 's'} skipped — you can only move your own uploads.`, 'error');
    }
    clearFileSelection();
    await loadFolderContents(fileCurrentFolderId);
    loadFolderStats();
}

// Folders move one at a time. The server re-validates the cycle guard and the
// destination name collision, so failures here surface its message verbatim.
async function moveFolderTo(fid, parentId) {
    const name = findFolderName(fid) || `#${fid}`;
    const destName = parentId == null ? 'Root' : (findFolderName(parentId) || `Folder #${parentId}`);
    let res;
    try {
        res = await fetch(`/api/files/folder/${fid}/move`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parent_id: parentId }),
        });
    } catch (e) {
        toast(`Move error: ${e.message || e}`, 'error');
        return;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        toast(`Move failed: ${body.error || res.status}`, 'error');
        return;
    }
    toast(`Moved "${name}" to ${destName}`);
    await loadFileTree();   // re-fetches the tree, re-expands ancestors, reloads contents
}

// Wire drop targets via event delegation — survives tree/subfolder re-renders.
document.addEventListener('dragover', (ev) => {
    if (!_fileDragIds.length && _folderDragId == null) return;
    const node = ev.target.closest('[data-folder-id]');
    if (!node) return;
    if (!_canDropOn(node)) {
        // Invalid destination (e.g. a folder's own subtree): refuse the drop
        // outright rather than highlighting something the server would reject.
        try { ev.dataTransfer.dropEffect = 'none'; } catch (_) {}
        return;
    }
    ev.preventDefault();
    try { ev.dataTransfer.dropEffect = 'move'; } catch (_) {}
    document.querySelectorAll('.drop-target').forEach(n => {
        if (n !== node) n.classList.remove('drop-target');
    });
    node.classList.add('drop-target');
});
document.addEventListener('dragleave', (ev) => {
    if (!_fileDragIds.length && _folderDragId == null) return;
    const node = ev.target.closest('[data-folder-id]');
    // Moving between child elements inside the node isn't a real leave.
    if (node && !node.contains(ev.relatedTarget)) node.classList.remove('drop-target');
});
document.addEventListener('drop', async (ev) => {
    if (!_fileDragIds.length && _folderDragId == null) return;
    const node = ev.target.closest('[data-folder-id]');
    if (!node || !_canDropOn(node)) return;
    ev.preventDefault();
    ev.stopPropagation();
    const target = _dropTargetFolderId(node);
    if (target === undefined) { _resetDragState(); return; }

    // Snapshot before resetting — the reset listener below also clears these.
    const draggedFolder = _folderDragId;
    const ids = _fileDragIds.slice();
    const skipped = _fileDragSkipped;
    _resetDragState();

    if (draggedFolder != null) { await moveFolderTo(draggedFolder, target); return; }
    if (target === fileCurrentFolderId) return;
    await moveFilesToFolder(ids, target, skipped);
});

// ── Drag-state safety nets ──
// MUST be registered after the move-drop listener above: this one clears
// _fileDragIds, and listeners on the same node fire in registration order.
document.addEventListener('dragend', _resetDragState);
document.addEventListener('drop', _resetDragState);
document.addEventListener('dragleave', (ev) => {
    // relatedTarget === null means the pointer left the window entirely.
    // `dragend` never fires for an external OS file drag, so this is the only
    // thing that clears a stranded "Drop to upload" overlay in that case.
    if (ev.relatedTarget === null) _resetDragState();
});

// ── "Move to…" picker ──
// Non-drag path to the same operations. Renders from fileTreeCache (already
// loaded) rather than re-fetching, and disables destinations the server would
// reject so the invalid case is unreachable rather than merely handled.
let _moveKind = null;        // 'files' | 'folder'
let _movePayload = null;     // array of file ids, or a single folder id
let _moveBlocked = new Set();
let _moveCurrentParent;      // the destination that is already the current one
let _movePicked;             // undefined = nothing chosen; null = Root

function openMoveModal(kind, payload) {
    const modal = document.getElementById('file-move-modal');
    if (!modal) return;
    _moveKind = kind;
    _movePayload = payload;
    _movePicked = undefined;

    const subtitle = document.getElementById('file-move-subtitle');
    if (kind === 'folder') {
        _moveBlocked = _folderSubtreeIds(payload);
        const path = _findFolderPath(payload, fileTreeCache, []);
        _moveCurrentParent = (path && path.length) ? path[path.length - 1] : null;
        if (subtitle) subtitle.textContent = `Moving folder "${findFolderName(payload) || payload}"`;
    } else {
        _moveBlocked = new Set();
        _moveCurrentParent = fileCurrentFolderId;
        const n = payload.length;
        if (subtitle) {
            subtitle.textContent = n === 1
                ? `Moving "${(fileListCache.find(f => f.id === payload[0]) || {}).original_name || ''}"`
                : `Moving ${n} files`;
        }
    }
    _renderMovePicker();
    modal.classList.remove('hidden');
}

function closeMoveModal() {
    const modal = document.getElementById('file-move-modal');
    if (modal) modal.classList.add('hidden');
    _moveKind = null; _movePayload = null; _movePicked = undefined;
    _moveBlocked = new Set();
}

function _moveOptionRow(id, name, depth, icon) {
    const blocked = id != null && _moveBlocked.has(id);
    const isCurrent = id === _moveCurrentParent;
    const disabled = blocked || isCurrent;
    const selected = _movePicked !== undefined && _movePicked === id;
    const note = blocked ? 'Can’t move into itself' : (isCurrent ? 'Already here' : '');
    return `
        <div class="move-option${disabled ? ' disabled' : ''}${selected ? ' selected' : ''}"
             style="padding-left:${8 + depth * 14}px"
             ${disabled ? 'aria-disabled="true"' : `role="option" aria-selected="${selected}" tabindex="0" data-move-target="${id == null ? 'root' : id}"`}>
            <svg class="move-option-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${icon}"/>
            </svg>
            <span class="move-option-name">${esc(name)}</span>
            ${note ? `<span class="move-option-note">${note}</span>` : ''}
        </div>`;
}

function _renderMovePicker() {
    const host = document.getElementById('file-move-tree');
    const confirm = document.getElementById('file-move-confirm');
    if (!host) return;
    _wireMovePicker(host);
    const FOLDER_D = 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z';
    const walk = (nodes, depth) => (nodes || []).map(n =>
        _moveOptionRow(n.id, n.name, depth, FOLDER_D) + walk(n.children, depth + 1)).join('');
    host.innerHTML = _moveOptionRow(null, 'Root', 0, FOLDER_D) + walk(fileTreeCache, 1);
    if (confirm) confirm.disabled = (_movePicked === undefined);
}

// Bound to the picker container, NOT document: .modal-content carries
// onclick="event.stopPropagation()" (so overlay clicks can close the modal),
// which means these events never reach document.
function _wireMovePicker(host) {
    if (!host || host._wired) return;
    host._wired = true;
    host.addEventListener('click', (ev) => {
        const opt = ev.target.closest('[data-move-target]');
        if (!opt || !host.contains(opt)) return;
        const raw = opt.getAttribute('data-move-target');
        _movePicked = raw === 'root' ? null : parseInt(raw, 10);
        _renderMovePicker();
    });
    host.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        const opt = ev.target.closest && ev.target.closest('[data-move-target]');
        if (!opt) return;
        ev.preventDefault();
        opt.click();
    });
}

async function confirmMove() {
    if (_movePicked === undefined) return;
    const kind = _moveKind, payload = _movePayload, target = _movePicked;
    closeMoveModal();
    if (kind === 'folder') await moveFolderTo(payload, target);
    else await moveFilesToFolder(payload, target);
}

// Bulk-bar entry point: move every currently selected file.
function openMoveSelectedModal() {
    if (!fileSelectedIds.size) return;
    openMoveModal('files', _movableFileIds([...fileSelectedIds]));
}

// ── New Folder modal ──
function openNewFolderModal() {
    const input = document.getElementById('new-folder-name');
    const hint = document.getElementById('new-folder-parent-hint');
    if (input) input.value = '';
    if (hint) {
        const parentName = findFolderName(fileCurrentFolderId);
        hint.textContent = parentName
            ? `Will be created inside "${parentName}"`
            : 'Will be created at Root';
    }
    document.getElementById('new-folder-modal').classList.remove('hidden');
    setTimeout(() => input && input.focus(), 50);
}

function closeNewFolderModal() {
    document.getElementById('new-folder-modal').classList.add('hidden');
}

function findFolderName(fid) {
    if (fid == null) return null;
    const stack = [...fileTreeCache];
    while (stack.length) {
        const n = stack.pop();
        if (n.id === fid) return n.name;
        if (n.children) stack.push(...n.children);
    }
    return null;
}

async function confirmNewFolder(ev) {
    ev.preventDefault();
    const name = (document.getElementById('new-folder-name').value || '').trim();
    if (!name) return;
    const res = await api('/api/files/folder', {
        method: 'POST',
        body: { name, parent_id: fileCurrentFolderId },
    });
    if (!res) return;
    if (res.error) { toast(res.error, 'error'); return; }
    closeNewFolderModal();
    toast('Folder created');
    await loadFileTree();
}

// ── Delete ──
async function deleteFolder(fid) {
    const name = findFolderName(fid) || `#${fid}`;
    if (!confirm(`Delete folder "${name}"? Folder must be empty.`)) return;
    let res;
    try {
        res = await fetch(`/api/files/folder/${fid}`, { method: 'DELETE' });
    } catch (e) {
        toast(`Delete network error: ${e.message || e}`, 'error');
        console.error('deleteFolder network error', e);
        return;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        toast(`Delete failed: ${body.error || res.status}`, 'error');
        console.error('deleteFolder server rejected', res.status, body);
        return;
    }
    if (fileCurrentFolderId === fid) fileCurrentFolderId = null;
    toast('Folder deleted');
    await loadFileTree();
    loadFileStats();
}

// ── Edit folder (rename + classified) ──
function findFolder(fid) {
    if (fid == null) return null;
    const stack = [...fileTreeCache];
    while (stack.length) {
        const n = stack.pop();
        if (n.id === fid) return n;
        if (n.children) stack.push(...n.children);
    }
    return null;
}

function openFolderEditModal(fid) {
    const node = findFolder(fid);
    if (!node) return;
    const modal = document.getElementById('folder-edit-modal');
    if (!modal) return;
    modal.dataset.folderId = String(fid);
    document.getElementById('folder-edit-name').value = node.name || '';
    document.getElementById('folder-edit-classified').checked = !!node.is_classified;
    modal.classList.remove('hidden');
}

function closeFolderEditModal() {
    const modal = document.getElementById('folder-edit-modal');
    if (modal) modal.classList.add('hidden');
}

async function confirmFolderEdit(ev) {
    ev.preventDefault();
    const modal = document.getElementById('folder-edit-modal');
    const fid = parseInt(modal.dataset.folderId, 10);
    if (isNaN(fid)) return;
    const name = (document.getElementById('folder-edit-name').value || '').trim();
    if (!name) { toast(t('files.name_required') || 'Name cannot be empty', 'error'); return; }
    const is_classified = document.getElementById('folder-edit-classified').checked;
    const res = await api(`/api/files/folder/${fid}`, {
        method: 'PUT',
        body: { name, is_classified },
    });
    if (!res) return;
    if (res.error) { toast(res.error, 'error'); return; }
    closeFolderEditModal();
    toast(t('files.saved') || 'Saved');
    await loadFileTree();
}

async function deleteFile(id) {
    const match = fileListCache.find(x => x.id === id);
    const name = match ? match.original_name : `#${id}`;
    if (!confirm(`Delete file "${name}"?`)) return;
    let res;
    try {
        res = await fetch(`/api/files/${id}`, { method: 'DELETE' });
    } catch (e) {
        toast(`Delete network error: ${e.message || e}`, 'error');
        console.error('deleteFile network error', e);
        return;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        toast(`Delete failed: ${body.error || res.status}`, 'error');
        console.error('deleteFile server rejected', res.status, body);
        return;
    }
    toast('File deleted');
    await loadFolderContents(fileCurrentFolderId);
    loadFileStats();
}

// ── Edit file (classified flag) ──
function openFileEditModal(id) {
    const match = fileListCache.find(x => x.id === id);
    if (!match) return;
    const modal = document.getElementById('file-edit-modal');
    if (!modal) return;
    modal.dataset.fileId = String(id);
    const nameEl = document.getElementById('file-edit-name');
    if (nameEl) nameEl.textContent = match.original_name || `#${id}`;
    document.getElementById('file-edit-classified').checked = !!match.is_classified;
    modal.classList.remove('hidden');
}

function closeFileEditModal() {
    const modal = document.getElementById('file-edit-modal');
    if (modal) modal.classList.add('hidden');
}

async function confirmFileEdit(ev) {
    ev.preventDefault();
    const modal = document.getElementById('file-edit-modal');
    const id = parseInt(modal.dataset.fileId, 10);
    if (isNaN(id)) return;
    const is_classified = document.getElementById('file-edit-classified').checked;
    const res = await api(`/api/files/${id}`, {
        method: 'PATCH',
        body: { is_classified },
    });
    if (!res) return;
    if (res.error) { toast(res.error, 'error'); return; }
    closeFileEditModal();
    toast(t('files.saved') || 'Saved');
    await loadFolderContents(fileCurrentFolderId);
}

// ── Uploads ──
function onFileUploadChange(ev) {
    const files = ev.target.files;
    if (!files || !files.length) return;
    uploadFiles(Array.from(files));
    ev.target.value = ''; // allow re-picking the same file
}

// ── Upload progress panel (Google Drive style) ──
const _UPLOAD_R = 13;                          // SVG circle radius
const _UPLOAD_C = 2 * Math.PI * _UPLOAD_R;     // circumference

function _ensureUploadPanel() {
    const panel = document.getElementById('upload-panel');
    if (!panel || panel._wired) return panel;
    panel._wired = true;
    const closeBtn = document.getElementById('upload-panel-close');
    const collapseBtn = document.getElementById('upload-panel-collapse');
    if (closeBtn) closeBtn.addEventListener('click', () => {
        if (panel.dataset.active !== '0') return;       // block close while uploading
        panel.classList.add('hidden');
        const body = document.getElementById('upload-panel-body');
        if (body) body.innerHTML = '';
    });
    if (collapseBtn) collapseBtn.addEventListener('click', () => {
        panel.classList.toggle('collapsed');
    });
    return panel;
}

function _updateUploadHeader(active, total) {
    const panel = document.getElementById('upload-panel');
    if (!panel) return;
    panel.dataset.active = String(active);
    panel.classList.remove('hidden');
    const title = document.getElementById('upload-panel-title');
    if (title) {
        title.textContent = active > 0
            ? `Uploading ${active} of ${total}…`
            : `Uploaded ${total} file${total === 1 ? '' : 's'}`;
    }
    const closeBtn = document.getElementById('upload-panel-close');
    if (closeBtn) closeBtn.disabled = active > 0;
}

function _addUploadRow(rowId, fileName, fileSize) {
    const body = document.getElementById('upload-panel-body');
    if (!body) return;
    const row = document.createElement('div');
    row.id = rowId;
    row.className = 'upload-row';
    row.innerHTML = `
        <div class="upload-row-info">
            <p class="upload-row-name" title="${esc(fileName)}">${esc(fileName)}</p>
            <p class="upload-row-meta">0% · ${fmtBytes(fileSize)}</p>
        </div>
        <div class="upload-row-status">
            <svg viewBox="0 0 32 32" width="32" height="32" class="upload-progress-svg">
                <circle class="upload-progress-track" cx="16" cy="16" r="${_UPLOAD_R}"></circle>
                <circle class="upload-progress-bar" cx="16" cy="16" r="${_UPLOAD_R}"
                        stroke-dasharray="${_UPLOAD_C}" stroke-dashoffset="${_UPLOAD_C}"></circle>
            </svg>
        </div>
        <button type="button" class="upload-row-cancel" data-cancel-upload="${rowId}" title="Cancel upload" aria-label="Cancel upload">
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/>
            </svg>
        </button>`;
    body.appendChild(row);
}

// Hide/show the per-row cancel button (e.g. once upload finishes).
function _setUploadRowCancelVisible(rowId, visible) {
    const row = document.getElementById(rowId);
    if (!row) return;
    const btn = row.querySelector('.upload-row-cancel');
    if (btn) btn.style.display = visible ? '' : 'none';
}

// Track in-flight XHRs so we can abort on user cancel.
const _activeUploads = new Map();   // rowId -> XMLHttpRequest

function _setUploadProgress(rowId, progress, fileSize) {
    const row = document.getElementById(rowId);
    if (!row) return;
    const bar = row.querySelector('.upload-progress-bar');
    const meta = row.querySelector('.upload-row-meta');
    const pct = Math.max(0, Math.min(1, progress));
    if (bar) bar.setAttribute('stroke-dashoffset', String(_UPLOAD_C * (1 - pct)));
    if (meta) meta.textContent = `${Math.round(pct * 100)}% · ${fmtBytes(fileSize)}`;
}

function _setUploadCancelled(rowId, fileSize) {
    const row = document.getElementById(rowId);
    if (!row) return;
    const status = row.querySelector('.upload-row-status');
    const meta = row.querySelector('.upload-row-meta');
    row.classList.add('error');
    if (status) status.innerHTML = `
        <svg viewBox="0 0 32 32" width="32" height="32">
            <circle cx="16" cy="16" r="14" fill="#fef3c7"></circle>
            <path d="M11 11 l10 10 M21 11 l-10 10" fill="none" stroke="#b45309"
                  stroke-width="2.5" stroke-linecap="round"></path>
        </svg>`;
    if (meta) meta.textContent = `Cancelled · ${fmtBytes(fileSize)}`;
    _setUploadRowCancelVisible(rowId, false);
}

function _setUploadDone(rowId, ok, message, fileSize) {
    const row = document.getElementById(rowId);
    if (!row) return;
    _setUploadRowCancelVisible(rowId, false);
    const status = row.querySelector('.upload-row-status');
    const meta = row.querySelector('.upload-row-meta');
    if (ok) {
        if (status) status.innerHTML = `
            <svg viewBox="0 0 32 32" width="32" height="32">
                <circle cx="16" cy="16" r="14" fill="#d1fae5"></circle>
                <path d="M10 16 l4 4 l8 -8" fill="none" stroke="#059669" stroke-width="2.5"
                      stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>`;
        if (meta) meta.textContent = `Done · ${fmtBytes(fileSize)}`;
    } else {
        row.classList.add('error');
        if (status) status.innerHTML = `
            <svg viewBox="0 0 32 32" width="32" height="32">
                <circle cx="16" cy="16" r="14" fill="#fee2e2"></circle>
                <path d="M11 11 l10 10 M21 11 l-10 10" fill="none" stroke="#dc2626"
                      stroke-width="2.5" stroke-linecap="round"></path>
            </svg>`;
        if (meta) meta.textContent = message || 'Failed';
    }
}

function _uploadOneXHR(file, folderId, rowId) {
    return new Promise((resolve) => {
        const fd = new FormData();
        fd.append('file', file);
        if (folderId != null) fd.append('folder_id', String(folderId));
        const xhr = new XMLHttpRequest();
        _activeUploads.set(rowId, xhr);
        const cleanup = () => _activeUploads.delete(rowId);
        xhr.open('POST', '/api/files/upload');
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) _setUploadProgress(rowId, e.loaded / e.total, file.size);
        };
        xhr.onload = () => {
            cleanup();
            let body = {};
            try { body = JSON.parse(xhr.responseText || '{}'); } catch (_) {}
            const ok = xhr.status >= 200 && xhr.status < 300;
            resolve({ ok, status: xhr.status, body });
        };
        xhr.onerror = () => { cleanup(); resolve({ ok: false, status: 0, body: { error: 'network error' } }); };
        xhr.onabort = () => { cleanup(); resolve({ ok: false, status: 0, body: { error: 'aborted' }, aborted: true }); };
        xhr.send(fd);
    });
}

// Cancel a single in-flight upload by rowId. Server-side: Flask raises on the
// aborted request; no DB row or blob persists.
function cancelUpload(rowId) {
    const xhr = _activeUploads.get(rowId);
    if (xhr) { try { xhr.abort(); } catch (_) {} }
}

// Cancel every queued/in-flight upload in the current batch.
function cancelAllUploads() {
    [..._activeUploads.values()].forEach(xhr => { try { xhr.abort(); } catch (_) {} });
}

// Event delegation for per-row cancel buttons.
document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-cancel-upload]');
    if (!btn) return;
    ev.preventDefault();
    ev.stopPropagation();
    cancelUpload(btn.getAttribute('data-cancel-upload'));
});

async function uploadFiles(files) {
    const destName = fileCurrentFolderId == null
        ? 'Root'
        : (findFolderName(fileCurrentFolderId) || `Folder #${fileCurrentFolderId}`);

    _ensureUploadPanel();
    // Reset panel for this batch
    const body = document.getElementById('upload-panel-body');
    if (body) body.innerHTML = '';

    const total = files.length;
    let active = total;
    let ok = 0;
    _updateUploadHeader(active, total);

    const rowIds = files.map((f, i) => {
        const id = `upl-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`;
        _addUploadRow(id, f.name, f.size);
        return id;
    });

    // Sequential upload: one at a time, each shows live circular progress.
    let cancelled = 0;
    for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const rowId = rowIds[i];
        const res = await _uploadOneXHR(f, fileCurrentFolderId, rowId);
        if (res.ok) {
            ok++;
            _setUploadDone(rowId, true, '', f.size);
        } else if (res.aborted) {
            cancelled++;
            _setUploadCancelled(rowId, f.size);
        } else {
            const msg = (res.body && res.body.error) || `Failed (${res.status || 'network'})`;
            _setUploadDone(rowId, false, msg, f.size);
            console.error('Upload failed', f.name, res.status, res.body);
        }
        active--;
        _updateUploadHeader(active, total);
    }

    if (ok)               toast(`Uploaded ${ok} file${ok === 1 ? '' : 's'} to ${destName}`);
    if (cancelled)        toast(`${cancelled} upload${cancelled === 1 ? '' : 's'} cancelled`);
    const failed = total - ok - cancelled;
    if (failed > 0)       toast(`${failed} upload${failed === 1 ? '' : 's'} failed`, 'error');
    await loadFolderContents(fileCurrentFolderId);
    loadFileStats();
}

// The "Drop to upload" overlay is for external file drags only — an internal
// row drag is a *move*, so raising an upload affordance would be misleading.
// Internal drags carry only text/plain; OS file drags carry the "Files" type.
function _isExternalFileDrag(ev) {
    if (_fileDragIds.length) return false;              // internal move in flight
    const types = ev.dataTransfer && ev.dataTransfer.types;
    return !!types && Array.prototype.includes.call(types, 'Files');
}

// The ONLY place fileDragDepth is incremented. dragenter fires once per element
// entered, so the counter stays balanced against dragleave.
function onFileDragEnter(ev) {
    if (!_isExternalFileDrag(ev)) return;
    ev.preventDefault();
    fileDragDepth++;
    const ov = document.getElementById('file-drop-overlay');
    if (ov) ov.classList.remove('hidden');
}

function onFileDragOver(ev) {
    // dragover fires continuously, so it must NOT touch fileDragDepth — that
    // was the bug that left the dashed border stuck on screen. preventDefault
    // is still required on every fire or the browser refuses the drop.
    if (!_isExternalFileDrag(ev)) return;
    ev.preventDefault();
    try { ev.dataTransfer.dropEffect = 'copy'; } catch (_) {}
}

function onFileDragLeave(ev) {
    fileDragDepth = Math.max(0, fileDragDepth - 1);
    if (fileDragDepth === 0) {
        const ov = document.getElementById('file-drop-overlay');
        if (ov) ov.classList.add('hidden');
    }
}

function onFileDrop(ev) {
    ev.preventDefault();   // stop the browser navigating to the dropped file
    fileDragDepth = 0;
    const ov = document.getElementById('file-drop-overlay');
    if (ov) ov.classList.add('hidden');
    const files = ev.dataTransfer && ev.dataTransfer.files;
    // Empty file list = internal move drop (e.g. onto a subfolder card, which
    // lives inside this pane); the delegated move handler owns that case.
    if (!files || !files.length) return;
    uploadFiles(Array.from(files));
}
