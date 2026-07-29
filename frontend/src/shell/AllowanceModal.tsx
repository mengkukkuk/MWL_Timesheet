// Presentational Add/Edit Allowance modal, ported from
// static/app/allowance.js#openAddAllowance / editAllowance / saveAllowance.
// Type is fixed to 'Normal' (the vanilla al-type field is hidden and always
// 'Normal'); only date + project are user-editable. Driven entirely by props.
import { useEffect, useState } from 'react'
import { t } from '../lib'

export interface AllowanceDraft {
  id: string
  log_date: string
  project: string
}

interface AllowanceModalProps {
  mode: 'add' | 'edit'
  initial: AllowanceDraft
  projectOptions: string[]
  saving: boolean
  onClose: () => void
  onSubmit: (draft: AllowanceDraft) => void
}

export function AllowanceModal({
  mode,
  initial,
  projectOptions,
  saving,
  onClose,
  onSubmit,
}: AllowanceModalProps) {
  const [logDate, setLogDate] = useState(initial.log_date)
  const [project, setProject] = useState(initial.project)

  useEffect(() => {
    setLogDate(initial.log_date)
    setProject(initial.project)
  }, [initial])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit({ id: initial.id, log_date: logDate, project })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800">
            {mode === 'edit' ? t('al.modal_edit_title') : t('al.modal_add_title')}
          </h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="label">{t('al.col_date')}</label>
              <input
                type="date"
                className="input-field w-full"
                required
                value={logDate}
                onChange={(e) => setLogDate(e.target.value)}
              />
            </div>
            <div>
              <label className="label">{t('al.col_project')}</label>
              <select
                className="input-field w-full"
                value={project}
                onChange={(e) => setProject(e.target.value)}
              >
                <option value="">Select...</option>
                {projectOptions.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button type="button" onClick={onClose} className="btn-secondary">
              {t('modal.cancel')}
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {t('modal.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
