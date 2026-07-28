// Add-Project modal — replaces the vanilla static/app/dashboard.js
// openAddProjectModal/confirmAddProjectRole pair (window.openAddProjectModal
// bridge). Fully owned by ProjectRoles.tsx: local to the calling component,
// no window globals. POST /api/projects/{id}/assign, then the caller
// dispatches `mwl:dashboard` to refresh both the individual and team views.
import { useEffect, useState } from 'react'
import type { ProjectRow } from '../lib'
import { api, t, toast } from '../lib'

export type RoleType = 'main' | 'support'

interface ProjectRoleModalProps {
  memberId: string
  type: RoleType
  onClose: () => void
  onAdded: () => void
}

export function ProjectRoleModal({ memberId, type, onClose, onAdded }: ProjectRoleModalProps) {
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [selected, setSelected] = useState('')

  useEffect(() => {
    let alive = true
    api<ProjectRow[]>('/api/projects').then((r) => {
      if (alive) setProjects(r.data ?? [])
    })
    return () => {
      alive = false
    }
  }, [])

  const confirm = async () => {
    if (!selected) {
      toast(t('toast.select_project') || 'Select a project', 'error')
      return
    }
    const res = await api(`/api/projects/${selected}/assign`, {
      json: { member_id: memberId, type },
    })
    if (res.ok) {
      toast(t('toast.project_added') || 'Project added')
      onAdded()
      onClose()
    } else {
      toast(res.error || 'Add failed', 'error')
    }
  }

  const title =
    type === 'main'
      ? t('modal.add_main_project') || 'Add Main Project'
      : t('modal.add_support_project') || 'Add Support Project'

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <select
          className="input-field w-full mb-5"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">— Select a project —</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            {t('modal.cancel') || 'Cancel'}
          </button>
          <button type="button" onClick={confirm} className="btn-primary">
            {t('set.add') || 'Add'}
          </button>
        </div>
      </div>
    </div>
  )
}
