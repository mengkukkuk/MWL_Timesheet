// React bulk-edit modal for the Work Log island (PR3). Replaces the vanilla
// #wl-bulk-edit-modal + confirmBulkEdit() flow, which fired N sequential PUTs
// and — because it read the wrong field names (w.projects / w.description
// instead of w.project / w.project_description) — blanked the project on every
// edited row whenever "apply project" was unchecked. This submits only the
// checked fields to PATCH /api/worklogs/bulk (BE-1), so unchecked fields are
// never touched server-side. Markup mirrors the vanilla modal (same
// modal-overlay / input-field / label / btn-* classes) for a zero visual diff.
import { useState } from 'react'
import { t } from '../lib'
import { useDescriptions } from './useWorklogsData'

export interface BulkFields {
  project?: string
  status?: string
  note?: string
}

interface BulkEditModalProps {
  count: number
  submitting: boolean
  onClose: () => void
  onSubmit: (fields: BulkFields) => void
}

export function BulkEditModal({ count, submitting, onClose, onSubmit }: BulkEditModalProps) {
  const { data: descriptions } = useDescriptions()
  const [applyProject, setApplyProject] = useState(false)
  const [applyStatus, setApplyStatus] = useState(false)
  const [applyNote, setApplyNote] = useState(false)
  const [project, setProject] = useState('')
  const [status, setStatus] = useState('Done')
  const [note, setNote] = useState('')

  const projectOptions = (descriptions ?? []).filter(
    (p) => p.Status !== 'Closed' && p.Status !== 'Hold',
  )

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const fields: BulkFields = {}
    if (applyProject) fields.project = project
    if (applyStatus) fields.status = status
    if (applyNote) fields.note = note
    onSubmit(fields)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800">
            {t('wl.bulk_edit_title') || 'Bulk Edit Selected Entries'}
          </h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          <span>{t('wl.bulk_edit_hint') || 'Only checked fields will be applied.'}</span>{' '}
          <span className="text-indigo-600 font-medium">({count})</span>
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="bulk-apply-project"
              className="rounded"
              checked={applyProject}
              onChange={(e) => setApplyProject(e.target.checked)}
            />
            <label htmlFor="bulk-apply-project" className="label mb-0 flex-shrink-0 w-24">
              {t('modal.project') || 'Project'}
            </label>
            <select
              className="input-field w-full"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              disabled={!applyProject}
            >
              <option value="">Select...</option>
              {projectOptions.map((p) => (
                <option key={p.Description} value={p.Description}>
                  {p.Description}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="bulk-apply-status"
              className="rounded"
              checked={applyStatus}
              onChange={(e) => setApplyStatus(e.target.checked)}
            />
            <label htmlFor="bulk-apply-status" className="label mb-0 flex-shrink-0 w-24">
              {t('modal.status') || 'Status'}
            </label>
            <select
              className="input-field w-full"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              disabled={!applyStatus}
            >
              <option value="Pending">Pending</option>
              <option value="In Progress">In Progress</option>
              <option value="Done">Done</option>
              <option value="Man day">Man day</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="bulk-apply-note"
              className="rounded"
              checked={applyNote}
              onChange={(e) => setApplyNote(e.target.checked)}
            />
            <label htmlFor="bulk-apply-note" className="label mb-0 flex-shrink-0 w-24">
              {t('modal.note') || 'Note'}
            </label>
            <input
              type="text"
              className="input-field w-full"
              placeholder={t('modal.note_ph') || 'Optional note'}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={!applyNote}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary text-sm px-3 py-1.5">
              {t('btn.cancel') || 'Cancel'}
            </button>
            <button
              type="submit"
              className="btn-primary text-sm px-3 py-1.5"
              disabled={submitting || (!applyProject && !applyStatus && !applyNote)}
            >
              {t('modal.save') || 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
