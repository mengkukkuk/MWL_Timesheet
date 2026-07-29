// Row shapes from GET /api/projects-summary (app/worklogs.py#get_projects_summary).
export interface EmployeeRow {
  employee_id: string | number
  name: string
  hours: number
}

export interface ProjectSummaryRow {
  project_department: string
  project_description: string
  total_hours: number
  employees_count: number
  employees: EmployeeRow[]
}

export interface ProjectsSummaryPayload {
  year: number
  month: number
  projects: ProjectSummaryRow[]
}

// Shared chart palette — kept identical to static/app/projects-summary.js so the
// migrated tab is a zero-visual-diff port.
export const PS_COLORS = [
  '#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#14b8a6', '#f97316', '#ec4899', '#3b82f6', '#84cc16',
  '#0ea5e9', '#a855f7', '#22c55e', '#eab308', '#d946ef',
]

// English month labels — matches core.js's MONTHS (the vanilla tab always
// renders English month names in the selector + period label regardless of UI
// language, so we mirror that here rather than routing through i18n).
export const MONTHS = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
