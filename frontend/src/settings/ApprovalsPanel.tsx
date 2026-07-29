// Account Approvals panel (ported from static/app/settings.js's
// loadPendingUsers/approvePendingUser/declinePendingUser). The inline
// nav-item badge is rendered by SettingsIsland from usePendingCount().

import { toast } from '../lib'
import { useApprovePendingUser, useDeclinePendingUser, usePendingUsers } from './useSettingsData'

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback
}

export function ApprovalsPanel() {
  const pendingQuery = usePendingUsers()
  const approve = useApprovePendingUser()
  const decline = useDeclinePendingUser()
  const rows = pendingQuery.data || []

  const doApprove = (uid: number, username: string) => {
    if (!window.confirm(`Approve "${username}"? They will be able to log in immediately.`)) return
    approve.mutate(uid, {
      onSuccess: () => toast(`Approved ${username}`),
      onError: (e) => toast(errMsg(e, 'Approve failed'), 'error'),
    })
  }

  const doDecline = (uid: number, username: string) => {
    if (
      !window.confirm(
        `Decline "${username}"? Their account will be marked Declined and cannot log in. (Kept for audit.)`,
      )
    )
      return
    decline.mutate(uid, {
      onSuccess: () => toast(`Declined ${username}`),
      onError: (e) => toast(errMsg(e, 'Decline failed'), 'error'),
    })
  }

  return (
    <div
      id="settings-panel-approvals"
      className="settings-panel card bg-white border-l-4 border-amber-400"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
          <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.48 0L3.16 16.25A2 2 0 005 19z"
            />
          </svg>
          <span>Account Approvals</span>
        </h3>
        <button
          onClick={() => pendingQuery.refetch()}
          className="text-xs text-indigo-600 hover:underline"
        >
          Refresh
        </button>
      </div>
      <p className="text-xs text-gray-500 mb-3">
        New self-registered accounts must be approved before they can log in.
      </p>
      <ul className="space-y-2">
        {!rows.length ? (
          <li className="text-sm text-gray-400 italic px-2 py-3">No pending registrations.</li>
        ) : (
          rows.map((u) => {
            const created = u.created_at ? new Date(u.created_at).toLocaleString() : ''
            return (
              <li
                key={u.id}
                className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-800">{u.username}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                        Pending
                      </span>
                      {created ? <span className="text-xs text-gray-400">{created}</span> : null}
                    </div>
                    {u.member_name ? (
                      <div className="text-xs text-gray-600 mt-0.5">
                        {u.member_name} · {u.department || ''}
                        {u.position ? ` · ${u.position}` : ''}
                        {u.staff_id ? ` · ID ${u.staff_id}` : ''}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => doApprove(u.id, u.username)}
                      className="text-xs px-3 py-1 rounded-md bg-green-600 text-white hover:bg-green-700 font-medium"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => doDecline(u.id, u.username)}
                      className="text-xs px-3 py-1 rounded-md bg-red-100 text-red-700 hover:bg-red-200 font-medium"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              </li>
            )
          })
        )}
      </ul>
    </div>
  )
}
