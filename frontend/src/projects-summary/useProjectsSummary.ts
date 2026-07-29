// PR6 data layer: the Projects Summary island is the single fetcher for the
// projects-summary tab, replacing static/app/projects-summary.js#loadProjectsSummary().
// Year/month are React state owned by the island (the old #ps-year / #ps-month
// vanilla selects are gone), so this hook simply takes them as params.
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib'
import type { ProjectsSummaryPayload } from './types'

export function projectsSummaryQueryKey(year: number, month: number): [string, number, number] {
  return ['projects-summary', year, month]
}

async function fetchProjectsSummary(year: number, month: number): Promise<ProjectsSummaryPayload> {
  const r = await api<ProjectsSummaryPayload>(`/api/projects-summary?year=${year}&month=${month}`)
  return r.data ?? { year, month, projects: [] }
}

export function useProjectsSummary(year: number, month: number, enabled: boolean) {
  return useQuery({
    queryKey: projectsSummaryQueryKey(year, month),
    queryFn: () => fetchProjectsSummary(year, month),
    enabled,
    staleTime: 60_000,
  })
}
