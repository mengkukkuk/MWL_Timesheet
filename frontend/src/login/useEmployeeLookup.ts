// Debounced lookup against GET /api/employee-lookup/<id> (public endpoint).
// Mirrors the vanilla login.html behaviour: numeric-only IDs, 280ms debounce,
// stale-response discarding via a generation counter, and a `taken` flag so the
// register form can block submits for an already-linked EmployeeID.
import { useEffect, useRef, useState } from 'react'
import type { EmployeeLookupResp } from '../lib'

export type LookupStatus = 'idle' | 'looking' | 'ok' | 'taken' | 'invalid' | 'notfound' | 'error'

export interface EmployeeLookupState {
  status: LookupStatus
  record: EmployeeLookupResp | null
}

const DEBOUNCE_MS = 280

export function useEmployeeLookup(rawId: string): EmployeeLookupState {
  const [state, setState] = useState<EmployeeLookupState>({ status: 'idle', record: null })
  const seqRef = useRef(0)

  useEffect(() => {
    const raw = rawId.trim()
    const seq = ++seqRef.current

    if (!raw) {
      setState({ status: 'idle', record: null })
      return
    }
    if (!/^\d+$/.test(raw)) {
      setState({ status: 'invalid', record: null })
      return
    }

    setState((s) => ({ status: 'looking', record: s.record }))
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/employee-lookup/${encodeURIComponent(raw)}`, {
          credentials: 'include',
        })
        if (seq !== seqRef.current) return
        if (res.status === 404) {
          setState({ status: 'notfound', record: null })
          return
        }
        if (!res.ok) {
          setState({ status: 'error', record: null })
          return
        }
        const data = (await res.json()) as EmployeeLookupResp
        if (seq !== seqRef.current) return
        setState({ status: data.taken ? 'taken' : 'ok', record: data })
      } catch {
        if (seq !== seqRef.current) return
        setState({ status: 'error', record: null })
      }
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [rawId])

  return state
}
