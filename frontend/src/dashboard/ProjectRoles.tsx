// Project-role tags (Main / Support) for the individual dashboard. Reads
// GET /api/members/{id}/project-roles. The "+" opens the React-owned
// ProjectRoleModal (local state, no window bridge) — after it commits it
// fires `mwl:dashboard`, which the parent island already listens for. Removing
// a tag is React-owned: POST /api/projects/{id}/unassign, then dispatch
// `mwl:dashboard` so both the individual and team views refresh.
import { useState } from 'react'
import type { ProjectRef, ProjectRolesResp } from '../lib'
import { api, t, toast } from '../lib'
import type { RoleType } from './ProjectRoleModal'
import { ProjectRoleModal } from './ProjectRoleModal'

interface RoleColumnProps {
  label: string
  tone: RoleType
  memberId: string
  items: ProjectRef[]
  canManage: boolean
  onAdd: () => void
}

async function removeRole(pid: number, type: RoleType, memberId: string): Promise<void> {
  const res = await api(`/api/projects/${pid}/unassign`, {
    json: { member_id: memberId, type },
  })
  if (res.ok) {
    toast(t('toast.project_removed') || 'Project removed')
    window.dispatchEvent(new Event('mwl:dashboard'))
  } else {
    toast(res.error || 'Remove failed', 'error')
  }
}

function RoleColumn({ label, tone, memberId, items, canManage, onAdd }: RoleColumnProps) {
  return (
    <div className="mwl-proles__col">
      <div className="mwl-proles__head">
        <span className={`mwl-ptag mwl-ptag--${tone} mwl-ptag--label`}>{label}</span>
        {canManage ? (
          <button
            type="button"
            className="mwl-addbtn"
            title={`Add ${label.toLowerCase()} project`}
            aria-label={`Add ${label.toLowerCase()} project`}
            onClick={onAdd}
          >
            +
          </button>
        ) : null}
      </div>
      <div className="mwl-proles__tags">
        {items.length ? (
          items.map((p) => (
            <span className={`mwl-ptag mwl-ptag--${tone}`} key={p.id}>
              {p.name}
              {canManage ? (
                <button
                  type="button"
                  className="mwl-ptag__x"
                  title="Remove"
                  aria-label={`Remove ${p.name}`}
                  onClick={() => removeRole(p.id, tone, memberId)}
                >
                  ×
                </button>
              ) : null}
            </span>
          ))
        ) : (
          <span className="mwl-proles__empty">—</span>
        )}
      </div>
    </div>
  )
}

interface ProjectRolesProps {
  memberId: string
  roles: ProjectRolesResp
  canManage: boolean
}

export function ProjectRoles({ memberId, roles, canManage }: ProjectRolesProps) {
  const [addType, setAddType] = useState<RoleType | null>(null)

  return (
    <div className="mwl-proles">
      <RoleColumn
        label={t('dash.main_project') || 'Main Project'}
        tone="main"
        memberId={memberId}
        items={roles.main}
        canManage={canManage}
        onAdd={() => setAddType('main')}
      />
      <RoleColumn
        label={t('dash.support') || 'Support'}
        tone="support"
        memberId={memberId}
        items={roles.support}
        canManage={canManage}
        onAdd={() => setAddType('support')}
      />
      {addType ? (
        <ProjectRoleModal
          memberId={memberId}
          type={addType}
          onClose={() => setAddType(null)}
          onAdded={() => window.dispatchEvent(new Event('mwl:dashboard'))}
        />
      ) : null}
    </div>
  )
}
