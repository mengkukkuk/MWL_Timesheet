// Document preview module — renders PDF/DOCX/XLSX/PPTX/plain-text files inline
// in the File Share preview modal. Lazy-loaded on demand via loadModuleOnce('file-preview')
// from files.js; the vendor libraries below are themselves lazy-loaded per file type so
// opening the Files tab never pulls in these (fairly large) parsers.
//
// Depends on: nothing from other modules — operates purely on the DOM element refs
// passed in by files.js (_filePreviewEls()).

const _vendorScriptPromises = Object.create(null);

function _loadVendorScript(src) {
    if (_vendorScriptPromises[src]) return _vendorScriptPromises[src];
    _vendorScriptPromises[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = false;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error(`failed to load ${src}`));
        document.head.appendChild(s);
    });
    return _vendorScriptPromises[src];
}

const _PREVIEW_VENDORS = {
    jszip: 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
    docx: 'https://cdn.jsdelivr.net/npm/docx-preview@0.4.0/dist/docx-preview.min.js',
    xlsx: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
    pptx: 'https://cdn.jsdelivr.net/npm/pptx-viewer@0.2.2/dist/pptx-viewer.umd.js',
};

const _TEXT_EXTENSIONS = new Set(['txt', 'log', 'md', 'markdown', 'csv', 'json', 'ini', 'conf', 'yaml', 'yml', 'xml']);

function _fileExt(name) {
    const parts = (name || '').split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

// Kept in sync with the lightweight `_isPreviewableDoc()` check in files.js
// (that one runs on every row render, so it stays dependency-free; this one
// decides which vendor lib to load once the user actually opens a preview).
function _documentKind(mime, name) {
    const ext = _fileExt(name);
    if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
    if (ext === 'docx') return 'docx';
    if (ext === 'xlsx' || ext === 'xls' || mime === 'application/vnd.ms-excel') return 'xlsx';
    if (ext === 'pptx') return 'pptx';
    if ((mime && mime.startsWith('text/')) || _TEXT_EXTENSIONS.has(ext)) return 'text';
    return null;
}

let _pptxViewerInstance = null;

function _hideAllPanels(els) {
    ['docx', 'xlsx', 'pptx', 'text', 'loading', 'unsupported'].forEach(key => {
        if (els[key]) els[key].classList.add('hidden');
    });
}

// Renders `file` (a fileListCache entry: {id, mime_type, original_name}) into
// the appropriate panel of `els` (see files.js _filePreviewEls()). Assumes the
// image panel has already been ruled out by the caller.
async function renderDocumentPreview(file, els) {
    const kind = _documentKind(file.mime_type, file.original_name);
    _hideAllPanels(els);

    if (!kind) {
        if (els.loading) els.loading.classList.add('hidden');
        if (els.unsupported) {
            els.unsupported.textContent = 'Preview not available for this file type.';
            els.unsupported.classList.remove('hidden');
        }
        return;
    }

    const url = `/api/files/${file.id}/download?inline=1`;

    // PDFs render natively in the browser — no vendor lib, just point the iframe.
    if (kind === 'pdf') {
        if (els.loading) els.loading.classList.add('hidden');
        if (els.pdf) {
            els.pdf.src = url;
            els.pdf.classList.remove('hidden');
        }
        return;
    }

    try {
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) throw new Error(`download failed (${res.status})`);
        const buf = await res.arrayBuffer();

        if (kind === 'docx') {
            await _loadVendorScript(_PREVIEW_VENDORS.jszip);
            await _loadVendorScript(_PREVIEW_VENDORS.docx);
            els.docx.innerHTML = '';
            await window.docx.renderAsync(buf, els.docx, els.docx, { inWrapper: true });
            els.docx.classList.remove('hidden');
        } else if (kind === 'xlsx') {
            await _loadVendorScript(_PREVIEW_VENDORS.xlsx);
            const wb = window.XLSX.read(buf, { type: 'array' });
            els.xlsx.innerHTML = _renderWorkbookTabs(wb);
            els.xlsx.classList.remove('hidden');
        } else if (kind === 'pptx') {
            await _loadVendorScript(_PREVIEW_VENDORS.pptx);
            els.pptx.innerHTML = '';
            if (_pptxViewerInstance) {
                try { _pptxViewerInstance.destroy(); } catch (_) { /* already gone */ }
            }
            _pptxViewerInstance = new window.PPTXViewer.PPTXViewer(els.pptx, {
                showControls: true,
                keyboardNavigation: true,
            });
            await _pptxViewerInstance.load(buf);
            els.pptx.classList.remove('hidden');
        } else if (kind === 'text') {
            els.text.textContent = new TextDecoder('utf-8').decode(buf);
            els.text.classList.remove('hidden');
        }
    } catch (e) {
        if (els.unsupported) {
            els.unsupported.textContent = `Preview failed: ${e.message || e}`;
            els.unsupported.classList.remove('hidden');
        }
    } finally {
        if (els.loading) els.loading.classList.add('hidden');
    }
}

function _escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
}

function _renderWorkbookTabs(wb) {
    const names = wb.SheetNames || [];
    if (!names.length) return '<p class="text-sm text-gray-400 p-4">Workbook has no sheets.</p>';
    const tabs = names.map((name, i) => `
        <button type="button" class="xlsx-tab ${i === 0 ? 'active' : ''}" data-sheet-idx="${i}">${_escapeHtml(name)}</button>
    `).join('');
    const panels = names.map((name, i) => {
        const html = window.XLSX.utils.sheet_to_html(wb.Sheets[name]);
        return `<div class="xlsx-sheet-panel ${i === 0 ? '' : 'hidden'}" data-sheet-panel="${i}">${html}</div>`;
    }).join('');
    return `<div class="xlsx-tabs">${tabs}</div><div class="xlsx-panels">${panels}</div>`;
}

// Tab switching for multi-sheet workbooks — event delegation so it survives re-render.
document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.xlsx-tab');
    if (!btn) return;
    const tabsHost = btn.closest('.xlsx-tabs');
    const panelsHost = tabsHost && tabsHost.nextElementSibling;
    if (!tabsHost || !panelsHost) return;
    const idx = btn.getAttribute('data-sheet-idx');
    tabsHost.querySelectorAll('.xlsx-tab').forEach(b => b.classList.toggle('active', b === btn));
    panelsHost.querySelectorAll('.xlsx-sheet-panel').forEach(p => {
        p.classList.toggle('hidden', p.getAttribute('data-sheet-panel') !== idx);
    });
});

// Called by files.js when the preview modal closes, to release the pptx
// viewer instance and clear rendered content from the DOM.
function cleanupDocumentPreview(els) {
    if (_pptxViewerInstance) {
        try { _pptxViewerInstance.destroy(); } catch (_) { /* already gone */ }
        _pptxViewerInstance = null;
    }
    if (els.pdf) els.pdf.src = 'about:blank';
    if (els.docx) els.docx.innerHTML = '';
    if (els.xlsx) els.xlsx.innerHTML = '';
    if (els.pptx) els.pptx.innerHTML = '';
    if (els.text) els.text.textContent = '';
}
