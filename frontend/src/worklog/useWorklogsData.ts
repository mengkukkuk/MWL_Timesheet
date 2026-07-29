// PR3 data layer: the Work Log island is now the single fetcher for the
// worklog tab, replacing static/app/worklogs.js#loadWorklogs()'s fetch +
// window.__mwlWorklogs / 'mwl:worklogs' stash with TanStack Query.
//
// Cross-tab context (which member/year/month) still lives in the vanilla
// #member-select / #year-select / #month-select DOM elements, so this hook
// tracks them via `change` events and a synthetic 'mwl:reload' event that
// worklogs.js dispatches after any vanilla mutation.
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib'
import type { Holiday, Worklog, WorklogsPayload } from './types'

export interface WorklogContext {
  member: string
  year: number
  month: number
}

// Row shape from GET /api/description (app/projects.py#_load_projects_description).
export interface ProjectDescription {
  Projectcode: string
  Description: string
  ProjectDepartment: string
  Status: string
}

function readSelect(id: string): string {
  const el = document.getElementById(id) as HTMLSelectElement | null
  return el?.value || ''
}

function readContext(): WorklogContext {
  const now = new Date()
  const y = parseInt(readSelect('year-select'), 10)
  const m = parseInt(readSelect('month-select'), 10)
  return {
    member: readSelect('member-select'),
    year: Number.isFinite(y) ? y : now.getFullYear(),
    month: Number.isFinite(m) ? m : now.getMonth() + 1,
  }
}

export function useWorklogContext(): WorklogContext {
  const [ctx, setCtx] = useState<WorklogContext>(readContext)
  useEffect(() => {
    const update = () => setCtx(readContext())
    const ids = ['member-select', 'year-select', 'month-select']
    const els = ids.map((id) => document.getElementById(id))
    els.forEach((el) => el?.addEventListener('change', update))
    window.addEventListener('mwl:reload', update)
    return () => {
      els.forEach((el) => el?.removeEventListener('change', update))
      window.removeEventListener('mwl:reload', update)
    }
  }, [])
  return ctx
}

export function worklogsQueryKey(ctx: WorklogContext): [string, string, number, number] {
  return ['worklogs', ctx.member, ctx.year, ctx.month]
}

async function fetchWorklogs(ctx: WorklogContext): Promise<WorklogsPayload> {
  const qs = `member_id=${encodeURIComponent(ctx.member)}&year=${ctx.year}&month=${ctx.month}`
  const [wl, hol] = await Promise.all([
    api<Worklog[]>(`/api/worklogs?${qs}`),
    api<Holiday[]>(`/api/holidays?${qs}`),
  ])
  return {
    worklogs: Array.isArray(wl.data) ? wl.data : [],
    holidays: Array.isArray(hol.data) ? hol.data : [],
    year: ctx.year,
    month: ctx.month,
  }
}

export function useWorklogsData() {
  const ctx = useWorklogContext()
  const query = useQuery({
    queryKey: worklogsQueryKey(ctx),
    queryFn: () => fetchWorklogs(ctx),
    enabled: !!ctx.member,
    staleTime: 30_000,
  })
  return { ctx, query }
}

export function useDescriptions() {
  return useQuery({
    queryKey: ['descriptions'],
    queryFn: async () => {
      const r = await api<ProjectDescription[]>('/api/description')
      return Array.isArray(r.data) ? r.data : []
    },
    staleTime: 10 * 60_000,
  })
}
