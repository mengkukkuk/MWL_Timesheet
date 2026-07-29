// Formatting + mime helpers ported verbatim from static/app/files.js so the
// Files island renders byte counts, dates, and preview affordances identically.

export function fmtBytes(n: number | null | undefined): string {
  if (n == null) return ''
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}

export function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return (
      d.toLocaleDateString() +
      ' ' +
      d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    )
  } catch {
    return iso
  }
}

export function isImageMime(mime: string | null | undefined): boolean {
  return typeof mime === 'string' && mime.startsWith('image/')
}

// Lightweight, dependency-free check used at row-render time to decide whether
// to show the Preview affordance. Kept in sync with the heavier documentKind()
// in preview.ts, which only loads the vendor lib once a preview is opened.
const PREVIEWABLE_DOC_EXTS = new Set([
  'pdf', 'docx', 'xlsx', 'xls', 'pptx', 'txt', 'log', 'md', 'markdown',
  'csv', 'json', 'ini', 'conf', 'yaml', 'yml', 'xml',
])

export function isPreviewableDoc(mime: string | null | undefined, name: string): boolean {
  const parts = (name || '').split('.')
  const ext = parts.length > 1 ? (parts.pop() as string).toLowerCase() : ''
  if (mime === 'application/pdf' || mime === 'application/vnd.ms-excel') return true
  if (typeof mime === 'string' && mime.startsWith('text/')) return true
  return PREVIEWABLE_DOC_EXTS.has(ext)
}
