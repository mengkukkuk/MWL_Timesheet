// Work Log React island. Mounts inside the existing SPA shell's
// #worklog-view-root and owns the *display*: filters, table/calendar toggle,
// row selection + bulk bar, missing-entry bar, and the active view. It never
// fetches or mutates data itself — static/app/worklogs.js#loadWorklogs()
// remains the single fetcher (member/year/month selects already trigger it
// via the existing core.js wiring) and stashes the result on
// window.__mwlWorklogs before dispatching `mwl:worklogs`, which this island
// listens for. Every mutation (add/edit/delete/bulk) delegates to the
// existing vanilla globals so the modal, overlap detection, and CRUD
// endpoints stay completely untouched.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { canManageMember, t, useCurrentUser } from '../lib'
import { CalendarIcon, SearchIcon, TableIcon, WarnIcon } from './icons'
import type { WorklogsPayload } from './types'
import { WorklogCalendar } from './WorklogCalendar'
import { WorklogTable } from './WorklogTable'

type ViewMode = 'table' | 'calendar'
const VIEW_STORAGE_KEY = 'mwl.worklog.view'

function readSelect(id: string): string {
  const el = document.getElementById(id) as HTMLSelectElement | null
  return el?.value || ''
}

function readSavedView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === 'calendar' ? 'calendar' : 'table'
  } catch {
    return 'table'
  }
}

export function WorklogIsland() {
  const user = useCurrentUser()
  const [payload, setPayload] = useState<WorklogsPayload | null>(null)
  const [memberId, setMemberId] = useState<string>(() => readSelect('member-select'))
  const [view, setView] = useState<ViewMode>(readSavedView)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [project, setProject] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [, bumpLang] = useState(0)

  const sync = useCallback(() => {
    setMemberId(readSelect('member-select'))
    setPayload(window.__mwlWorklogs ?? null)
  }, [])

  useEffect(() => {
    sync()
    const onEvent = () => sync()
    const onLang = () => bumpLang((n) => n + 1)
    const memberSel = document.getElementById('member-select')
    window.addEventListener('mwl:worklogs', onEvent)
    memberSel?.addEventListener('change', onEvent)
    window.addEventListener('mwl:langchange', onLang)
    return () => {
      window.removeEventListener('mwl:worklogs', onEvent)
      memberSel?.removeEventListener('change', onEvent)
      window.removeEventListener('mwl:langchange', onLang)
    }
  }, [sync])

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view)
    } catch {
      /* storage unavailable — view choice just won't persist */
    }
  }, [view])

  const worklogs = payload?.worklogs ?? []
  const holidays = payload?.holidays ?? []
  const year = payload?.year ?? new Date().getFullYear()
  const month = payload?.month ?? new Date().getMonth() + 1
  const canEdit = canManageMember(user, memberId)

  // Prune selection to ids still present in the current data (mirrors the
  // vanilla renderWorklogs()'s "drop selections no longer visible" step).
  useEffect(() => {
    setSelected((prev) => {
      const visible = new Set(worklogs.map((w) => w.id))
      let changed = false
      const next = new Set<number>()
      prev.forEach((id) => {
        if (visible.has(id)) next.add(id)
        else changed = true
      })
      return changed ? next : prev
    })
  }, [worklogs])

  const projectOptions = useMemo(() => {
    const seen = new Set<string>()
    const list: string[] = []
    worklogs.forEach((w) => {
      if (w.project && !seen.has(w.project)) {
        seen.add(w.project)
        list.push(w.project)
      }
    })
    return list
  }, [worklogs])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return worklogs.filter((w) => {
      if (status && w.status !== status) return false
      if (project && w.project !== project) return false
      if (q) {
        const hay = `${w.project || ''} ${w.task || ''} ${w.note || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [worklogs, search, status, project])

  const filtersActive = !!(search || status || project)

  const missingCount = useMemo(() => {
    if (!payload) return 0
    const daysInMonth = new Date(year, month, 0).getDate()
    const daysWithEntry = new Set<number>()
    worklogs.forEach((w) => {
      if (!w.log_date) return
      daysWithEntry.add(parseInt(w.log_date.split('-')[2], 10))
    })
    const holidayDays = new Set<number>()
    holidays.forEach((h) => {
      if (!h.date) return
      holidayDays.add(parseInt(h.date.split('-')[2], 10))
    })
    let missing = 0
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = new Date(year, month - 1, d).getDay()
      if (dow === 0 || dow === 6) continue
      if (holidayDays.has(d)) continue
      if (!daysWithEntry.has(d)) missing++
    }
    return missing
  }, [worklogs, holidays, year, month, payload])

  const toggleRow = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = (ids: number[], checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => (checked ? next.add(id) : next.delete(id)))
      return next
    })
  }

  const bulkDelete = async () => {
    await window.bulkDeleteWorklogs?.(Array.from(selected))
    setSelected(new Set())
  }

  if (!memberId) return null // vanilla #worklog-no-member already handles this state

  return (
    <div className="wl-root mwl-fadein">
      <div className="wl-toolbar">
        <div className="wl-view-toggle" role="tablist" aria-label="Worklog view">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'table'}
            className={`wl-view-toggle__btn ${view === 'table' ? 'active' : ''}`}
            onClick={() => setView('table')}
            title="Table view"
          >
            <TableIcon />
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'calendar'}
            className={`wl-view-toggle__btn ${view === 'calendar' ? 'active' : ''}`}
            onClick={() => setView('calendar')}
            title="Calendar view"
          >
            <CalendarIcon />
          </button>
        </div>
      </div>

      <div className="wl-filterbar">
        <div className="wl-search">
          <SearchIcon />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('wl.search_ph') || 'Search by project, task, or note...'}
            className="wl-search__input"
          />
        </div>
        <select className="wl-select" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('wl.all_status') || 'All Status'}</option>
          <option value="Done">Done</option>
          <option value="In Progress">In Progress</option>
          <option value="Pending">Pending</option>
          <option value="Man day">Man day</option>
        </select>
        <select className="wl-select" value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="">{t('wl.all_projects') || 'All Projects'}</option>
          {projectOptions.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="wl-btn-clear"
          onClick={() => {
            setSearch('')
            setStatus('')
            setProject('')
          }}
        >
          {t('wl.clear') || 'Clear'}
        </button>
        {filtersActive ? (
          <span className="wl-filter-count">{t('wl.filter_count', filtered.length, worklogs.length)}</span>
        ) : null}
      </div>

      {missingCount > 0 ? (
        <div className="wl-missing-bar">
          <WarnIcon />
          <span>
            Total missing entry = {missingCount} day{missingCount !== 1 ? 's' : ''}
          </span>
        </div>
      ) : null}

      {selected.size > 0 ? (
        <div className="wl-bulk-bar">
          <span className="wl-bulk-bar__count">
            {selected.size} {t('wl.bulk_selected') || 'selected'}
          </span>
          <div className="wl-bulk-bar__spacer" />
          <button
            type="button"
            className="wl-btn-secondary"
            onClick={() => window.openBulkEditModal?.(Array.from(selected))}
          >
            {t('wl.bulk_edit') || 'Bulk Edit'}
          </button>
          <button type="button" className="wl-btn-secondary wl-btn-danger" onClick={bulkDelete}>
            {t('wl.bulk_delete') || 'Bulk Delete'}
          </button>
          <button type="button" className="wl-btn-secondary" onClick={() => setSelected(new Set())}>
            {t('btn.cancel') || 'Cancel'}
          </button>
        </div>
      ) : null}

      {view === 'table' ? (
        <WorklogTable
          worklogs={filtered}
          canEdit={canEdit}
          selected={selected}
          onToggleRow={toggleRow}
          onToggleAll={toggleAll}
        />
      ) : (
        <WorklogCalendar worklogs={filtered} holidays={holidays} year={year} month={month} canEdit={canEdit} />
      )}
    </div>
  )
}