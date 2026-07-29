// XHR-based sequential uploader (ported from static/app/files.js's upload
// progress panel). fetch() still has no upload-progress event, so uploads use
// XMLHttpRequest to drive the per-row circular progress + per-row cancel.

import { useCallback, useRef, useState } from 'react'
import { toast } from '../lib'

export type UploadStatus = 'uploading' | 'done' | 'error' | 'cancelled'

export interface UploadRow {
  id: string
  name: string
  size: number
  progress: number // 0..1
  status: UploadStatus
  message?: string
}

interface XhrResult {
  ok: boolean
  status: number
  body: { error?: string }
  aborted?: boolean
}

function uploadOneXHR(
  file: File,
  folderId: number | null,
  xhrRef: XMLHttpRequest,
  onProgress: (p: number) => void,
): Promise<XhrResult> {
  return new Promise((resolve) => {
    const fd = new FormData()
    fd.append('file', file)
    if (folderId != null) fd.append('folder_id', String(folderId))
    xhrRef.open('POST', '/api/files/upload')
    xhrRef.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhrRef.onload = () => {
      let body: { error?: string } = {}
      try {
        body = JSON.parse(xhrRef.responseText || '{}')
      } catch {
        /* non-json */
      }
      const ok = xhrRef.status >= 200 && xhrRef.status < 300
      resolve({ ok, status: xhrRef.status, body })
    }
    xhrRef.onerror = () => resolve({ ok: false, status: 0, body: { error: 'network error' } })
    xhrRef.onabort = () =>
      resolve({ ok: false, status: 0, body: { error: 'aborted' }, aborted: true })
    xhrRef.send(fd)
  })
}

export interface Uploader {
  rows: UploadRow[]
  panelVisible: boolean
  collapsed: boolean
  active: number
  title: string
  uploadFiles: (files: File[], folderId: number | null, destName: string) => Promise<void>
  cancelUpload: (rowId: string) => void
  closePanel: () => void
  toggleCollapse: () => void
}

export function useUploader(onBatchSettled: () => void): Uploader {
  const [rows, setRows] = useState<UploadRow[]>([])
  const [panelVisible, setPanelVisible] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [active, setActive] = useState(0)
  const [total, setTotal] = useState(0)
  const activeUploads = useRef<Map<string, XMLHttpRequest>>(new Map())

  const patchRow = useCallback((rowId: string, patch: Partial<UploadRow>) => {
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, ...patch } : r)))
  }, [])

  const uploadFiles = useCallback(
    async (files: File[], folderId: number | null, destName: string) => {
      const batchTotal = files.length
      const initialRows: UploadRow[] = files.map((f, i) => ({
        id: `upl-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
        name: f.name,
        size: f.size,
        progress: 0,
        status: 'uploading',
      }))
      setRows(initialRows)
      setTotal(batchTotal)
      setActive(batchTotal)
      setPanelVisible(true)
      setCollapsed(false)

      let ok = 0
      let cancelled = 0
      let remaining = batchTotal
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        const rowId = initialRows[i].id
        const xhr = new XMLHttpRequest()
        activeUploads.current.set(rowId, xhr)
        const res = await uploadOneXHR(f, folderId, xhr, (p) => {
          patchRow(rowId, { progress: Math.max(0, Math.min(1, p)) })
        })
        activeUploads.current.delete(rowId)
        if (res.ok) {
          ok++
          patchRow(rowId, { status: 'done', progress: 1 })
        } else if (res.aborted) {
          cancelled++
          patchRow(rowId, { status: 'cancelled' })
        } else {
          const msg = res.body?.error || `Failed (${res.status || 'network'})`
          patchRow(rowId, { status: 'error', message: msg })
        }
        remaining--
        setActive(remaining)
      }

      if (ok) toast(`Uploaded ${ok} file${ok === 1 ? '' : 's'} to ${destName}`)
      if (cancelled) toast(`${cancelled} upload${cancelled === 1 ? '' : 's'} cancelled`)
      const failed = batchTotal - ok - cancelled
      if (failed > 0) toast(`${failed} upload${failed === 1 ? '' : 's'} failed`, 'error')
      onBatchSettled()
    },
    [patchRow, onBatchSettled],
  )

  const cancelUpload = useCallback((rowId: string) => {
    const xhr = activeUploads.current.get(rowId)
    if (xhr) {
      try {
        xhr.abort()
      } catch {
        /* ignore */
      }
    }
  }, [])

  const closePanel = useCallback(() => {
    if (active > 0) return // block close while uploading
    setPanelVisible(false)
    setRows([])
  }, [active])

  const toggleCollapse = useCallback(() => setCollapsed((c) => !c), [])

  const title =
    active > 0 ? `Uploading ${active} of ${total}…` : `Uploaded ${total} file${total === 1 ? '' : 's'}`

  return {
    rows,
    panelVisible,
    collapsed,
    active,
    title,
    uploadFiles,
    cancelUpload,
    closePanel,
    toggleCollapse,
  }
}
