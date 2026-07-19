// Shared avatar upload/remove behavior — reused by the staff identity card
// (individual dashboard) and the overall-team grid cards. PDPA: only the
// employee themselves or Super_Ultimate_ADMIN may change a photo (mirrors
// the removed static/app/dashboard.js `canEditAvatarFor`).
import { toast } from '../lib'

const MAX_AVATAR_BYTES = 2 * 1024 * 1024

export function useAvatarActions(employeeId: string, canEdit: boolean, onChanged: () => void) {
  const pick = () => {
    if (!canEdit) return
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/jpeg,image/png,image/webp'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      if (file.size > MAX_AVATAR_BYTES) {
        toast('Image must be 2 MB or smaller', 'error')
        return
      }
      const fd = new FormData()
      fd.append('file', file)
      try {
        const res = await fetch(`/api/avatars/${employeeId}`, {
          method: 'POST',
          body: fd,
          credentials: 'same-origin',
        })
        const data = await res.json().catch(() => ({}) as { error?: string })
        if (!res.ok) {
          toast(data.error || 'Upload failed', 'error')
          return
        }
        toast('Profile photo updated', 'success')
        onChanged()
      } catch (e) {
        toast(`Upload failed: ${e instanceof Error ? e.message : 'unknown error'}`, 'error')
      }
    }
    input.click()
  }

  const remove = async () => {
    if (!canEdit) return
    if (!window.confirm('Remove your profile photo?')) return
    try {
      const res = await fetch(`/api/avatars/${employeeId}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      const data = await res.json().catch(() => ({}) as { error?: string })
      if (!res.ok) {
        toast(data.error || 'Remove failed', 'error')
        return
      }
      toast('Profile photo removed', 'success')
      onChanged()
    } catch (e) {
      toast(`Remove failed: ${e instanceof Error ? e.message : 'unknown error'}`, 'error')
    }
  }

  return { pick, remove }
}
