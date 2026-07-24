// Shapes mirrored from GET /api/worklogs and GET /api/holidays (app/worklogs.py).
// static/app/worklogs.js#loadWorklogs() remains the sole fetcher/mutator — this
// file only types the payload it stashes on window.__mwlWorklogs and the
// vanilla globals React delegates every mutation to.

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
    openAddWorklog?: () => void
    openAddWorklogMulti?: () => void
    editWorklog?: (w: Worklog) => void
    deleteWorklog?: (id: number) => void
    openAddWorklogForDate?: (year: number, month: number, day: number) => void
    bulkDeleteWorklogs?: (ids: number[]) => void | Promise<void>
    openBulkEditModal?: (ids: number[]) => void
  }
}