// Shapes mirrored from /api/employees, /api/users(+pending), /api/projects,
// and /api/settings(+time-presets) (app/employees.py, app/users.py,
// app/projects.py, app/core.py). Ported from static/app/settings.js's
// ad-hoc rendering into typed TanStack Query payloads for the Settings
// React island.

export interface Employee {
  id: string // EmployeeID (business key)
  name: string
  department: string | null
  staff_id: string
  position: string | null
  level: string | null
  jg: string | null
  avatar_url: string | null
}

export interface UserRow {
  id: number
  username: string
  role: string
  member_id: string | null
  status: string
  member_name?: string | null
  Department?: string | null
  Position?: string | null
}

export interface PendingUser {
  id: number
  username: string
  created_at: string
  member_id: string | null
  member_name?: string | null
  department?: string | null
  staff_id?: string | null
  position?: string | null
}

export interface PendingCountResp {
  count: number
}

export interface TimePresetItem {
  label: string
  value: string
}

export interface TimePresets {
  start: TimePresetItem[]
  end: TimePresetItem[]
}

export interface VisibilityResp {
  worklog_open: boolean
}

export interface SettingsProject {
  id: number
  name: string
}

export type SettingsPanelName =
  | 'members'
  | 'projects'
  | 'approvals'
  | 'users'
  | 'time-presets'
  | 'visibility'

// Order matches the radio list in the Change Role modal (app.html) and
// app/constants.py's ASSIGNABLE_ROLES.
export const ASSIGNABLE_ROLES = ['Admin', 'Leader', 'Staff'] as const
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number]

export const ROLE_SUPER_ADMIN = 'Super_Ultimate_ADMIN'
