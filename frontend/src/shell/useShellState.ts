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
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
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
  members: Member[]
  memberId: string
  year: number
  yearDisabled: boolean
  setMemberId: (id: string) => void
  setYear: (y: number) => void
  selectOverall: () => void
  retryMembers: () => void
}

export function useShellState(): ShellState {
  const user = useCurrentUser()
  const elevated = isElevated(user?.role)
  const [members, setMembers] = useState<Member[]>([])
  const [searchParams, setSearchParams] = useSearchParams()

  const memberId = searchParams.get('member') ?? ''
  const yearParam = searchParams.get('y')
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear()

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

  const selectOverall = useCallback(() => setMemberId(''), [setMemberId])

  // Non-elevated users are pinned to their own member_id on first load,
  // mirroring core.js's initializeApp(): `if (!isElevated() && currentUser.member_id) ...`
  useEffect(() => {
    if (!user || isElevated(user.role) || memberId || !user.member_id) return
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
    members,
    memberId,
    year,
    yearDisabled: !memberId,
    setMemberId,
    setYear,
    selectOverall,
    retryMembers,
  }
}
