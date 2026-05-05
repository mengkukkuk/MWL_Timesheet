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
                     onclick="selectFolder(null)">
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
        // float-right reverses DOM order: list X first → renders rightmost; rename second → appears to its left
        return `
        <div class="folder-tree-node ${isActive ? 'active' : ''}" style="padding-left:${pad}px"
             onclick="selectFolder(${n.id})">
            <svg class="w-4 h-4 inline-block -mt-0.5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
            </svg>
            <span class="ml-1">${esc(n.name)}</span>
            ${canManage ? `
                <button type="button" data-del-folder="${n.id}"
                        class="float-right text-gray-300 hover:text-red-500 text-xs px-1"
                        title="Delete folder">&times;</button>
                <button type="button" data-rename-folder="${n.id}"
                        class="float-right text-gray-300 hover:text-indigo-500 text-xs px-1"
                        title="Rename folder">&#9998;</button>
            ` : ''}
        </div>
        ${renderTreeNodes(n.children, depth + 1)}`;
    }).join('');
}

function selectFolder(fid) {
    fileCurrentFolderId = fid;
    clearFileSelection();
    fileSearchTerm = '';
    const search = document.getElementById('file-search');
    if (search) search.value = '';
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
    host.innerHTML = folders.map(f => `
        <div onclick="selectFolder(${f.id})" class="flex items-center gap-2 p-2 border border-gray-200 rounded-md cursor-pointer hover:bg-indigo-50 hover:border-indigo-300 transition-colors">
            <svg class="w-5 h-5 text-indigo-500 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                <path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z"/>
            </svg>
            <span class="text-sm text-gray-700 truncate">${esc(f.name)}</span>
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
        const isImg     = _isImageMime(f.mime_type);
        const isSelected = fileSelectedIds.has(f.id);
        return `
        <div class="file-row ${isSelected ? 'selected' : ''}" data-file-id="${f.id}"
             ${canMove ? `draggable="true" ondragstart="onFileDragStart(event, ${f.id})" ondragend="onFileDragEnd(event)"` : ''}>
            <div class="file-row-checkbox">
                <input type="checkbox" data-file-cb="${f.id}" ${isSelected ? 'checked' : ''}
                       onclick="onFileCheckboxToggle(event, ${f.id})">
            </div>
            <div class="file-row-name">
                <svg class="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                </svg>
                <span class="file-row-name-text" title="${esc(f.original_name)}"
                      ${isImg ? `onclick="openFilePreview(${f.id})"` : `onclick="window.location='/api/files/${f.id}/download'"`}
                      >${esc(f.original_name)}</span>
                <div class="file-row-actions">
                    ${isImg ? `<button type="button" onclick="openFilePreview(${f.id})">Preview</button>` : ''}
                    <a href="/api/files/${f.id}/download">Download</a>
                    ${canDelete ? `<button type="button" class="danger" data-del-file="${f.id}">Delete</button>` : ''}
                </div>
            </div>
            <div class="file-row-size">${fmtBytes(f.size_bytes)}</div>
            <div class="file-row-uploader">${esc(f.uploaded_by_name || '')}</div>
            <div class="file-row-date">${fmtDateShort(f.uploaded_at)}</div>
        </div>`;
    }).join('');
}

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

// ── Image preview lightbox ──
function openFilePreview(id) {
    const f = fileListCache.find(x => x.id === id);
    if (!f) return;
    const modal = document.getElementById('file-preview-modal');
    const img   = document.getElementById('file-preview-img');
    const name  = document.getElementById('file-preview-name');
    const dl    = document.getElementById('file-preview-download');
    if (!modal || !img) return;
    img.src = `/api/files/${id}/download?inline=1`;
    if (name) name.textContent = f.original_name || '';
    if (dl)   dl.href = `/api/files/${id}/download`;
    modal.classList.remove('hidden');
}

function closeFilePreview(ev) {
    if (ev && ev.target && ev.target.id !== 'file-preview-modal' && ev.type === 'click') {
        // clicking inside content shouldn't close (handled by stopPropagation)
        // but the outer overlay click *should* — that's why this handler is on the overlay
    }
    const modal = document.getElementById('file-preview-modal');
    const img   = document.getElementById('file-preview-img');
    if (modal) modal.classList.add('hidden');
    if (img) img.src = '';
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

// ── Drag-to-move (file row → folder tree node) ──
let _fileDragId = null;

function onFileDragStart(ev, id) {
    _fileDragId = id;
    try {
        ev.dataTransfer.setData('text/plain', String(id));
        ev.dataTransfer.effectAllowed = 'move';
    } catch (_) {}
    const row = ev.target.closest('.file-row');
    if (row) row.classList.add('drag-source');
}

function onFileDragEnd(ev) {
    _fileDragId = null;
    document.querySelectorAll('.file-row.drag-source').forEach(r => r.classList.remove('drag-source'));
    document.querySelectorAll('.folder-tree-node.drop-target').forEach(n => n.classList.remove('drop-target'));
}

// Wire folder tree nodes as move-targets via event delegation.
document.addEventListener('dragover', (ev) => {
    if (_fileDragId == null) return;
    const node = ev.target.closest('.folder-tree-node');
    if (!node) return;
    ev.preventDefault();
    try { ev.dataTransfer.dropEffect = 'move'; } catch (_) {}
    document.querySelectorAll('.folder-tree-node.drop-target').forEach(n => n.classList.remove('drop-target'));
    node.classList.add('drop-target');
});
document.addEventListener('dragleave', (ev) => {
    if (_fileDragId == null) return;
    const node = ev.target.closest('.folder-tree-node');
    if (node) node.classList.remove('drop-target');
});
document.addEventListener('drop', async (ev) => {
    if (_fileDragId == null) return;
    const node = ev.target.closest('.folder-tree-node');
    if (!node) return;
    ev.preventDefault();
    ev.stopPropagation();
    // Resolve target folder id from the node — the Root node has onclick="selectFolder(null)"
    const onclickAttr = node.getAttribute('onclick') || '';
    const m = /selectFolder\(([^)]+)\)/.exec(onclickAttr);
    let target = null;
    if (m && m[1].trim() !== 'null') target = parseInt(m[1], 10);
    if (target === fileCurrentFolderId) { onFileDragEnd(); return; }
    const movedId = _fileDragId;
    onFileDragEnd();
    try {
        const res = await fetch(`/api/files/${movedId}/move`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder_id: target }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
            toast(`Move failed: ${body.error || res.status}`, 'error');
            return;
        }
        toast('File moved');
        await loadFolderContents(fileCurrentFolderId);
        loadFolderStats();
    } catch (e) {
        toast(`Move error: ${e.message || e}`, 'error');
    }
});

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

// Event delegation for folder-delete buttons in the sidebar tree
document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-del-folder]');
    if (!btn) return;
    ev.preventDefault();
    ev.stopPropagation();
    const id = parseInt(btn.getAttribute('data-del-folder'), 10);
    if (!isNaN(id)) deleteFolder(id);
});

// ── Rename folder ──
async function renameFolder(fid) {
    const current = findFolderName(fid) || '';
    const next = prompt(`Rename folder "${current}" to:`, current);
    if (next == null) return;                 // user cancelled
    const trimmed = next.trim();
    if (!trimmed) { toast('Name cannot be empty', 'error'); return; }
    if (trimmed === current) return;          // no-op
    let res;
    try {
        res = await fetch(`/api/files/folder/${fid}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: trimmed }),
        });
    } catch (e) {
        toast(`Rename network error: ${e.message || e}`, 'error');
        console.error('renameFolder network error', e);
        return;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        toast(`Rename failed: ${body.error || res.status}`, 'error');
        console.error('renameFolder server rejected', res.status, body);
        return;
    }
    toast('Folder renamed');
    await loadFileTree();
}

// Event delegation for rename buttons — survives re-rendering
document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-rename-folder]');
    if (!btn) return;
    ev.preventDefault();
    ev.stopPropagation();
    const id = parseInt(btn.getAttribute('data-rename-folder'), 10);
    if (!isNaN(id)) renameFolder(id);
});

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

// Event delegation for delete buttons — survives re-rendering
document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-del-file]');
    if (!btn) return;
    ev.preventDefault();
    const id = parseInt(btn.getAttribute('data-del-file'), 10);
    if (!isNaN(id)) deleteFile(id);
});

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

function onFileDragOver(ev) {
    ev.preventDefault();
    fileDragDepth++;
    const ov = document.getElementById('file-drop-overlay');
    const pane = document.getElementById('file-contents-pane');
    if (ov) ov.classList.remove('hidden');
    if (pane) pane.classList.add('relative');
}

function onFileDragLeave(ev) {
    fileDragDepth = Math.max(0, fileDragDepth - 1);
    if (fileDragDepth === 0) {
        const ov = document.getElementById('file-drop-overlay');
        if (ov) ov.classList.add('hidden');
    }
}

function onFileDrop(ev) {
    ev.preventDefault();
    fileDragDepth = 0;
    const ov = document.getElementById('file-drop-overlay');
    if (ov) ov.classList.add('hidden');
    const files = ev.dataTransfer && ev.dataTransfer.files;
    if (!files || !files.length) return;
    uploadFiles(Array.from(files));
}
