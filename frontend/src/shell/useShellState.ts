// Central shell state: current member/year context, the members list, and
// the current user's role. Full-teardown React replacement for
// static/app/core.js's currentMemberId/onMemberChange/onContextChange/
// selectOverall global state machine (see purring-weaving-pillow.md).
//
// Sibling Vite bundles (dashboard/worklog/... islands, NOT rewritten by this
// port) still read #member-select / #year-select .value directly and listen
// for native 'change' + the 'mwl:dashboard' CustomEvent. This hook is the new
// single source of truth (backed by ?member=&y= URL search params) and pushes
// into those DOM elements/events on every change so those islands keep working
// unmodified — see the migration plan's "cross-bundle DOM/window contract".
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { api, isElevated, toast, useCurrentUser, type Member, type MeResp } from '../lib'

declare global {
  interface Window {
    currentMemberId?: string | number | null
    selectOverall?: () => void
  }
}

export interface ShellState {
  user: MeResp | null
  elevated: boolean
  canViewOthers: boolean
  members: Member[]
  memberId: string
  year: number
  month: number
  yearDisabled: boolean
  setMemberId: (id: string) => void
  setYear: (y: number) => void
  setMonth: (m: number) => void
  selectOverall: () => void
  retryMembers: () => void
}

// The Work Log month lives in `?m=` alongside `?member=`/`?y=` so it survives a
// reload and the Dashboard's Monthly Breakdown hand-off is a plain navigation.
function clampMonth(raw: string | null): number {
  const m = raw ? parseInt(raw, 10) : NaN
  if (!Number.isFinite(m) || m < 1 || m > 12) return new Date().getMonth() + 1
  return m
}

export function useShellState(): ShellState {
  const user = useCurrentUser()
  const elevated = isElevated(user?.role)
  const [worklogOpen, setWorklogOpen] = useState(false)
  const [members, setMembers] = useState<Member[]>([])
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  // The admin-controlled "Worklog Visibility" toggle (Settings tab) lets
  // non-elevated (Staff) users browse the Team Overview and other members'
  // read-only data; the backend already enforces this per-endpoint (see
  // app/worklogs.py's `_worklog_open` checks) — this just unlocks the UI to match.
  useEffect(() => {
    let alive = true
    api<{ worklog_open: boolean }>('/api/settings').then((r) => {
      if (alive && r.ok && r.data) setWorklogOpen(!!r.data.worklog_open)
    })
    return () => {
      alive = false
    }
  }, [])
  const canViewOthers = elevated || worklogOpen

  const memberId = searchParams.get('member') ?? ''
  const yearParam = searchParams.get('y')
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear()
  const month = clampMonth(searchParams.get('m'))

  const [membersReloadKey, setMembersReloadKey] = useState(0)
  const retryMembers = useCallback(() => setMembersReloadKey((k) => k + 1), [])

  useEffect(() => {
    let alive = true
    api<Member[]>('/api/members').then((r) => {
      if (!alive) return
      if (r.ok && r.data) {
        setMembers(r.data)
      } else {
        toast('Failed to load team members — retrying may help', 'error')
      }
    })
    return () => {
      alive = false
    }
  }, [membersReloadKey])

  const setMemberId = useCallback(
    (id: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (id) next.set('member', id)
          else next.delete('member')
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const setYear = useCallback(
    (y: number) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('y', String(y))
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const setMonth = useCallback(
    (m: number) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('m', String(m))
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  // "Overall" is a page, not just a query-param clear: the button lives in the
  // shared Selector bar visible on every tab, so clicking it must always land
  // on the Team Overview view (dashboard, no member selected) regardless of
  // which tab is currently active — previously this only cleared `member` in
  // place, which did nothing visible unless you were already on /dashboard.
  const selectOverall = useCallback(() => {
    const next = new URLSearchParams(searchParams)
    next.delete('member')
    navigate({ pathname: '/dashboard', search: next.toString() })
  }, [navigate, searchParams])

  // Pinned to their own member_id on first load only — Staff (mirroring
  // core.js's initializeApp(): `if (!isElevated() && currentUser.member_id) ...`),
  // and, per product decision, Admin/Leader too (they usually have their own
  // worklog entries and land on themselves rather than "None"). Only
  // Super_Ultimate_ADMIN is excluded and still lands on the "Overall" team view.
  // Gated by a ref (not just the `!memberId` check) so this doesn't re-fire and
  // fight a deliberate "Overall" click, which also clears memberId to ''.
  const didAutoSelectRef = useRef(false)
  useEffect(() => {
    if (didAutoSelectRef.current || !user) return
    didAutoSelectRef.current = true
    if (user.role === 'Super_Ultimate_ADMIN' || memberId || !user.member_id) return
    setMemberId(user.member_id)
  }, [user, memberId, setMemberId])

  // Mirror memberId -> window.currentMemberId + #member-select's native
  // 'change' event + mwl:dashboard, exactly like core.js's onMemberChange()/
  // onContextChange(). The actual <select id="member-select"> is a
  // React-controlled element rendered by the Selector bar, so its .value is
  // already correct by the time this effect runs — only the event dispatch
  // (which React's own value-prop update does NOT fire) is needed here.
  useEffect(() => {
    window.currentMemberId = memberId || null
    document.getElementById('member-select')?.dispatchEvent(new Event('change'))
    window.dispatchEvent(new Event('mwl:dashboard'))
  }, [memberId])

  useEffect(() => {
    document.getElementById('year-select')?.dispatchEvent(new Event('change'))
  }, [year])

  useEffect(() => {
    window.selectOverall = selectOverall
    return () => {
      delete window.selectOverall
    }
  }, [selectOverall])

  return {
    user,
    elevated,
    canViewOthers,
    members,
    memberId,
    year,
    month,
    yearDisabled: !memberId,
    setMemberId,
    setYear,
    setMonth,
    selectOverall,
    retryMembers,
  }
}
