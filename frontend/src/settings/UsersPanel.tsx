// User Accounts panel (ported from static/app/settings.js's
// loadUsersList/deleteUser + the Change Role / Reset Password button
// gating rules). Owns the ChangeRoleModal/ResetPasswordModal open state.

import { useState } from 'react'
import { toast } from '../lib'
import { ChangeRoleModal, type ChangeRoleTarget } from './ChangeRoleModal'
import { ResetPasswordModal, type ResetPasswordTarget } from './ResetPasswordModal'
import { ROLE_SUPER_ADMIN, type AssignableRole } from './types'
import {
  useChangeUserRole,
  useDeleteUser,
  useResetUserPassword,
  useUsers,
} from './useSettingsData'

const ROLE_CSS: Record<string, string> = {
  [ROLE_SUPER_ADMIN]: 'text-indigo-600 font-semibold',
  Admin: 'text-orange-600 font-medium',
  Leader: 'text-blue-500 font-medium',
}

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback
}

interface UsersPanelProps {
  currentUserId: number
  currentUserRole: string
}

export function UsersPanel({ currentUserId, currentUserRole }: UsersPanelProps) {
  const usersQuery = useUsers()
  const changeRole = useChangeUserRole()
  const resetPassword = useResetUserPassword()
  const deleteUser = useDeleteUser()

  const [roleTarget, setRoleTarget] = useState<ChangeRoleTarget | null>(null)
  const [pwTarget, setPwTarget] = useState<ResetPasswordTarget | null>(null)

  const canChangeRole = currentUserRole === ROLE_SUPER_ADMIN
  const canResetPassword = currentUserRole === ROLE_SUPER_ADMIN

  const saveRole = (role: AssignableRole) => {
    if (!roleTarget) return
    changeRole.mutate(
      { uid: roleTarget.uid, role },
      {
        onSuccess: () => {
          toast('Role updated')
          setRoleTarget(null)
        },
        onError: (e) => toast(errMsg(e, 'Role change failed'), 'error'),
      },
    )
  }

  const savePassword = (password: string) => {
    if (!pwTarget) return
    resetPassword.mutate(
      { uid: pwTarget.uid, password },
      {
        onSuccess: () => {
          toast('Password updated')
          setPwTarget(null)
        },
        onError: (e) => toast(errMsg(e, 'Password reset failed'), 'error'),
      },
    )
  }

  const remove = (id: number) => {
    if (!window.confirm('Delete this user account and their member profile (including all work logs)?')) return
    deleteUser.mutate(id, {
      onSuccess: () => toast('User removed'),
      onError: (e) => toast(errMsg(e, 'Delete failed'), 'error'),
    })
  }

  return (
    <div id="settings-panel-users" className="settings-panel card bg-white">
      <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">User Accounts</h3>
      <ul className="space-y-2">
        {(usersQuery.data || []).map((u) => {
          const roleClass = ROLE_CSS[u.role] || 'text-gray-500'
          const isSelf = u.id === currentUserId
          const isSuperAdmin = u.role === ROLE_SUPER_ADMIN
          const showChangeRole = canChangeRole && !isSelf && !isSuperAdmin
          const showDelete = !isSelf && !isSuperAdmin
          const statusBadge =
            u.status === 'Pending' ? (
              <span className="text-xs ml-2 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Pending</span>
            ) : u.status === 'Declined' ? (
              <span className="text-xs ml-2 px-1.5 py-0.5 rounded bg-red-100 text-red-700">Declined</span>
            ) : null

          return (
            <li key={u.id} className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-gray-50">
              <div>
                <span className="text-sm font-medium">{u.username}</span>
                <span className={`text-xs ${roleClass} ml-2`}>{u.role}</span>
                {u.member_name ? <span className="text-xs text-gray-400 ml-2">({u.member_name})</span> : null}
                {statusBadge}
              </div>
              <div className="flex items-center gap-1">
                {showChangeRole ? (
                  <button
                    className="btn-icon"
                    onClick={() => setRoleTarget({ uid: u.id, username: u.username, role: u.role })}
                    title="Change Role"
                  >
                    <RoleIcon />
                  </button>
                ) : (
                  <span className="w-7" />
                )}
                {canResetPassword ? (
                  <button
                    className="btn-icon"
                    onClick={() => setPwTarget({ uid: u.id, username: u.username })}
                    title="Reset Password"
                  >
                    <KeyIcon />
                  </button>
                ) : (
                  <span className="w-7" />
                )}
                {showDelete ? (
                  <button className="btn-icon danger" onClick={() => remove(u.id)} title="Remove">
                    <TrashIcon />
                  </button>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
      <ChangeRoleModal target={roleTarget} onClose={() => setRoleTarget(null)} onSave={saveRole} />
      <ResetPasswordModal target={pwTarget} onClose={() => setPwTarget(null)} onSave={savePassword} />
    </div>
  )
}

function RoleIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}

function KeyIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
      />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}
