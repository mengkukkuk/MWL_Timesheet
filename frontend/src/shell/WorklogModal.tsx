// Additive React port of the shared Add/Edit Worklog modal
// (static/app/worklogs.js#openAddWorklog / openAddWorklogMulti / editWorklog /
// deleteWorklog + calendar.js#openAddWorklogForDate). Self-contained: owns its
// own form state and re-registers the same window.* globals the existing add
// buttons (templates/app.html) and worklog table/calendar (WorklogTable.tsx,
// WorklogCalendar.tsx) already call, so nothing else has to change when this is
// mounted by AppShell. Not wired in until AppShell replaces the vanilla shell.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, canManageMember, isElevated, t, toast, useCurrentUser } from '../lib'
import type { Member } from '../lib'
import { useDescriptions } from '../worklog/useWorklogsData'
import type { Worklog } from '../worklog/types'

type ModalMode = 'add' | 'multi' | 'edit'

interface WorklogForm {
  id: string
  dateFrom: string
  dateTo: string
  project: string
  task: string
  startHH: string
  startMM: string
  endHH: string
  endMM: string
  status: string
  isAllowance: boolean
  note: string
}

interface TimePreset {
  label: string
  value: string
}
interface TimePresets {
  start: TimePreset[]
  end: TimePreset[]
}

const STATUS_OPTIONS = ['Pending', 'In Progress', 'Done', 'Man day', 'Leave']

function today(): string {
  return new Date().toISOString().split('T')[0]
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function emptyForm(overrides: Partial<WorklogForm> = {}): WorklogForm {
  return {
    id: '',
    dateFrom: today(),
    dateTo: '',
    project: '',
    task: '',
    startHH: '08',
    startMM: '30',
    endHH: '',
    endMM: '',
    status: 'In Progress',
    isAllowance: false,
    note: '',
    ...overrides,
  }
}

// Inclusive list of YYYY-MM-DD between two dates (from static/app/worklogs.js).
function dateRange(from: string, to: string): string[] {
  const dates: string[] = []
  const cur = new Date(from + 'T00:00:00')
  const end = new Date((to && to >= from ? to : from) + 'T00:00:00')
  while (cur <= end) {
    dates.push(`${cur.getFullYear()}-${pad2(cur.getMonth() + 1)}-${pad2(cur.getDate())}`)
    cur.setDate(cur.getDate() + 1)
  }
  return dates
}

function clampTime(hh: string, mm: string): string | null {
  if (hh === '') return null
  const h = pad2(Math.min(23, Math.max(0, parseInt(hh, 10) || 0)))
  const m = pad2(Math.min(59, Math.max(0, parseInt(mm, 10) || 0)))
  return `${h}:${m}`
}

function readMemberSelect(): string {
  const el = document.getElementById('member-select') as HTMLSelectElement | null
  return el?.value || (window.currentMemberId != null ? String(window.currentMemberId) : '')
}

export function WorklogModal() {
  const user = useCurrentUser()
  const queryClient = useQueryClient()
  const descriptions = useDescriptions()

  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<ModalMode>('add')
  const [form, setForm] = useState<WorklogForm>(emptyForm)
  const [memberId, setMemberId] = useState('')
  const [multiChecked, setMultiChecked] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [, bumpLang] = useState(0)

  useEffect(() => {
    const onLang = () => bumpLang((n) => n + 1)
    window.addEventListener('mwl:langchange', onLang)
    return () => window.removeEventListener('mwl:langchange', onLang)
  }, [])

  const membersQuery = useQuery({
    queryKey: ['members'],
    queryFn: async () => {
      const r = await api<Member[]>('/api/members')
      return Array.isArray(r.data) ? r.data : []
    },
    staleTime: 10 * 60_000,
  })
  const members = membersQuery.data ?? []

  const presetsQuery = useQuery({
    queryKey: ['time-presets'],
    queryFn: async () => {
      const r = await api<TimePresets>('/api/settings/time-presets')
      return r.data ?? { start: [], end: [] }
    },
    staleTime: 10 * 60_000,
  })
  const presets = presetsQuery.data ?? { start: [], end: [] }

  // Existing-ranges data: worklogs for the from-date's month, fetched only while
  // the modal is open (mirrors worklogs.js reading the already-loaded rows).
  const [fy, fm] = useMemo(() => {
    if (!form.dateFrom) return [0, 0]
    return [parseInt(form.dateFrom.slice(0, 4), 10), parseInt(form.dateFrom.slice(5, 7), 10)]
  }, [form.dateFrom])

  const rangesQuery = useQuery({
    queryKey: ['worklogs', memberId, fy, fm],
    queryFn: async () => {
      const qs = `member_id=${encodeURIComponent(memberId)}&year=${fy}&month=${fm}`
      const r = await api<Worklog[]>(`/api/worklogs?${qs}`)
      return Array.isArray(r.data) ? r.data : []
    },
    enabled: open && !!memberId && !!form.dateFrom,
    staleTime: 30_000,
  })

  const projectOptions = useMemo(
    () =>
      (descriptions.data ?? [])
        .filter((p) => p.Status !== 'Closed' && p.Status !== 'Hold')
        .map((p) => p.Description),
    [descriptions.data],
  )

  const existingRanges = useMemo(() => {
    const rows = rangesQuery.data
    if (!open || !memberId || !form.dateFrom || !Array.isArray(rows)) return []
    const dates = form.dateTo ? dateRange(form.dateFrom, form.dateTo) : [form.dateFrom]
    const editingId = Number(form.id) || null
    const out: { date: string; label: string }[] = []
    dates.forEach((d) => {
      const entries = rows
        .filter(
          (w) =>
            w.log_date === d &&
            Number(w.member_id) === Number(memberId) &&
            (!editingId || Number(w.id) !== editingId) &&
            w.start_time &&
            w.end_time,
        )
        .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''))
      entries.forEach((w) => {
        const taskTxt = w.task ? ` — ${w.task}` : ''
        const prefix = dates.length > 1 ? `${d}: ` : ''
        out.push({ date: d, label: `${prefix}${w.start_time} – ${w.end_time}${taskTxt}` })
      })
    })
    return out
  }, [rangesQuery.data, open, memberId, form.dateFrom, form.dateTo, form.id])

  const close = useCallback(() => {
    setOpen(false)
    setMode('add')
    setMultiChecked(new Set())
  }, [])

  // ── window.* global registration (same contract as vanilla) ──
  useEffect(() => {
    const openAdd = () => {
      const mid = readMemberSelect()
      if (!mid) {
        toast(t('toast.select_member'), 'error')
        return
      }
      if (!canManageMember(user, mid)) {
        toast(t('toast.own_entries_only'), 'error')
        return
      }
      setMemberId(mid)
      setMode('add')
      setForm(emptyForm())
      setOpen(true)
    }

    const openMulti = () => {
      const mid = readMemberSelect()
      setMemberId(mid)
      setMode('multi')
      setForm(emptyForm())
      setMultiChecked(new Set(mid ? [mid] : []))
      setOpen(true)
    }

    const edit = (w: Worklog) => {
      const mid = readMemberSelect()
      if (!canManageMember(user, mid)) {
        toast(t('toast.own_edit_only'), 'error')
        return
      }
      setMemberId(mid)
      setMode('edit')
      const [sh, sm] = (w.start_time || '').split(':')
      const [eh, em] = (w.end_time || '').split(':')
      setForm({
        id: String(w.id),
        dateFrom: w.log_date,
        dateTo: '',
        project: w.project || '',
        task: w.task || '',
        startHH: sh ? pad2(parseInt(sh, 10) || 0) : '',
        startMM: sm ? pad2(parseInt(sm, 10) || 0) : '',
        endHH: eh ? pad2(parseInt(eh, 10) || 0) : '',
        endMM: em ? pad2(parseInt(em, 10) || 0) : '',
        status: w.status || 'Pending',
        isAllowance: Number(w.is_allowance) === 1,
        note: w.note || '',
      })
      setOpen(true)
    }

    const openForDate = (year: number, month: number, day: number) => {
      const mid = readMemberSelect()
      if (!mid) {
        toast(t('toast.select_member'), 'error')
        return
      }
      if (!canManageMember(user, mid)) {
        toast(t('toast.own_entries_only'), 'error')
        return
      }
      setMemberId(mid)
      setMode('add')
      setForm(emptyForm({ dateFrom: `${year}-${pad2(month)}-${pad2(day)}`, status: 'Pending' }))
      setOpen(true)
    }

    window.openAddWorklog = openAdd
    window.openAddWorklogMulti = openMulti
    window.editWorklog = edit
    window.openAddWorklogForDate = openForDate
    return () => {
      delete window.openAddWorklog
      delete window.openAddWorklogMulti
      delete window.editWorklog
      delete window.openAddWorklogForDate
    }
  }, [user])

  // deleteWorklog is independent of modal state.
  useEffect(() => {
    const del = async (id: number) => {
      if (!window.confirm('Delete this entry?')) return
      const r = await api(`/api/worklogs/${id}`, { method: 'DELETE' })
      if (r.error) {
        toast(r.error, 'error')
        return
      }
      toast(t('toast.entry_deleted'))
      window.dispatchEvent(new Event('mwl:reload'))
      window.dispatchEvent(new Event('mwl:dashboard'))
    }
    window.deleteWorklog = del
    return () => {
      delete window.deleteWorklog
    }
  }, [])

  const setField = <K extends keyof WorklogForm>(key: K, value: WorklogForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const toggleMulti = (id: string, checked: boolean) => {
    setMultiChecked((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const setAllMulti = (checked: boolean) => {
    setMultiChecked(checked ? new Set(members.map((m) => String(m.id))) : new Set())
  }

  const applyPreset = (which: 'start' | 'end', value: string) => {
    const [hh, mm] = value.split(':')
    if (which === 'start') {
      setField('startHH', hh ? pad2(parseInt(hh, 10) || 0) : '')
      setField('startMM', mm ? pad2(parseInt(mm, 10) || 0) : '')
    } else {
      setField('endHH', hh ? pad2(parseInt(hh, 10) || 0) : '')
      setField('endMM', mm ? pad2(parseInt(mm, 10) || 0) : '')
    }
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return
    const dates = form.id ? [form.dateFrom] : dateRange(form.dateFrom, form.dateTo)
    const basePayload = {
      project: form.project,
      task: form.task,
      start_time: clampTime(form.startHH, form.startMM),
      end_time: clampTime(form.endHH, form.endMM),
      status: form.status,
      note: form.note,
      is_allowance: form.isAllowance,
    }
    const ownMember = isElevated(user?.role) ? memberId : user?.member_id ?? memberId

    setSaving(true)
    try {
      if (form.id) {
        const r = await api(`/api/worklogs/${form.id}`, {
          method: 'PUT',
          json: { ...basePayload, log_date: form.dateFrom, member_id: ownMember },
        })
        if (r.error) {
          toast(r.error, 'error')
          return
        }
        toast(t('toast.entry_updated'))
      } else if (mode === 'multi') {
        const ids = Array.from(multiChecked)
        if (ids.length === 0) {
          toast(t('toast.select_one_member'), 'error')
          return
        }
        let ok = 0
        for (const mid of ids) {
          for (const d of dates) {
            const r = await api<{ id: number }>('/api/worklogs', {
              method: 'POST',
              json: { ...basePayload, log_date: d, member_id: Number(mid) },
            })
            if (r.data?.id) ok++
          }
        }
        const dayLabel = dates.length > 1 ? ` × ${dates.length} days` : ''
        toast(t('toast.added_multi', ok, ids.length, dayLabel))
      } else {
        let ok = 0
        for (const d of dates) {
          const r = await api<{ id: number }>('/api/worklogs', {
            method: 'POST',
            json: { ...basePayload, log_date: d, member_id: Number(ownMember) },
          })
          if (r.data?.id) ok++
        }
        if (ok === 0) {
          toast(t('toast.failed_save'), 'error')
          return
        }
        toast(dates.length > 1 ? t('toast.added_days', ok, dates.length) : t('toast.entry_added'))
      }
      close()
      queryClient.invalidateQueries({ queryKey: ['worklogs'] })
      window.dispatchEvent(new Event('mwl:reload'))
      window.dispatchEvent(new Event('mwl:dashboard'))
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const showRange = mode !== 'edit'
  const title =
    mode === 'edit'
      ? t('modal.edit_entry')
      : mode === 'multi'
        ? t('modal.add_multi_entry')
        : t('modal.add_entry')

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
          <button type="button" onClick={close} className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>
        <form onSubmit={onSubmit}>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="label">{showRange ? t('modal.from') : t('modal.date')}</label>
              <input
                type="date"
                className="input-field w-full"
                required
                value={form.dateFrom}
                onChange={(e) => setField('dateFrom', e.target.value)}
              />
            </div>
            {showRange && (
              <div className="col-span-2 sm:col-span-1">
                <label className="label">
                  {t('modal.to')}{' '}
                  <span className="font-normal text-gray-400 text-xs">{t('modal.to_opt')}</span>
                </label>
                <input
                  type="date"
                  className="input-field w-full"
                  value={form.dateTo}
                  onChange={(e) => setField('dateTo', e.target.value)}
                />
              </div>
            )}
            <div className="col-span-2 sm:col-span-1">
              <label className="label">{t('modal.project')}</label>
              <select
                className="input-field w-full"
                value={form.project}
                onChange={(e) => setField('project', e.target.value)}
              >
                <option value="">Select...</option>
                {projectOptions.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="label">{t('modal.task')}</label>
              <input
                type="text"
                className="input-field w-full"
                value={form.task}
                onChange={(e) => setField('task', e.target.value)}
              />
            </div>
            {existingRanges.length > 0 && (
              <div className="col-span-2 existing-ranges-box">
                <div className="existing-ranges-title">{t('modal.existing_ranges_title')}</div>
                <ul>
                  {existingRanges.map((r, i) => (
                    <li key={i}>{r.label}</li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <label className="label">{t('modal.start_time')}</label>
              <div className="time-picker-wrap">
                <input
                  type="text"
                  className="time-num hh"
                  maxLength={2}
                  placeholder="HH"
                  inputMode="numeric"
                  value={form.startHH}
                  onChange={(e) => setField('startHH', e.target.value.replace(/\D/g, ''))}
                />
                <span className="time-colon">:</span>
                <input
                  type="text"
                  className="time-num mm"
                  maxLength={2}
                  placeholder="MM"
                  inputMode="numeric"
                  value={form.startMM}
                  onChange={(e) => setField('startMM', e.target.value.replace(/\D/g, ''))}
                />
              </div>
              <div className="time-presets">
                {presets.start.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    className="time-preset-btn"
                    onClick={() => applyPreset('start', p.value)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">{t('modal.end_time')}</label>
              <div className="time-picker-wrap">
                <input
                  type="text"
                  className="time-num hh"
                  maxLength={2}
                  placeholder="HH"
                  inputMode="numeric"
                  value={form.endHH}
                  onChange={(e) => setField('endHH', e.target.value.replace(/\D/g, ''))}
                />
                <span className="time-colon">:</span>
                <input
                  type="text"
                  className="time-num mm"
                  maxLength={2}
                  placeholder="MM"
                  inputMode="numeric"
                  value={form.endMM}
                  onChange={(e) => setField('endMM', e.target.value.replace(/\D/g, ''))}
                />
              </div>
              <div className="time-presets">
                {presets.end.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    className="time-preset-btn"
                    onClick={() => applyPreset('end', p.value)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">{t('modal.status')}</label>
              <select
                className="input-field w-full"
                value={form.status}
                onChange={(e) => setField('status', e.target.value)}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={form.isAllowance}
                  onChange={(e) => setField('isAllowance', e.target.checked)}
                />
                <span className="text-xs text-gray-600">{t('modal.is_allowance')}</span>
              </label>
            </div>
            <div>
              <label className="label">{t('modal.note')}</label>
              <input
                type="text"
                className="input-field w-full"
                value={form.note}
                onChange={(e) => setField('note', e.target.value)}
              />
            </div>
          </div>

          {mode === 'multi' && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-1">
                <label className="label mb-0">{t('modal.apply_members')}</label>
                <div className="flex gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setAllMulti(true)}
                    className="text-indigo-600 hover:underline"
                  >
                    {t('modal.all')}
                  </button>
                  <span className="text-gray-300">|</span>
                  <button
                    type="button"
                    onClick={() => setAllMulti(false)}
                    className="text-gray-500 hover:underline"
                  >
                    {t('modal.none')}
                  </button>
                </div>
              </div>
              <div className="border border-gray-200 rounded-lg p-2 max-h-44 overflow-y-auto bg-gray-50">
                {members.map((m) => (
                  <label
                    key={m.id}
                    className="flex items-center gap-2 py-1 px-1 rounded cursor-pointer hover:bg-white"
                  >
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={multiChecked.has(String(m.id))}
                      onChange={(e) => toggleMulti(String(m.id), e.target.checked)}
                    />
                    <span className="text-sm text-gray-700">
                      {m.name} — {m.department}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 mt-5">
            <button type="button" onClick={close} className="btn-secondary">
              {t('modal.cancel')}
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {mode === 'multi' ? t('modal.save_selected') : t('modal.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
