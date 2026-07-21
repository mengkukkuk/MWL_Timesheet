// Monthly breakdown — the dashboard's signature element. Rendered from the
// months[] already returned by /api/dashboard, so no extra request. Each row is
// a keyboard-focusable button: activating it sets the vanilla #month-select and
// calls window.showTab('worklog') (unchanged hand-off to the rest of the app).
// The design spend: a proportional hours bar behind each Hours figure,
// normalized to the busiest month, turning the column into a year sparkline —
// echoing the login's workday-timeline motif. Figures are set in DM Mono.
import { monthName, t } from '../lib'

export interface MonthRow {
  month: number
  name?: string
  total_hours: number | string
  done: number
  missing?: number
  man_day: number | string
}

declare global {
  interface Window {
    showTab?: (name: string) => void
  }
}

function toNum(v: number | string | undefined): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0))
  return Number.isFinite(n) ? n : 0
}

function fmt(v: number | string | undefined): string {
  return String(Math.round(toNum(v) * 100) / 100)
}

function openMonth(month: number): void {
  const sel = document.getElementById('month-select') as HTMLSelectElement | null
  if (sel) sel.value = String(month)
  window.showTab?.('worklog')
}

export function MonthlyLedger({ months }: { months: MonthRow[] }) {
  const maxHours = months.reduce((m, r) => Math.max(m, toNum(r.total_hours)), 0) || 1

  return (
    <div className="mwl-ledger-wrap">
      <p className="mwl-eyebrow">{t('dash.monthly_breakdown') || 'Monthly Breakdown'}</p>
      <div className="mwl-ledger" role="table">
        <div className="mwl-ledger__head" role="row">
          <span role="columnheader">{t('dash.col_month') || 'Month'}</span>
          <span role="columnheader" className="mwl-ledger__num">
            {t('dash.col_hours') || 'Hours'}
          </span>
          <span role="columnheader" className="mwl-ledger__num">
            {t('dash.col_done') || 'Done'}
          </span>
          <span role="columnheader" className="mwl-ledger__num">
            {t('dash.col_missing') || 'Missing'}
          </span>
          <span role="columnheader" className="mwl-ledger__num">
            {t('dash.col_man_day') || 'Man day'}
          </span>
          <span role="columnheader" aria-hidden="true" />
        </div>
        {months.map((m) => {
          const hours = toNum(m.total_hours)
          const pct = Math.round((hours / maxHours) * 100)
          const missing = toNum(m.missing)
          return (
            <button
              type="button"
              className="mwl-ledger__row"
              role="row"
              key={m.month}
              onClick={() => openMonth(m.month)}
              title={`Open ${monthName(m.month)} work log`}
            >
              <span className="mwl-ledger__month" role="cell">
                {monthName(m.month) || m.name}
              </span>
              <span className="mwl-ledger__hours mwl-ledger__num" role="cell">
                <span className="mwl-ledger__bar" style={{ width: `${pct}%` }} aria-hidden="true" />
                <span className="mwl-ledger__hoursval">{fmt(hours)}</span>
              </span>
              <span className="mwl-ledger__num" role="cell">
                <span className="mwl-pill mwl-pill--done">{m.done}</span>
              </span>
              <span className="mwl-ledger__num" role="cell">
                {missing > 0 ? (
                  <span className="mwl-pill mwl-pill--missing">{missing}</span>
                ) : (
                  <span className="mwl-ledger__zero">0</span>
                )}
              </span>
              <span className="mwl-ledger__num" role="cell">
                <span className="mwl-pill mwl-pill--manday">{fmt(m.man_day)}</span>
              </span>
              <span className="mwl-ledger__chev" role="cell" aria-hidden="true">
                ›
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
