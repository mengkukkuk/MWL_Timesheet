// Document preview module — renders PDF/DOCX/XLSX/PPTX/plain-text files inline
// in the File Share preview modal. Ported from static/app/file-preview.js.
// Vendor libraries are lazy-loaded per file type so opening the Files tab never
// pulls in these (fairly large) parsers.

import type { FileEntry } from './types'

interface PreviewEls {
  pdf: HTMLIFrameElement | null
  docx: HTMLElement | null
  xlsx: HTMLElement | null
  pptx: HTMLElement | null
  text: HTMLElement | null
  loading: HTMLElement | null
  unsupported: HTMLElement | null
}

interface DocxLib {
  renderAsync: (
    buf: ArrayBuffer,
    body: HTMLElement,
    style: HTMLElement,
    opts: { inWrapper: boolean },
  ) => Promise<void>
}
interface XlsxWorkbook {
  SheetNames: string[]
  Sheets: Record<string, unknown>
}
interface XlsxLib {
  read: (buf: ArrayBuffer, opts: { type: string }) => XlsxWorkbook
  utils: { sheet_to_html: (sheet: unknown) => string }
}
interface PptxInstance {
  load: (buf: ArrayBuffer) => Promise<void>
  destroy: () => void
}
interface PptxLib {
  PPTXViewer: new (
    host: HTMLElement,
    opts: { showControls: boolean; keyboardNavigation: boolean },
  ) => PptxInstance
}

type VendorWindow = Window & {
  docx?: DocxLib
  XLSX?: XlsxLib
  PPTXViewer?: PptxLib
}

const vendorScriptPromises: Record<string, Promise<void> | undefined> = Object.create(null)

function loadVendorScript(src: string): Promise<void> {
  const existing = vendorScriptPromises[src]
  if (existing) return existing
  vendorScriptPromises[src] = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.async = false
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(`failed to load ${src}`))
    document.head.appendChild(s)
  })
  return vendorScriptPromises[src]
}

const PREVIEW_VENDORS = {
  jszip: 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
  docx: 'https://cdn.jsdelivr.net/npm/docx-preview@0.4.0/dist/docx-preview.min.js',
  xlsx: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  pptx: 'https://cdn.jsdelivr.net/npm/pptx-viewer@0.2.2/dist/pptx-viewer.umd.js',
}

const TEXT_EXTENSIONS = new Set([
  'txt', 'log', 'md', 'markdown', 'csv', 'json', 'ini', 'conf', 'yaml', 'yml', 'xml',
])

function fileExt(name: string): string {
  const parts = (name || '').split('.')
  return parts.length > 1 ? (parts.pop() as string).toLowerCase() : ''
}

// Kept in sync with the lightweight isPreviewableDoc() in helpers.ts.
function documentKind(mime: string | null, name: string): string | null {
  const ext = fileExt(name)
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  if (ext === 'xlsx' || ext === 'xls' || mime === 'application/vnd.ms-excel') return 'xlsx'
  if (ext === 'pptx') return 'pptx'
  if ((mime && mime.startsWith('text/')) || TEXT_EXTENSIONS.has(ext)) return 'text'
  return null
}

let pptxViewerInstance: PptxInstance | null = null

function hideAllPanels(els: PreviewEls): void {
  ;(['docx', 'xlsx', 'pptx', 'text', 'loading', 'unsupported'] as const).forEach((key) => {
    const el = els[key]
    if (el) el.classList.add('hidden')
  })
}

function escapeHtml(s: unknown): string {
  const d = document.createElement('div')
  d.textContent = s == null ? '' : String(s)
  return d.innerHTML
}

function renderWorkbookTabs(wb: XlsxWorkbook, xlsxLib: XlsxLib): string {
  const names = wb.SheetNames || []
  if (!names.length) return '<p class="text-sm text-gray-400 p-4">Workbook has no sheets.</p>'
  const tabs = names
    .map(
      (name, i) => `
        <button type="button" class="xlsx-tab ${i === 0 ? 'active' : ''}" data-sheet-idx="${i}">${escapeHtml(name)}</button>
      `,
    )
    .join('')
  const panels = names
    .map((name, i) => {
      const html = xlsxLib.utils.sheet_to_html(wb.Sheets[name])
      return `<div class="xlsx-sheet-panel ${i === 0 ? '' : 'hidden'}" data-sheet-panel="${i}">${html}</div>`
    })
    .join('')
  return `<div class="xlsx-tabs">${tabs}</div><div class="xlsx-panels">${panels}</div>`
}

// Delegated tab switching for multi-sheet workbooks, scoped to the xlsx host.
function wireXlsxTabs(host: HTMLElement): void {
  host.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement
    const btn = target.closest('.xlsx-tab') as HTMLElement | null
    if (!btn) return
    const tabsHost = btn.closest('.xlsx-tabs') as HTMLElement | null
    const panelsHost = tabsHost && (tabsHost.nextElementSibling as HTMLElement | null)
    if (!tabsHost || !panelsHost) return
    const idx = btn.getAttribute('data-sheet-idx')
    tabsHost.querySelectorAll('.xlsx-tab').forEach((b) => b.classList.toggle('active', b === btn))
    panelsHost.querySelectorAll('.xlsx-sheet-panel').forEach((p) => {
      p.classList.toggle('hidden', p.getAttribute('data-sheet-panel') !== idx)
    })
  })
}

// Renders `file` into the appropriate panel of `els`. Assumes the image panel
// has already been ruled out by the caller.
export async function renderDocumentPreview(file: FileEntry, els: PreviewEls): Promise<void> {
  const kind = documentKind(file.mime_type, file.original_name)
  hideAllPanels(els)

  if (!kind) {
    if (els.loading) els.loading.classList.add('hidden')
    if (els.unsupported) {
      els.unsupported.textContent = 'Preview not available for this file type.'
      els.unsupported.classList.remove('hidden')
    }
    return
  }

  const url = `/api/files/${file.id}/download?inline=1`
  const w = window as VendorWindow

  // PDFs render natively — no vendor lib, just point the iframe.
  if (kind === 'pdf') {
    if (els.loading) els.loading.classList.add('hidden')
    if (els.pdf) {
      els.pdf.src = url
      els.pdf.classList.remove('hidden')
    }
    return
  }

  try {
    const res = await fetch(url, { credentials: 'same-origin' })
    if (!res.ok) throw new Error(`download failed (${res.status})`)
    const buf = await res.arrayBuffer()

    if (kind === 'docx') {
      await loadVendorScript(PREVIEW_VENDORS.jszip)
      await loadVendorScript(PREVIEW_VENDORS.docx)
      if (els.docx && w.docx) {
        els.docx.innerHTML = ''
        await w.docx.renderAsync(buf, els.docx, els.docx, { inWrapper: true })
        els.docx.classList.remove('hidden')
      }
    } else if (kind === 'xlsx') {
      await loadVendorScript(PREVIEW_VENDORS.xlsx)
      if (els.xlsx && w.XLSX) {
        const wb = w.XLSX.read(buf, { type: 'array' })
        els.xlsx.innerHTML = renderWorkbookTabs(wb, w.XLSX)
        wireXlsxTabs(els.xlsx)
        els.xlsx.classList.remove('hidden')
      }
    } else if (kind === 'pptx') {
      await loadVendorScript(PREVIEW_VENDORS.pptx)
      if (els.pptx && w.PPTXViewer) {
        els.pptx.innerHTML = ''
        if (pptxViewerInstance) {
          try {
            pptxViewerInstance.destroy()
          } catch {
            /* already gone */
          }
        }
        pptxViewerInstance = new w.PPTXViewer.PPTXViewer(els.pptx, {
          showControls: true,
          keyboardNavigation: true,
        })
        await pptxViewerInstance.load(buf)
        els.pptx.classList.remove('hidden')
      }
    } else if (kind === 'text') {
      if (els.text) {
        els.text.textContent = new TextDecoder('utf-8').decode(buf)
        els.text.classList.remove('hidden')
      }
    }
  } catch (e) {
    if (els.unsupported) {
      els.unsupported.textContent = `Preview failed: ${e instanceof Error ? e.message : String(e)}`
      els.unsupported.classList.remove('hidden')
    }
  } finally {
    if (els.loading) els.loading.classList.add('hidden')
  }
}

// Called when the preview modal closes, to release the pptx viewer instance
// and clear rendered content from the DOM.
export function cleanupDocumentPreview(els: PreviewEls): void {
  if (pptxViewerInstance) {
    try {
      pptxViewerInstance.destroy()
    } catch {
      /* already gone */
    }
    pptxViewerInstance = null
  }
  if (els.pdf) els.pdf.src = 'about:blank'
  if (els.docx) els.docx.innerHTML = ''
  if (els.xlsx) els.xlsx.innerHTML = ''
  if (els.pptx) els.pptx.innerHTML = ''
  if (els.text) els.text.textContent = ''
}

export type { PreviewEls }
