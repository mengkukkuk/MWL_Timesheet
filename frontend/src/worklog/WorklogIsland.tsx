// Work Log React island, rendered by AppShell. Owns the *display* (month
// picker, filters, table/calendar toggle, row selection + bulk bar,
// missing-entry bar) and the *data layer* via TanStack Query
// (useWorklogsData). The member/year/month context is passed in as props —
// AppShell holds it in the URL (?member=&y=&m=) — so a month change is a plain
// state update rather than a DOM `change` event on #month-select. Bulk
// edit/delete are React mutations with optimistic updates; bulk edit hits
// PATCH /api/worklogs/bulk. Single add/edit/delete delegate to the shared
// modal (window.editWorklog / deleteWorklog / openAddWorklog), and the fetched
// rows are mirrored into `worklogData` via window.__mwlSetWorklogData so that
// modal's renderExistingRanges() stays correct on every tab.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, canManageMember, monthName, t, toast, useCurrentUser } from '../lib'
import { CalendarIcon, SearchIcon, TableIcon, WarnIcon } from './icons'
import type { Worklog, WorklogsPayload } from './types'
import { useWorklogsData, worklogsQueryKey } from './useWorklogsData'
import { BulkEditModal, type BulkFields } from './BulkEditModal'
import { WorklogCalendar } from './WorklogCalendar'
import { WorklogTable } from './WorklogTable'
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Spinner } from '../shell/Spinner'

type ViewMode = 'table' | 'calendar'
const VIEW_STORAGE_KEY = 'mwl.worklog.view'

function readSavedView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === 'calendar' ? 'calendar' : 'table'
  } catch {
    return 'table'
  }
}

// Optimistic projection of a bulk patch onto a single row. Mirrors what BE-1
// writes server-side: project sets project_description (the display field);
// onSettled invalidation reconciles project code + department with server truth.
function applyBulkFields(w: Worklog, fields: BulkFields): Worklog {
  const next = { ...w }
  if (fields.project !== undefined) next.project_description = fields.project
  if (fields.status !== undefined) next.status = fields.status
  if (fields.note !== undefined) next.note = fields.note
  return next
}

export interface WorklogIslandProps {
  memberId: string
  year: number
  month: number
  onMonthChange: (month: number) => void
}

export function WorklogIsland({ memberId, year, month, onMonthChange }: WorklogIslandProps) {
  const user = useCurrentUser()
  const queryClient = useQueryClient()
  const ctx = useMemo(() => ({ member: memberId, year, month }), [memberId, year, month])
  const query = useWorklogsData(ctx)
  const queryKey = worklogsQueryKey(ctx)

  const [view, setView] = useState<ViewMode>(readSavedView)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [project, setProject] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [showBulkEdit, setShowBulkEdit] = useState(false)
  const [, bumpLang] = useState(0)

  const payload = query.data ?? null
  const worklogs = useMemo(() => payload?.worklogs ?? [], [payload])
  const holidays = payload?.holidays ?? []
  const canEdit = canManageMember(user, memberId)
  // While the next month is in flight the query still serves the previous
  // month's payload (keepPreviousData), so derived views must not treat it as
  // belonging to the newly selected month.
  const showingStaleMonth = query.isPlaceholderData

  const changeMonth = (direction: -1 | 1) => {
    const next = month + direction
    onMonthChange(next < 1 ? 12 : next > 12 ? 1 : next)
  }

  // Re-render on language toggle (vanilla i18n fires this global event).
  useEffect(() => {
    const onLang = () => bumpLang((n) => n + 1)
    window.addEventListener('mwl:langchange', onLang)
    return () => window.removeEventListener('mwl:langchange', onLang)
  }, [])

  // A vanilla mutation (single add/edit/delete via the shared modal) dispatches
  // 'mwl:reload' — treat it as a cache invalidation so this island refetches.
  useEffect(() => {
    const onReload = () => queryClient.invalidateQueries({ queryKey: ['worklogs'] })
    window.addEventListener('mwl:reload', onReload)
    return () => window.removeEventListener('mwl:reload', onReload)
  }, [queryClient])

  // Mirror fetched rows into vanilla core.js `worklogData` (kept alive for the
  // shared add/edit modal) and toggle the vanilla "Add" button, which
  // loadWorklogs() used to own before PR3 moved the fetch here.
  useEffect(() => {
    window.__mwlSetWorklogData?.(worklogs)
  }, [worklogs])

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view)
    } catch {
      /* storage unavailable — view choice just won't persist */
    }
  }, [view])

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

  const bulkEdit = useMutation({
    mutationFn: async (fields: BulkFields) => {
      const ids = Array.from(selected)
      const r = await api<{ updated: number[]; failed: unknown[] }>('/api/worklogs/bulk', {
        method: 'PATCH',
        json: { ids, fields },
      })
      if (!r.ok) throw new Error(r.error || 'Bulk edit failed')
      return r.data
    },
    onMutate: async (fields: BulkFields) => {
      await queryClient.cancelQueries({ queryKey })
      const prev = queryClient.getQueryData<WorklogsPayload>(queryKey)
      if (prev) {
        const ids = new Set(selected)
        queryClient.setQueryData<WorklogsPayload>(queryKey, {
          ...prev,
          worklogs: prev.worklogs.map((w) => (ids.has(w.id) ? applyBulkFields(w, fields) : w)),
        })
      }
      return { prev }
    },
    onError: (err, _fields, context) => {
      if (context?.prev) queryClient.setQueryData(queryKey, context.prev)
      toast(err instanceof Error ? err.message : 'Bulk edit failed', 'error')
    },
    onSuccess: (data) => {
      const n = data?.updated?.length ?? 0
      if (n) toast(`Updated ${n} entr${n === 1 ? 'y' : 'ies'}`)
      setShowBulkEdit(false)
      setSelected(new Set())
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  })

  const bulkDelete = useMutation({
    mutationFn: async (ids: number[]) => {
      let ok = 0
      let fail = 0
      for (const id of ids) {
        const r = await api(`/api/worklogs/${id}`, { method: 'DELETE' })
        if (r.ok) ok++
        else fail++
      }
      return { ok, fail }
    },
    onMutate: async (ids: number[]) => {
      await queryClient.cancelQueries({ queryKey })
      const prev = queryClient.getQueryData<WorklogsPayload>(queryKey)
      if (prev) {
        const remove = new Set(ids)
        queryClient.setQueryData<WorklogsPayload>(queryKey, {
          ...prev,
          worklogs: prev.worklogs.filter((w) => !remove.has(w.id)),
        })
      }
      return { prev }
    },
    onError: (_err, _ids, context) => {
      if (context?.prev) queryClient.setQueryData(queryKey, context.prev)
      toast('Delete failed', 'error')
    },
    onSuccess: ({ ok, fail }) => {
      if (ok) toast(`Deleted ${ok} entr${ok === 1 ? 'y' : 'ies'}`)
      if (fail) toast(`${fail} delete${fail === 1 ? '' : 's'} failed`, 'error')
      setSelected(new Set())
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  })

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
    if (!payload || showingStaleMonth) return 0
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
  }, [worklogs, holidays, year, month, payload, showingStaleMonth])

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

  const onBulkDelete = useCallback(() => {
    const ids = Array.from(selected)
    if (!ids.length) return
    if (!window.confirm(`Delete ${ids.length} selected entr${ids.length === 1 ? 'y' : 'ies'}?`)) return
    bulkDelete.mutate(ids)
  }, [selected, bulkDelete])

  return (
    <div className="wl-root mwl-fadein">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex items-center gap-2 flex-none">
          <label
              htmlFor="month-select"
              className="text-sm font-medium text-gray-600"
          >
            {t("wl.month_label") || "Month:"}
          </label>

          <button
              type="button"
              aria-label={t('wl.prev_month')}
              onClick={() => changeMonth(-1)}
              className="p-2 rounded hover:bg-gray-100"
          >
            <ChevronLeft size={18} />
          </button>

          <select
              id="month-select"
              value={month}
              onChange={(e) => onMonthChange(parseInt(e.target.value, 10))}
              className="input-field w-36"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {monthName(m)}
                </option>
            ))}
          </select>

          <button
              type="button"
              aria-label={t('wl.next_month')}
              onClick={() => changeMonth(1)}
              className="p-2 rounded hover:bg-gray-100"
          >
            <ChevronRight size={18} />
          </button>
          {query.isFetching && !query.isPending && <Spinner size="sm" />}
        </div>

        <div className="flex-1" />
        {canEdit && (
          <button
            type="button"
            id="btn-add-worklog-multi"
            onClick={() => window.openAddWorklogMulti?.()}
            className="btn-secondary flex-none"
          >
            <span className="hidden sm:inline">{t('wl.add_multi') || '+ Add Entry for Multiple'}</span>
            <span className="sm:hidden">+ Multi</span>
          </button>
        )}
        {canEdit && (
          <button
            type="button"
            id="btn-add-worklog"
            onClick={() => window.openAddWorklog?.()}
            className="btn-primary flex-none"
          >
            {t('wl.add_entry') || 'Add Entry'}
          </button>
        )}
      </div>
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
          <button type="button" className="wl-btn-secondary" onClick={() => setShowBulkEdit(true)}>
            {t('wl.bulk_edit') || 'Bulk Edit'}
          </button>
          <button
            type="button"
            className="wl-btn-secondary wl-btn-danger"
            onClick={onBulkDelete}
            disabled={bulkDelete.isPending}
          >
            {t('wl.bulk_delete') || 'Bulk Delete'}
          </button>
          <button type="button" className="wl-btn-secondary" onClick={() => setSelected(new Set())}>
            {t('btn.cancel') || 'Cancel'}
          </button>
        </div>
      ) : null}

      {query.isPending ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-gray-400">
          <Spinner />
          <span>{t('wl.loading')}</span>
        </div>
      ) : query.isError ? (
        <div className="wl-missing-bar">
          <WarnIcon />
          <span>{t('wl.load_failed')}</span>
          <button type="button" className="wl-btn-secondary" onClick={() => query.refetch()}>
            {t('sel.retry') || 'Retry'}
          </button>
        </div>
      ) : view === 'table' ? (
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

      {showBulkEdit ? (
        <BulkEditModal
          count={selected.size}
          submitting={bulkEdit.isPending}
          onClose={() => setShowBulkEdit(false)}
          onSubmit={(fields) => bulkEdit.mutate(fields)}
        />
      ) : null}
    </div>
  )
}
