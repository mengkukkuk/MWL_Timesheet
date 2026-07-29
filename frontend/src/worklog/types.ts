// Shapes mirrored from GET /api/worklogs and GET /api/holidays (app/worklogs.py).
// As of PR3, useWorklogsData.ts is the sole fetcher (TanStack Query) and bulk
// edit/delete are React mutations (WorklogIsland.tsx) — this file types that
// payload plus the vanilla globals still used for single add/edit/delete,
// which delegate to the shared modal (static/app/worklogs.js) until it's
// ported to React.

export type WorklogStatus = 'Done' | 'In Progress' | 'Pending' | 'Man day'

export interface Worklog {
  id: number
  member_id: string
  log_date: string
  project: string | null
  project_description: string | null
  task: string | null
  start_time: string | null
  end_time: string | null
  hours: number | null
  status: WorklogStatus | string
  note: string | null
  IsEditRow: number
  is_allowance: number
}

export interface Holiday {
  date: string
  description: string
}

export interface WorklogsPayload {
  worklogs: Worklog[]
  holidays: Holiday[]
  year: number
  month: number
}

declare global {
  interface Window {
    __mwlWorklogs?: WorklogsPayload
    // PR3: the React island now owns the worklog fetch; it mirrors the fetched
    // rows back into vanilla core.js `worklogData` via this setter so the
    // shared add/edit modal's renderExistingRanges() stays correct on every tab.
    __mwlSetWorklogData?: (rows: Worklog[]) => void
    // Month hand-off: MonthlyLedger stashes a clicked month here before
    // navigating to /worklog; WorklogIsland applies it once #month-select mounts.
    __mwlPendingMonth?: number | null
    openAddWorklog?: () => void
    openAddWorklogMulti?: () => void
    editWorklog?: (w: Worklog) => void
    deleteWorklog?: (id: number) => void
    openAddWorklogForDate?: (year: number, month: number, day: number) => void
  }
}