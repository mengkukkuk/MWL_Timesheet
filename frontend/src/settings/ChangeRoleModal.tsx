// Change Role modal (Super_Ultimate_ADMIN only). Ported from app.html's
// #change-role-overlay markup + static/app/settings.js's
// openChangeRoleModal/_updateRoleRadioStyles/saveChangeRole.

import { useEffect, useState } from 'react'
import { ASSIGNABLE_ROLES, type AssignableRole } from './types'

const ROLE_DESCRIPTIONS: Record<AssignableRole, string> = {
  Admin: 'Department administrator',
  Leader: 'Team lead',
  Staff: 'Regular staff member',
}

const ROLE_TEXT_CLASS: Record<AssignableRole, string> = {
  Admin: 'text-orange-600',
  Leader: 'text-blue-600',
  Staff: 'text-gray-600',
}

export interface ChangeRoleTarget {
  uid: number
  username: string
  role: string
}

interface ChangeRoleModalProps {
  target: ChangeRoleTarget | null
  onClose: () => void
  onSave: (role: AssignableRole) => void
}

export function ChangeRoleModal({ target, onClose, onSave }: ChangeRoleModalProps) {
  const [selected, setSelected] = useState<AssignableRole>('Staff')

  useEffect(() => {
    if (target && (ASSIGNABLE_ROLES as readonly string[]).includes(target.role)) {
      setSelected(target.role as AssignableRole)
    }
  }, [target])

  if (!target) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '360px' }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800">Change Role</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <CloseIcon />
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-4">User: {target.username}</p>
        <div className="space-y-2">
          {ASSIGNABLE_ROLES.map((role) => (
            <label
              key={role}
              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-gray-50 role-radio-label ${
                selected === role ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200'
              }`}
            >
              <input
                type="radio"
                name="change-role-radio"
                value={role}
                checked={selected === role}
                onChange={() => setSelected(role)}
                className="text-indigo-600"
              />
              <div>
                <span className={`text-sm font-semibold ${ROLE_TEXT_CLASS[role]}`}>{role}</span>
                <p className="text-xs text-gray-400">{ROLE_DESCRIPTIONS[role]}</p>
              </div>
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button type="button" onClick={() => onSave(selected)} className="btn-primary">
            Save
          </button>
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
