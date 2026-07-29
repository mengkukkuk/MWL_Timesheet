// Reset Password modal (Super_Ultimate_ADMIN only). Ported from app.html's
// #reset-pw-overlay markup + static/app/settings.js's
// openResetPasswordModal/saveResetPassword.

import { useEffect, useState } from 'react'

export interface ResetPasswordTarget {
  uid: number
  username: string
}

interface ResetPasswordModalProps {
  target: ResetPasswordTarget | null
  onClose: () => void
  onSave: (password: string) => void
}

export function ResetPasswordModal({ target, onClose, onSave }: ResetPasswordModalProps) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')

  useEffect(() => {
    setPassword('')
    setConfirm('')
  }, [target])

  if (!target) return null

  const save = () => {
    if (password.length < 8) {
      window.alert('Password must be at least 8 characters')
      return
    }
    if (password !== confirm) {
      window.alert('Passwords do not match')
      return
    }
    onSave(password)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '360px' }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800">Reset Password</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <CloseIcon />
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-4">Reset password for: {target.username}</p>
        <div className="space-y-2">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="New password"
            className="input-field w-full"
          />
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm password"
            className="input-field w-full"
          />
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button type="button" onClick={save} className="btn-primary">
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
