// Google-Drive-style upload progress panel (ported from static/app/files.js's
// upload-panel + per-row circular progress). Reads the useUploader hook state
// owned by FilesIsland; renders per-row SVG progress and per-row cancel.

import { fmtBytes } from './helpers'
import type { Uploader, UploadRow } from './useUploader'

const UPLOAD_R = 13 // SVG circle radius
const UPLOAD_C = 2 * Math.PI * UPLOAD_R // circumference

interface UploadPanelProps {
  uploader: Uploader
}

function UploadRowView({
  row,
  onCancel,
}: {
  row: UploadRow
  onCancel: (rowId: string) => void
}) {
  const pct = Math.max(0, Math.min(1, row.progress))
  const isError = row.status === 'error' || row.status === 'cancelled'
  return (
    <div id={row.id} className={`upload-row ${isError ? 'error' : ''}`}>
      <div className="upload-row-info">
        <p className="upload-row-name" title={row.name}>
          {row.name}
        </p>
        <p className="upload-row-meta">{rowMeta(row, pct)}</p>
      </div>
      <div className="upload-row-status">{rowStatusSvg(row, pct)}</div>
      {row.status === 'uploading' && (
        <button
          type="button"
          className="upload-row-cancel"
          onClick={() => onCancel(row.id)}
          title="Cancel upload"
          aria-label="Cancel upload"
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}
    </div>
  )
}

function rowMeta(row: UploadRow, pct: number): string {
  switch (row.status) {
    case 'done':
      return `Done · ${fmtBytes(row.size)}`
    case 'cancelled':
      return `Cancelled · ${fmtBytes(row.size)}`
    case 'error':
      return row.message || 'Failed'
    default:
      return `${Math.round(pct * 100)}% · ${fmtBytes(row.size)}`
  }
}

function rowStatusSvg(row: UploadRow, pct: number) {
  if (row.status === 'done') {
    return (
      <svg viewBox="0 0 32 32" width="32" height="32">
        <circle cx="16" cy="16" r="14" fill="#d1fae5" />
        <path
          d="M10 16 l4 4 l8 -8"
          fill="none"
          stroke="#059669"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  if (row.status === 'cancelled') {
    return (
      <svg viewBox="0 0 32 32" width="32" height="32">
        <circle cx="16" cy="16" r="14" fill="#fef3c7" />
        <path
          d="M11 11 l10 10 M21 11 l-10 10"
          fill="none"
          stroke="#b45309"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  if (row.status === 'error') {
    return (
      <svg viewBox="0 0 32 32" width="32" height="32">
        <circle cx="16" cy="16" r="14" fill="#fee2e2" />
        <path
          d="M11 11 l10 10 M21 11 l-10 10"
          fill="none"
          stroke="#dc2626"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 32 32" width="32" height="32" className="upload-progress-svg">
      <circle className="upload-progress-track" cx="16" cy="16" r={UPLOAD_R} />
      <circle
        className="upload-progress-bar"
        cx="16"
        cy="16"
        r={UPLOAD_R}
        strokeDasharray={UPLOAD_C}
        strokeDashoffset={UPLOAD_C * (1 - pct)}
      />
    </svg>
  )
}

export function UploadPanel({ uploader }: UploadPanelProps) {
  const { rows, panelVisible, collapsed, active, title, cancelUpload, closePanel, toggleCollapse } =
    uploader
  if (!panelVisible) return null
  return (
    <div
      id="upload-panel"
      className={`upload-panel ${collapsed ? 'collapsed' : ''}`}
      data-active={String(active)}
    >
      <header className="upload-panel-header">
        <span id="upload-panel-title">{title}</span>
        <div className="upload-panel-actions">
          <button
            type="button"
            id="upload-panel-collapse"
            className="upload-panel-btn"
            title="Collapse"
            onClick={toggleCollapse}
          >
            <svg
              className="upload-panel-collapse-icon"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <button
            type="button"
            id="upload-panel-close"
            className="upload-panel-btn"
            title="Close"
            disabled={active > 0}
            onClick={closePanel}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </header>
      <div id="upload-panel-body" className="upload-panel-body">
        {rows.map((row) => (
          <UploadRowView key={row.id} row={row} onCancel={cancelUpload} />
        ))}
      </div>
    </div>
  )
}
