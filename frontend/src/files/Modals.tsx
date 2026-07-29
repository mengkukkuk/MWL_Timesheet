// Files island dialogs (ported from static/app/files.js + app.html modal
// markup): New Folder, Edit Folder (name + classified), Edit File (classified),
// and the Recent Uploads list. Each is controlled by FilesIsland state.

import { useEffect, useState } from 'react'
import { t } from '../lib'
import { fmtBytes, fmtDateShort } from './helpers'
import type { FileEntry, FolderSummary, RecentUpload } from './types'

// ── New Folder ──
interface NewFolderModalProps {
  open: boolean
  parentName: string | null
  onClose: () => void
  onCreate: (name: string) => void
}

export function NewFolderModal({ open, parentName, onClose, onCreate }: NewFolderModalProps) {
  const [name, setName] = useState('')
  useEffect(() => {
    if (open) setName('')
  }, [open])
  if (!open) return null
  const hint = parentName ? `Will be created inside "${parentName}"` : 'Will be created at Root'
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800">
            {t('files.new_folder_title') || 'New Folder'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <CloseIcon />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const v = name.trim()
            if (v) onCreate(v)
          }}
        >
          <label className="label">{t('files.folder_name') || 'Folder name'}</label>
          <input
            type="text"
            className="input-field w-full"
            maxLength={200}
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <p className="text-xs text-gray-500 mt-2">{hint}</p>
          <div className="flex justify-end gap-2 mt-4">
            <button type="button" onClick={onClose} className="btn-secondary text-sm px-3 py-1.5">
              {t('btn.cancel') || 'Cancel'}
            </button>
            <button type="submit" className="btn-primary text-sm px-3 py-1.5">
              {t('btn.create') || 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Edit Folder ──
interface FolderEditModalProps {
  folder: FolderSummary | null
  onClose: () => void
  onSave: (name: string, isClassified: boolean) => void
}

export function FolderEditModal({ folder, onClose, onSave }: FolderEditModalProps) {
  const [name, setName] = useState('')
  const [classified, setClassified] = useState(false)
  useEffect(() => {
    if (folder) {
      setName(folder.name || '')
      setClassified(!!folder.is_classified)
    }
  }, [folder])
  if (!folder) return null
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800">
            {t('files.edit_folder_title') || 'Edit Folder'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <CloseIcon />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onSave(name.trim(), classified)
          }}
        >
          <label className="label">{t('files.folder_name') || 'Folder name'}</label>
          <input
            type="text"
            className="input-field w-full"
            maxLength={200}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <label className="flex items-center gap-2 mt-3 text-sm">
            <input
              type="checkbox"
              checked={classified}
              onChange={(e) => setClassified(e.target.checked)}
            />
            <span>{t('files.classified') || 'Classified (elevated only)'}</span>
          </label>
          <p className="text-xs text-gray-500 mt-1">
            {t('files.classified_hint') || 'Classified items are hidden from Staff.'}
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <button type="button" onClick={onClose} className="btn-secondary text-sm px-3 py-1.5">
              {t('btn.cancel') || 'Cancel'}
            </button>
            <button type="submit" className="btn-primary text-sm px-3 py-1.5">
              {t('btn.save') || 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Edit File ──
interface FileEditModalProps {
  file: FileEntry | null
  onClose: () => void
  onSave: (isClassified: boolean) => void
}

export function FileEditModal({ file, onClose, onSave }: FileEditModalProps) {
  const [classified, setClassified] = useState(false)
  useEffect(() => {
    if (file) setClassified(!!file.is_classified)
  }, [file])
  if (!file) return null
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800">
            {t('files.edit_file_title') || 'Edit File'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <CloseIcon />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onSave(classified)
          }}
        >
          <p className="text-sm font-medium text-gray-700 break-all">{file.original_name}</p>
          <label className="flex items-center gap-2 mt-3 text-sm">
            <input
              type="checkbox"
              checked={classified}
              onChange={(e) => setClassified(e.target.checked)}
            />
            <span>{t('files.classified') || 'Classified (elevated only)'}</span>
          </label>
          <p className="text-xs text-gray-500 mt-1">
            {t('files.classified_hint') || 'Classified items are hidden from Staff.'}
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <button type="button" onClick={onClose} className="btn-secondary text-sm px-3 py-1.5">
              {t('btn.cancel') || 'Cancel'}
            </button>
            <button type="submit" className="btn-primary text-sm px-3 py-1.5">
              {t('btn.save') || 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Recent Uploads ──
interface RecentModalProps {
  open: boolean
  rows: RecentUpload[] | undefined
  loading: boolean
  onClose: () => void
}

export function RecentModal({ open, rows, loading, onClose }: RecentModalProps) {
  if (!open) return null
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: '42rem' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-gray-800">Recent Uploads</h3>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 rounded">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <div id="file-recent-body" className="max-h-[28rem] overflow-y-auto divide-y divide-gray-100">
          {loading ? (
            <p className="text-sm text-gray-400 px-2 py-4 text-center">Loading…</p>
          ) : !rows || !rows.length ? (
            <p className="text-sm text-gray-400 px-2 py-4 text-center">No recent uploads.</p>
          ) : (
            rows.map((r) => (
              <div key={r.id} className="recent-row">
                <svg
                  className="w-5 h-5 text-gray-400 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                <div className="recent-row-info">
                  <p className="recent-row-name" title={r.original_name}>
                    {r.original_name}
                  </p>
                  <p className="recent-row-meta">
                    {fmtBytes(r.size_bytes)} · {r.uploaded_by_name || ''} · {r.folder_name || 'Root'} ·{' '}
                    {fmtDateShort(r.uploaded_at)}
                  </p>
                </div>
                <a
                  href={`/api/files/${r.id}/download`}
                  className="text-xs text-indigo-600 hover:underline"
                >
                  Download
                </a>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function CloseIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}
