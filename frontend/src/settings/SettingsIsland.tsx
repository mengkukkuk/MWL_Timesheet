// Settings tab orchestrator. Ported from app.html's `.settings-layout`
// markup (sidebar nav + panel switching) and static/app/settings.js's
// showSettingsPanel (localStorage-persisted active panel) + the
// Super_Ultimate_ADMIN-only Worklog Visibility gate from showTab().

import { useEffect, useState, type ReactNode } from 'react'
import { useCurrentUser } from '../lib'
import { ApprovalsPanel } from './ApprovalsPanel'
import { MembersPanel } from './MembersPanel'
import { ProjectsPanel } from './ProjectsPanel'
import { TimePresetsPanel } from './TimePresetsPanel'
import { ROLE_SUPER_ADMIN, type SettingsPanelName } from './types'
import { usePendingUsers } from './useSettingsData'
import { UsersPanel } from './UsersPanel'
import { VisibilityPanel } from './VisibilityPanel'

const PANEL_STORAGE_KEY = 'settings_panel'

interface NavItem {
  name: SettingsPanelName
  label: string
  icon: ReactNode
}

const NAV_ITEMS: NavItem[] = [
  {
    name: 'members',
    label: 'Team Members',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
      />
    ),
  },
  {
    name: 'projects',
    label: 'Projects',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
      />
    ),
  },
  {
    name: 'approvals',
    label: 'Account Approvals',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.48 0L3.16 16.25A2 2 0 005 19z"
      />
    ),
  },
  {
    name: 'users',
    label: 'User Accounts',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zM19 11a7 7 0 11-14 0 7 7 0 0114 0z"
      />
    ),
  },
  {
    name: 'visibility',
    label: 'Worklog Visibility',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
      />
    ),
  },
  {
    name: 'time-presets',
    label: 'Time Presets',
    icon: (
      <>
        <circle cx="12" cy="12" r="10" strokeWidth={2} />
        <polyline points="12 6 12 12 16 14" strokeWidth={2} />
      </>
    ),
  },
]

function isValidPanel(name: string | null): name is SettingsPanelName {
  return !!name && NAV_ITEMS.some((n) => n.name === name)
}

export function SettingsIsland() {
  const currentUser = useCurrentUser()
  const pendingQuery = usePendingUsers()
  const pendingCount = pendingQuery.data?.length || 0
  const isSuperAdmin = currentUser?.role === ROLE_SUPER_ADMIN

  const [panel, setPanel] = useState<SettingsPanelName>(() => {
    const stored = localStorage.getItem(PANEL_STORAGE_KEY)
    return isValidPanel(stored) ? stored : 'members'
  })

  useEffect(() => {
    localStorage.setItem(PANEL_STORAGE_KEY, panel)
  }, [panel])

  // Visitors without the Super_Ultimate_ADMIN role never see Visibility;
  // bounce off it if it was the last-persisted panel from a prior session.
  useEffect(() => {
    if (panel === 'visibility' && currentUser && !isSuperAdmin) {
      setPanel('members')
    }
  }, [panel, currentUser, isSuperAdmin])

  const visibleNavItems = NAV_ITEMS.filter((n) => n.name !== 'visibility' || isSuperAdmin)

  return (
    <div className="settings-layout">
      <nav className="settings-nav card bg-white">
        {visibleNavItems.map((item) => (
          <button
            key={item.name}
            className={`settings-nav-item${panel === item.name ? ' active' : ''}`}
            onClick={() => setPanel(item.name)}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {item.icon}
            </svg>
            <span>{item.label}</span>
            {item.name === 'approvals' && pendingCount > 0 ? (
              <span className="ml-auto px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold leading-none">
                {pendingCount}
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="settings-panels">
        {panel === 'members' && <MembersPanel />}
        {panel === 'projects' && <ProjectsPanel />}
        {panel === 'approvals' && <ApprovalsPanel />}
        {panel === 'users' && currentUser && (
          <UsersPanel currentUserId={currentUser.id} currentUserRole={currentUser.role} />
        )}
        {panel === 'visibility' && isSuperAdmin && <VisibilityPanel />}
        {panel === 'time-presets' && <TimePresetsPanel />}
      </div>
    </div>
  )
}
