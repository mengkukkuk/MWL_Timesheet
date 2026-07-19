// Shared library for the React islands: typed fetch wrapper, endpoint types,
// and a thin i18n bridge that reuses the existing global t()/toggleLang() from
// static/app/i18n.js (loaded by the Flask template before this bundle), so we
// do NOT duplicate the TH/EN dictionaries.

// ── i18n bridge ───────────────────────────────────────────────────────────
type TFn = (key: string, ...args: unknown[]) => string
declare global {
  interface Window {
    t?: TFn
    toggleLang?: () => void
    applyTranslations?: () => void
  }
}

export function t(key: string, ...args: unknown[]): string {
  if (typeof window.t === 'function') return window.t(key, ...args)
  return key
}

export function currentLang(): 'en' | 'th' {
  try {
    const s = localStorage.getItem('appLang')
    return s === 'th' ? 'th' : 'en'
  } catch {
    return 'en'
  }
}

export function toggleLang(): void {
  if (typeof window.toggleLang === 'function') {
    window.toggleLang()
  } else {
    const next = currentLang() === 'en' ? 'th' : 'en'
    try {
      localStorage.setItem('appLang', next)
    } catch {
      /* ignore */
    }
  }
  window.dispatchEvent(new Event('mwl:langchange'))
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
