// Shared library for the React islands: typed fetch wrapper, endpoint types,
// and i18n re-exports. i18n is now owned by frontend/src/i18n/index.ts (see
// plan PR10 teardown) — this file just re-exports so the 34 existing call
// sites (`import { t, toggleLang, ... } from '../lib'`) don't all need
// touching.

import { useEffect, useState } from 'react'
import { t as i18nT, toggleLang as i18nToggleLang, currentLang as i18nCurrentLang , tRaw} from './i18n'

export { useLang } from './i18n'

// ── toast (event-based; ToastHost, mounted by AppShell, renders it) ─────────
export function toast(msg: string, type: 'success' | 'error' = 'success'): void {
  window.dispatchEvent(new CustomEvent('mwl:toast', { detail: { msg, type } }))
}

// Reads the month names array from the i18n dict (`months.full`).
export function monthName(month: number): string {
  const arr = tRaw('months.full' as never) as unknown
  if (Array.isArray(arr) && typeof arr[month] === 'string') return arr[month] as string
  return String(month)
}

export function t(key: string, ...args: unknown[]): string {
  return i18nT(key as never, ...args)
}

export function currentLang(): 'en' | 'th' {
  return i18nCurrentLang()
}

export function toggleLang(): void {
  i18nToggleLang()
}

// ── typed fetch ─────────────────────────────────────────────────────────────
export interface ApiResult<T> {
  ok: boolean
  status: number
  data: T | null
  error?: string
}

export async function api<T = unknown>(
  url: string,
  opts: RequestInit & { json?: unknown } = {},
): Promise<ApiResult<T>> {
  const { json, ...rest } = opts
  const init: RequestInit = { credentials: 'include', ...rest }
  if (json !== undefined) {
    init.method = init.method || 'POST'
    init.headers = { 'Content-Type': 'application/json', ...(init.headers || {}) }
    init.body = JSON.stringify(json)
  }
  let res: Response
  try {
    res = await fetch(url, init)
  } catch {
    return { ok: false, status: 0, data: null, error: 'network' }
  }
  if (res.status === 401) {
    window.location.href = '/login'
    return { ok: false, status: 401, data: null, error: 'unauthorized' }
  }
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* empty/non-json */
  }
  const err =
    body && typeof body === 'object' && 'error' in body
      ? String((body as { error: unknown }).error)
      : undefined
  return { ok: res.ok, status: res.status, data: (body as T) ?? null, error: err }
}

// ── endpoint payload types ──────────────────────────────────────────────────
export interface MeResp {
  id: number
  username: string
  role: string
  member_id: string
}

export const ELEVATED_ROLES = ['Super_Ultimate_ADMIN', 'Admin', 'Leader']
export function isElevated(role: string | undefined): boolean {
  return !!role && ELEVATED_ROLES.includes(role)
}

// Independent /api/me fetch for React islands — does NOT read core.js's
// `currentUser` global, since that is populated asynchronously on
// DOMContentLoaded (after this module's top-level code has already run).
export function useCurrentUser(): MeResp | null {
  const [user, setUser] = useState<MeResp | null>(null)
  useEffect(() => {
    let alive = true
    api<MeResp>('/api/me').then((r) => {
      if (alive && r.ok) setUser(r.data)
    })
    return () => {
      alive = false
    }
  }, [])
  return user
}

export function canManageMember(user: MeResp | null, memberId: string): boolean {
  if (!user) return false
  return isElevated(user.role) || String(user.member_id) === String(memberId)
}

export interface Member {
  id: string // EmployeeID
  name: string
  department: string
  staff_id: string
  position: string
  level: string
  jg: string
  avatar_url: string | null
}

export interface DashMonth {
  month: number
  total_hours: number | string
  overtime_hours?: number | string
  man_day?: number | string
  total_ot1?: number | string
  total_ot1_5?: number | string
  total_ot3?: number | string
  done: number
  in_progress: number
  missing?: number
}

export interface DashboardResp {
  name: string
  department: string
  position: string
  level: string
  staff_id: string
  avatar_url: string | null
  jg?: string
  months: DashMonth[]
}

export interface ProjectRef {
  id: number
  name: string
}
export interface ProjectRolesResp {
  main: ProjectRef[]
  support: ProjectRef[]
}

export interface Skill {
  id: number
  name: string
  level: number
}
export type SkillsByMember = Record<string, Skill[]>

// Raw /api/projects row — main_members/support_members are JSON-array
// strings of EmployeeIDs (or, for legacy rows, "#"-separated names).
export interface ProjectRow {
  id: number
  name: string
  main_members?: string | null
  support_members?: string | null
}

export type MissingMap = Record<string, number>

export function parseProjectMemberList(raw: string | null | undefined): string[] {
  if (!raw) return []
  const s = raw.trim()
  if (s.startsWith('[')) {
    try {
      return (JSON.parse(s) as unknown[]).map(String).filter(Boolean)
    } catch {
      return []
    }
  }
  return s.split('#').map((n) => n.trim()).filter(Boolean)
}

export interface EmployeeLookupResp {
  employee_id: string
  name: string
  department: string
  position: string
  taken: boolean
}

export interface LoginResp {
  ok?: boolean
  role?: string
  member_id?: string
  error?: string
  message?: string
  locked_for_seconds?: number
}
