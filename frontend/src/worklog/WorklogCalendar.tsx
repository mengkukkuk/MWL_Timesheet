// Ports the vanilla renderCalendar()/openDayPopover() (static/app/calendar.js)
// to React state/JSX with a refined-glass restyle and chip entrance animation.
// Editing/adding still delegates to the vanilla modal globals.
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { statusClass } from './format'
import { t } from '../lib'
import type { Holiday, Worklog } from './types'

const MAX_CHIPS = 3
const DOW_KEYS = ['cal.mon', 'cal.tue', 'cal.wed', 'cal.thu', 'cal.fri', 'cal.sat', 'cal.sun']

interface DayCell {
  key: string
  dayNum: number
  displayDay: number
  isOutside: boolean
  isWeekend: boolean
  isToday: boolean
  isHoliday: boolean
  holidayLabel?: string
  isMissing: boolean
  entries: Worklog[]
}

function buildCells(worklogs: Worklog[], holidays: Holiday[], year: number, month: number): DayCell[] {
  const byDay: Record<number, Worklog[]> = {}
  worklogs.forEach((w) => {
    if (!w.log_date) return
    const day = parseInt(w.log_date.split('-')[2], 10)
    if (!byDay[day]) byDay[day] = []
    byDay[day].push(w)
  })

  const byHoliday: Record<number, string> = {}
  holidays.forEach((h) => {
    if (!h?.date) return
    const parts = h.date.split('-').map(Number)
    const [hy, hm, hd] = parts
    if (hy === year && hm === month) byHoliday[hd] = (h.description || '').trim()
  })

  const firstOfMonth = new Date(year, month - 1, 1)
  const daysInMonth = new Date(year, month, 0).getDate()
  const startDow = (firstOfMonth.getDay() + 6) % 7
  const prevMonthDays = new Date(year, month - 1, 0).getDate()
  const totalCells = Math.ceil((startDow + daysInMonth) / 7) * 7

  const today = new Date()
  const isThisMonth = today.getFullYear() === year && today.getMonth() + 1 === month
  const todayDay = today.getDate()

  const cells: DayCell[] = []
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - startDow + 1
    const isOutside = dayNum < 1 || dayNum > daysInMonth
    const colIdx = i % 7
    const isWeekend = colIdx >= 5
    const displayDay = dayNum < 1 ? prevMonthDays + dayNum : dayNum > daysInMonth ? dayNum - daysInMonth : dayNum
    const entries = !isOutside ? byDay[dayNum] || [] : []
    const isHoliday = !isOutside && Object.prototype.hasOwnProperty.call(byHoliday, dayNum)
    const isToday = !isOutside && isThisMonth && dayNum === todayDay
    const isMissing = !isOutside && !isWeekend && !isToday && !isHoliday && entries.length === 0
    cells.push({
      key: String(i),
      dayNum,
      displayDay,
      isOutside,
      isWeekend,
      isToday,
      isHoliday,
      holidayLabel: isHoliday ? byHoliday[dayNum] : undefined,
      isMissing,
      entries,
    })
  }
  return cells
}

function displayHoursFor(entries: Worklog[]): number {
  const toMin = (time: string) => {
    const [h, m] = time.split(':').map(Number)
    return h * 60 + m
  }
  const timed = entries.filter((e) => e.start_time && e.end_time)
  if (timed.length > 0) {
    const minStart = Math.min(...timed.map((e) => toMin(e.start_time as string)))
    const maxEnd = Math.max(...timed.map((e) => toMin(e.end_time as string)))
    return (maxEnd - minStart) / 60
  }
  return Math.max(0, ...entries.map((e) => e.hours || 0))
}

interface PopoverState {
  day: number
  entries: Worklog[]
  x: number
  y: number
}

interface WorklogCalendarProps {
  worklogs: Worklog[]
  holidays: Holiday[]
  year: number
  month: number
  canEdit: boolean
}

export function WorklogCalendar({ worklogs, holidays, year, month, canEdit }: WorklogCalendarProps) {
  const cells = useMemo(() => buildCells(worklogs, holidays, year, month), [worklogs, holidays, year, month])
  const [popover, setPopover] = useState<PopoverState | null>(null)

  const totalHours = worklogs.reduce((sum, w) => sum + (w.hours || 0), 0)

  return (
    <div className="wl-cal-wrap">
      <div className="wl-cal">
        <div className="wl-cal-grid wl-cal-header">
          {DOW_KEYS.map((k, i) => (
            <div key={k} className={`wl-cal-dow ${i >= 5 ? 'wl-cal-dow--weekend' : ''}`}>
              {t(k)}
            </div>
          ))}
        </div>
        <div className="wl-cal-grid wl-cal-body">
          {cells.map((cell) => (
            <DayCellView
              key={cell.key}
              cell={cell}
              canEdit={canEdit}
              year={year}
              month={month}
              onOpenPopover={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                setPopover({ day: cell.dayNum, entries: cell.entries, x: rect.left, y: rect.bottom })
              }}
            />
          ))}
        </div>
      </div>
      <div className="wl-cal-summary">
        <span className="wl-cal-summary__text">
          {t('cal.summary', worklogs.length, totalHours.toFixed(1)) ||
            `${worklogs.length} entries · ${totalHours.toFixed(1)}h`}
        </span>
        <span className="wl-cal-legend">
          <LegendDot cls="wl-pill--done" label={t('legend.done') || 'Done'} />
          <LegendDot cls="wl-pill--progress" label={t('legend.in_progress') || 'In Progress'} />
          <LegendDot cls="wl-pill--pending" label={t('legend.pending') || 'Pending'} />
        </span>
      </div>
      {popover ? (
        <DayPopover state={popover} year={year} month={month} canEdit={canEdit} onClose={() => setPopover(null)} />
      ) : null}
    </div>
  )
}

function LegendDot({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="wl-cal-legend__item">
      <span className={`wl-cal-legend__dot ${cls}`} />
      <span className="wl-cal-legend__label">{label}</span>
    </span>
  )
}

function DayCellView({
  cell,
  canEdit,
  year,
  month,
  onOpenPopover,
}: {
  cell: DayCell
  canEdit: boolean
  year: number
  month: number
  onOpenPopover: (e: ReactMouseEvent<HTMLButtonElement>) => void
}) {
  const cls = [
    'wl-cal-cell',
    cell.isOutside && 'wl-cal-cell--outside',
    cell.isWeekend && 'wl-cal-cell--weekend',
    cell.isToday && 'wl-cal-cell--today',
    cell.isHoliday && 'wl-cal-cell--holiday',
    cell.isMissing && 'wl-cal-cell--missing',
  ]
    .filter(Boolean)
    .join(' ')

  const visible = cell.entries.slice(0, MAX_CHIPS)
  const overflow = cell.entries.length - MAX_CHIPS
  const displayHours = cell.entries.length > 0 ? displayHoursFor(cell.entries) : 0
  const canAdd = canEdit && !cell.isOutside && !cell.isHoliday

  return (
    <div
      className={cls}
      onDoubleClick={() => {
        if (canAdd) window.openAddWorklogForDate?.(year, month, cell.dayNum)
      }}
    >
      <span className="wl-cal-daynum">{cell.displayDay}</span>
      {!cell.isOutside ? (
        <>
          {cell.isHoliday ? (
            <div className="wl-cal-holiday" title={cell.holidayLabel}>
              {cell.holidayLabel}
            </div>
          ) : null}
          {displayHours > 0 ? <span className="wl-cal-hours">{displayHours.toFixed(1)}h</span> : null}
          <div className="wl-cal-entries">
            {visible.map((w) => (
              <button
                type="button"
                key={w.id}
                className={`wl-chip ${statusClass(w.status)}`}
                title={`${w.project || ''} — ${w.task || ''}\n${w.start_time || ''} - ${w.end_time || ''}${
                  w.hours ? ` (${w.hours.toFixed(1)}h)` : ''
                }`}
                onClick={(e) => {
                  if (!(canEdit && Number(w.IsEditRow) !== 0)) return
                  e.stopPropagation()
                  window.editWorklog?.(w)
                }}
              >
                <span className="wl-chip__dot" />
                <span className="wl-chip__text">{w.project || w.task || 'Entry'}</span>
              </button>
            ))}
            {overflow > 0 ? (
              <button
                type="button"
                className="wl-cal-more"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpenPopover(e)
                }}
              >
                +{overflow} more
              </button>
            ) : null}
          </div>
          {canAdd ? (
            <button
              type="button"
              className="wl-cal-add"
              title="Add entry"
              onClick={(e) => {
                e.stopPropagation()
                window.openAddWorklogForDate?.(year, month, cell.dayNum)
              }}
            >
              +
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function DayPopover({
  state,
  year,
  month,
  canEdit,
  onClose,
}: {
  state: PopoverState
  year: number
  month: number
  canEdit: boolean
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: state.x, top: state.y, ready: false })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    let x = state.x
    let y = state.y
    if (x + rect.width > window.innerWidth - 16) x = window.innerWidth - rect.width - 16
    if (y + rect.height > window.innerHeight - 16) y = window.innerHeight - rect.height - 16
    if (y < 8) y = 8
    if (x < 8) x = 8
    setPos({ left: x, top: y, ready: true })
  }, [state])

  useLayoutEffect(() => {
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('click', onOutside)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('click', onOutside)
      document.removeEventListener('keydown', onEsc)
    }
  }, [onClose])

  const dateLabel = new Date(year, month - 1, state.day).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  const totalH = state.entries.reduce((sum, e) => sum + (e.hours || 0), 0)

  return (
    <div
      ref={ref}
      className="wl-popover"
      style={{ left: pos.left, top: pos.top, visibility: pos.ready ? 'visible' : 'hidden' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="wl-popover__header">
        <div>
          <div className="wl-popover__title">{dateLabel}</div>
          <div className="wl-popover__meta">
            {state.entries.length} entries · {totalH.toFixed(1)}h
          </div>
        </div>
        <button type="button" className="wl-popover__close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="wl-popover__list">
        {state.entries.map((w) => {
          const canClick = canEdit && Number(w.IsEditRow) !== 0
          const time = [w.start_time, w.end_time].filter(Boolean).join(' – ')
          const hours = w.hours ? `${w.hours.toFixed(1)}h` : ''
          const meta = [time, hours].filter(Boolean).join(' · ')
          return (
            <div
              key={w.id}
              className={`wl-popover__entry ${canClick ? 'wl-popover__entry--clickable' : ''}`}
              onClick={
                canClick
                  ? () => {
                      onClose()
                      window.editWorklog?.(w)
                    }
                  : undefined
              }
            >
              <span className={`wl-popover__dot ${statusClass(w.status)}`} />
              <div className="wl-popover__content">
                <div className="wl-popover__project">{w.project || '(no project)'}</div>
                <div className="wl-popover__task">{w.task || ''}</div>
                {meta ? <div className="wl-popover__submeta">{meta}</div> : null}
              </div>
            </div>
          )
        })}
      </div>
      {canEdit ? (
        <div className="wl-popover__footer">
          <button
            type="button"
            className="wl-popover__cta"
            onClick={() => {
              onClose()
              window.openAddWorklogForDate?.(year, month, state.day)
            }}
          >
            + {t('modal.add_entry') || 'Add Entry'}
          </button>
        </div>
      ) : null}
    </div>
  )
}