// Projects Summary React island (PR6). Mounts into #projects-summary-root inside
// the SPA shell's #view-projects-summary and owns the whole tab: year/month
// selectors, KPI cards, Chart.js bar/donut, and the expandable breakdown table.
// Replaces static/app/projects-summary.js. Elevated-only — the query is disabled
// for non-elevated users (the endpoint is @elevated_required and the nav button
// is hidden by core.js), so it never fires a doomed request.
import { useEffect, useMemo, useState } from 'react'
import { isElevated, t, useCurrentUser } from '../lib'
import { BarChart, DonutChart } from './charts'
import { MONTHS, PS_COLORS, type ProjectSummaryRow } from './types'
import { useProjectsSummary } from './useProjectsSummary'

const now = new Date()
const CUR_YEAR = now.getFullYear()
const CUR_MONTH = now.getMonth() + 1
const YEARS = Array.from({ length: 5 }, (_, i) => CUR_YEAR - 2 + i)

function ProjectRow({
  p,
  idx,
  totalHours,
  open,
  onToggle,
}: {
  p: ProjectSummaryRow
  idx: number
  totalHours: number
  open: boolean
  onToggle: () => void
}) {
  const color = PS_COLORS[idx % PS_COLORS.length]
  const sharePct = totalHours > 0 ? (p.total_hours / totalHours) * 100 : 0
  return (
    <>
      <tr className={`ps-proj-row${open ? ' expanded' : ''}`} onClick={onToggle}>
        <td className="py-3 px-4 w-8">
          <svg
            className={`ps-chevron w-4 h-4 ${open ? 'open' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </td>
        <td className="py-3 px-4">
          <span className="inline-flex items-center gap-2">
            <span className="ps-proj-color-bar" style={{ background: color, height: '1.1em', alignSelf: 'stretch' }} />
            <span
              className="project-name-cell"
              style={{ fontSize: '.875rem', fontWeight: 600, color: '#1e293b' }}
              title={p.project_description || ''}
            >
              {p.project_department}
            </span>
          </span>
        </td>
        <td className="py-3 px-4 text-right">
          <span style={{ fontSize: '.8125rem', color: '#64748b', fontWeight: 500 }}>{p.employees_count}</span>
        </td>
        <td className="py-3 px-4 text-right">
          <span className="ps-hours-badge">{p.total_hours.toFixed(1)}</span>
        </td>
        <td className="py-3 px-4" style={{ minWidth: '140px' }}>
          <div className="flex items-center gap-2">
            <div className="ps-share-bar-bg flex-1">
              <div className="ps-share-bar-fill" style={{ '--bar-color': color, width: `${sharePct.toFixed(1)}%` } as React.CSSProperties} />
            </div>
            <span className="ps-share-pct">{sharePct.toFixed(1)}%</span>
          </div>
        </td>
      </tr>
      {open
        ? (p.employees || []).map((emp, i) => (
            <tr className="ps-emp-row" key={`${emp.employee_id}-${i}`}>
              <td className="py-2 px-4" />
              <td className="py-2 px-4 pl-10">
                <span style={{ fontSize: '.8125rem', color: '#475569' }}>{emp.name}</span>
              </td>
              <td className="py-2 px-4 text-right">
                <span style={{ fontSize: '.75rem', color: '#94a3b8' }}>{emp.employee_id || ''}</span>
              </td>
              <td className="py-2 px-4 text-right">
                <span className="ps-hours-badge emp">{emp.hours.toFixed(1)}</span>
              </td>
              <td className="py-2 px-4" />
            </tr>
          ))
        : null}
    </>
  )
}

export function ProjectsSummaryIsland() {
  const user = useCurrentUser()
  const elevated = isElevated(user?.role)
  const [year, setYear] = useState(CUR_YEAR)
  const [month, setMonth] = useState(CUR_MONTH)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [, bumpLang] = useState(0)

  const query = useProjectsSummary(year, month, elevated)
  const projects = useMemo(() => query.data?.projects ?? [], [query.data])
  const totalHours = useMemo(() => projects.reduce((s, p) => s + p.total_hours, 0), [projects])

  useEffect(() => {
    const onLang = () => bumpLang((n) => n + 1)
    window.addEventListener('mwl:langchange', onLang)
    return () => window.removeEventListener('mwl:langchange', onLang)
  }, [])

  const toggle = (pd: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(pd)) next.delete(pd)
      else next.add(pd)
      return next
    })

  const uniqueEmployees = useMemo(() => {
    const s = new Set<string | number>()
    projects.forEach((p) => p.employees.forEach((e) => s.add(e.employee_id)))
    return s.size
  }, [projects])

  const totalHoursMd = totalHours / 8
  const avgHours = projects.length ? totalHours / projects.length : 0
  const isEmpty = projects.length === 0

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <h2 className="ps-dash-title">{t('ps.title') || 'Projects Summary'}</h2>
          <p className="ps-dash-subtitle">{t('ps.subtitle') || 'Monthly worklog analytics'}</p>
        </div>
        <div className="ps-controls flex-none">
          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <select className="ps-sel" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <span className="text-gray-300 text-sm select-none">/</span>
          <select className="ps-sel" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {MONTHS.slice(1).map((label, i) => (
              <option key={i + 1} value={i + 1}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isEmpty ? (
        <div className="ps-detail-card">
          <div className="ps-detail-header">
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
              />
            </svg>
            <span className="ps-detail-title">{t('ps.detail_title') || 'Project Breakdown'}</span>
          </div>
          <div className="text-sm text-gray-400 italic py-10 text-center">
            {t('ps.empty') || 'No project activity in this period.'}
          </div>
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="ps-kpi-grid">
            <div className="ps-kpi-card" style={{ '--kpi-color': '#4f46e5', '--kpi-color-bg': '#eef2ff' } as React.CSSProperties}>
              <div className="ps-kpi-icon">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
              </div>
              <span className="ps-kpi-value">{projects.length}</span>
              <span className="ps-kpi-label">{t('ps.kpi_projects') || 'Active Projects'}</span>
            </div>
            <div className="ps-kpi-card" style={{ '--kpi-color': '#10b981', '--kpi-color-bg': '#ecfdf5' } as React.CSSProperties}>
              <div className="ps-kpi-icon">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <span className="ps-kpi-value">{totalHoursMd.toFixed(1)}</span>
              <span className="ps-kpi-label">{t('ps.kpi_hours') || 'Total Hours'}</span>
            </div>
            <div className="ps-kpi-card" style={{ '--kpi-color': '#8b5cf6', '--kpi-color-bg': '#f5f3ff' } as React.CSSProperties}>
              <div className="ps-kpi-icon">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <span className="ps-kpi-value">{uniqueEmployees}</span>
              <span className="ps-kpi-label">{t('ps.kpi_employees') || 'Active Employees'}</span>
            </div>
            <div className="ps-kpi-card" style={{ '--kpi-color': '#f59e0b', '--kpi-color-bg': '#fffbeb' } as React.CSSProperties}>
              <div className="ps-kpi-icon">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <span className="ps-kpi-value">{avgHours.toFixed(1)}</span>
              <span className="ps-kpi-label">{t('ps.kpi_avg') || 'Avg hrs / Project'}</span>
            </div>
          </div>

          {/* Charts Row */}
          <div className="ps-charts-row">
            <div className="ps-chart-card">
              <div className="ps-chart-title">{t('ps.chart_hours_title') || 'Hours by Project'}</div>
              <div className="ps-chart-sub">{`${MONTHS[month]} ${year}`}</div>
              <BarChart projects={projects} />
            </div>
            <div className="ps-chart-card">
              <div className="ps-chart-title">{t('ps.chart_dist_title') || 'Distribution'}</div>
              <div className="ps-chart-sub">&nbsp;</div>
              <DonutChart projects={projects} totalHours={totalHours} />
            </div>
          </div>

          {/* Project Breakdown Table */}
          <div className="ps-detail-card">
            <div className="ps-detail-header">
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
              <span className="ps-detail-title">{t('ps.detail_title') || 'Project Breakdown'}</span>
            </div>
            <div>
              <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #f1f5f9' }}>
                    <th className="py-2.5 px-4 w-8" style={thStyle} />
                    <th className="py-2.5 px-4 text-left" style={thStyle}>
                      {t('ps.col_project') || 'PD'}
                    </th>
                    <th className="py-2.5 px-4 text-right" style={thStyle}>
                      {t('ps.col_employees') || 'Members'}
                    </th>
                    <th className="py-2.5 px-4 text-right" style={thStyle}>
                      {t('ps.col_hours') || 'Hours'}
                    </th>
                    <th className="py-2.5 px-4 text-left" style={{ ...thStyle, minWidth: '140px' }}>
                      {t('ps.col_share') || 'Share'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p, idx) => (
                    <ProjectRow
                      key={p.project_department}
                      p={p}
                      idx={idx}
                      totalHours={totalHours}
                      open={expanded.has(p.project_department)}
                      onToggle={() => toggle(p.project_department)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

const thStyle: React.CSSProperties = {
  fontSize: '.6875rem',
  color: '#94a3b8',
  textTransform: 'uppercase',
  letterSpacing: '.05em',
  fontWeight: 600,
}
