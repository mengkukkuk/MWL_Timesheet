// Worklog Visibility panel (Super_Ultimate_ADMIN only). Ported from
// static/app/settings.js's loadSettings/renderVisibilityToggle/
// toggleWorklogVisibility.

import { toast } from '../lib'
import { useSetVisibility, useVisibilitySettings } from './useSettingsData'

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback
}

export function VisibilityPanel() {
  const visibilityQuery = useVisibilitySettings()
  const setVisibility = useSetVisibility()
  const isOpen = visibilityQuery.data?.worklog_open ?? false

  const toggle = () => {
    setVisibility.mutate(!isOpen, {
      onError: (e) => toast(errMsg(e, 'Failed to save'), 'error'),
    })
  }

  return (
    <div id="settings-panel-visibility" className="settings-panel card bg-white">
      <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">Worklog Visibility</h3>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-700">
            {isOpen ? 'Worklogs open to all staff' : 'Worklogs restricted'}
          </p>
          <p className="text-xs text-gray-400">
            {isOpen
              ? 'Any staff member can view any other member\u2019s worklogs.'
              : 'Staff can only view their own worklogs (leaders/admins unaffected).'}
          </p>
        </div>
        <button
          type="button"
          id="visibility-toggle-btn"
          onClick={toggle}
          data-open={isOpen ? '1' : '0'}
          className="relative w-14 h-7 rounded-full transition-colors"
          style={{ backgroundColor: isOpen ? '#16a34a' : '#9ca3af' }}
        >
          <span
            id="visibility-toggle-knob"
            className="absolute top-0.5 left-0 w-6 h-6 rounded-full bg-white transition-transform"
            style={{ transform: isOpen ? 'translateX(1.75rem)' : 'translateX(0.25rem)' }}
          />
        </button>
      </div>
    </div>
  )
}
