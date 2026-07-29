// File preview lightbox (ported from static/app/files.js openFilePreview /
// closeFilePreview + the modal markup in app.html). Images render inline with a
// zoom toggle; documents delegate to renderDocumentPreview in preview.ts, which
// lazy-loads the vendor lib for the specific file type.

import { useEffect, useRef, useState } from 'react'
import { isImageMime } from './helpers'
import { cleanupDocumentPreview, renderDocumentPreview, type PreviewEls } from './preview'
import type { FileEntry } from './types'

interface PreviewModalProps {
  file: FileEntry | null
  onClose: () => void
}

export function PreviewModal({ file, onClose }: PreviewModalProps) {
  const [zoomed, setZoomed] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  const pdfRef = useRef<HTMLIFrameElement>(null)
  const docxRef = useRef<HTMLDivElement>(null)
  const xlsxRef = useRef<HTMLDivElement>(null)
  const pptxRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLPreElement>(null)
  const loadingRef = useRef<HTMLParagraphElement>(null)
  const unsupportedRef = useRef<HTMLParagraphElement>(null)

  const isImg = !!file && isImageMime(file.mime_type)

  useEffect(() => {
    if (!file) return
    setZoomed(false)
    if (isImg) return // image path is pure React below
    const els: PreviewEls = {
      pdf: pdfRef.current,
      docx: docxRef.current,
      xlsx: xlsxRef.current,
      pptx: pptxRef.current,
      text: textRef.current,
      loading: loadingRef.current,
      unsupported: unsupportedRef.current,
    }
    if (loadingRef.current) loadingRef.current.classList.remove('hidden')
    renderDocumentPreview(file, els)
    return () => {
      cleanupDocumentPreview(els)
    }
  }, [file, isImg])

  if (!file) return null

  return (
    <div
      id="file-preview-modal"
      className="modal-overlay"
      onClick={(e) => {
        if ((e.target as HTMLElement).id === 'file-preview-modal') onClose()
      }}
    >
      <div className="file-preview-content" onClick={(e) => e.stopPropagation()}>
        <div className="file-preview-header">
          <span id="file-preview-name" className="text-sm font-medium text-gray-700 truncate">
            {file.original_name || ''}
          </span>
          <div className="flex items-center gap-1">
            <a
              id="file-preview-download"
              href={`/api/files/${file.id}/download`}
              download
              className="text-xs px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded inline-flex items-center gap-1"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3"
                />
              </svg>
              Download
            </a>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
        <div className={`file-preview-body ${!isImg ? 'doc-mode' : ''} ${zoomed ? 'preview-zoomed' : ''}`}>
          <img
            ref={imgRef}
            id="file-preview-img"
            alt=""
            className={isImg ? (zoomed ? 'zoomed' : '') : 'hidden'}
            src={isImg ? `/api/files/${file.id}/download?inline=1` : undefined}
            onClick={() => isImg && setZoomed((z) => !z)}
          />
          <iframe ref={pdfRef} id="file-preview-pdf" className="hidden" title="PDF preview" />
          <div ref={docxRef} id="file-preview-docx" className="hidden file-preview-doc" />
          <div
            ref={xlsxRef}
            id="file-preview-xlsx"
            className="hidden file-preview-doc file-preview-xlsx"
          />
          <div
            ref={pptxRef}
            id="file-preview-pptx"
            className="hidden file-preview-doc file-preview-pptx"
          />
          <pre ref={textRef} id="file-preview-text" className="hidden file-preview-doc file-preview-text" />
          <p ref={loadingRef} id="file-preview-loading" className="hidden file-preview-msg">
            Loading preview&hellip;
          </p>
          <p ref={unsupportedRef} id="file-preview-unsupported" className="hidden file-preview-msg">
            Preview not available for this file type.
          </p>
        </div>
      </div>
    </div>
  )
}
