// Additive React port of the Allowance tab (static/app/allowance.js). Owns its
// own data (TanStack Query against /api/allowance), month dropdown, table, and
// the add/edit modal. Member + year come from the shared #member-select /
// #year-select DOM elements (tracked via change events) so it stays in sync
// with the rest of the shell. Not wired in until AppShell mounts it.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, canManageMember, isElevated, monthName, t, toast, useCurrentUser } from '../lib'
import { useDescriptions } from '../worklog/useWorklogsData'
import { AllowanceModal, type AllowanceDraft } from './AllowanceModal'

interface AllowanceRow {
  ID: number
  log_date: string
  ProjectCode?: string
  Description?: string
  type?: string
  IsEditRow: number
}

function readMemberYear(): { member: string; year: number } {
  const memberEl = document.getElementById('member-select') as HTMLSelectElement | null
  const yearEl = document.getElementById('year-select') as HTMLSelectElement | null
  const member = memberEl?.value || (window.currentMemberId != null ? String(window.currentMemberId) : '')
  const year = parseInt(yearEl?.value || '', 10) || new Date().getFullYear()
  return { member, year }
}

function useMemberYear(): { member: string; year: number } {
  const [ctx, setCtx] = useState(readMemberYear)
  useEffect(() => {
    const update = () => setCtx(readMemberYear())
    const els = ['member-select', 'year-select'].map((id) => document.getElementById(id))
    els.forEach((el) => el?.addEventListener('change', update))
    window.addEventListener('mwl:dashboard', update)
    return () => {
      els.forEach((el) => el?.removeEventListener('change', update))
      window.removeEventListener('mwl:dashboard', update)
    }
  }, [])
  return ctx
}

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

function today(): string {
  return new Date().toISOString().split('T')[0]
}

export function AllowanceTab() {
  const user = useCurrentUser()
  const queryClient = useQueryClient()
  const { member, year } = useMemberYear()
  const descriptions = useDescriptions()

  const [month, setMonth] = useState<number>(new Date().getMonth() + 1)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add')
  const [draft, setDraft] = useState<AllowanceDraft>({ id: '', log_date: today(), project: '' })
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [, bumpLang] = useState(0)

  useEffect(() => {
    const onLang = () => bumpLang((n) => n + 1)
    window.addEventListener('mwl:langchange', onLang)
    return () => window.removeEventListener('mwl:langchange', onLang)
  }, [])

  const canEdit = canManageMember(user, member)

  const query = useQuery({
    queryKey: ['allowance', member, year, month],
    queryFn: async () => {
      const r = await api<AllowanceRow[]>(
        `/api/allowance?member_id=${encodeURIComponent(member)}&year=${year}&month=${month}`,
      )
      return Array.isArray(r.data) ? r.data : []
    },
    enabled: !!member,
    staleTime: 30_000,
  })
  const rows = query.data ?? []

  const projectOptions = useMemo(
    () => (descriptions.data ?? []).map((p) => p.Description),
    [descriptions.data],
  )

  const save = useMutation({
    mutationFn: async (d: AllowanceDraft) => {
      if (!d.log_date) throw new Error(t('al.col_date'))
      if (!d.project) throw new Error(t('al.col_project'))
      const memberId = isElevated(user?.role) ? member : user?.member_id ?? member
      const body = { log_date: d.log_date, project: d.project, type: 'Normal', member_id: memberId }
      const r = d.id
        ? await api(`/api/allowance/${d.id}`, { method: 'PUT', json: body })
        : await api('/api/allowance', { method: 'POST', json: body })
      if (r.error) throw new Error(r.error)
      return !!d.id
    },
    onSuccess: (wasEdit) => {
      toast(wasEdit ? t('al.toast_updated') : t('al.toast_added'))
      setModalOpen(false)
      queryClient.invalidateQueries({ queryKey: ['allowance'] })
    },
    onError: (err) => toast(err instanceof Error ? err.message : 'Save failed', 'error'),
  })

  const remove = useMutation({
    mutationFn: async (id: number) => {
      const r = await api(`/api/allowance/${id}`, { method: 'DELETE' })
      if (r.error) throw new Error(r.error)
    },
    onSuccess: () => {
      toast(t('al.toast_deleted'))
      queryClient.invalidateQueries({ queryKey: ['allowance'] })
    },
    onError: (err) => toast(err instanceof Error ? err.message : 'Delete failed', 'error'),
    onSettled: () => setDeletingId(null),
  })

  const openAdd = useCallback(() => {
    if (!member) {
      toast(t('toast.select_member'), 'error')
      return
    }
    setModalMode('add')
    setDraft({ id: '', log_date: today(), project: '' })
    setModalOpen(true)
  }, [member])

  const openEdit = (a: AllowanceRow) => {
    if (Number(a.IsEditRow) !== 1) {
      toast(t('al.locked_msg'), 'error')
      return
    }
    setModalMode('edit')
    setDraft({ id: String(a.ID), log_date: a.log_date || '', project: a.Description || '' })
    setModalOpen(true)
  }

  const onDelete = (id: number) => {
    if (deletingId != null) return // a delete is already in flight
    if (!window.confirm(t('al.confirm_delete'))) return
    setDeletingId(id)
    remove.mutate(id)
  }

  if (!member) return null // AppShell shows the "select a member" placeholder

  return (
    <div className="mwl-fadein">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <label htmlFor="allowance-month-select" className="text-sm font-medium text-gray-700">
            {t('al.month_label')}
          </label>
          <select
            id="allowance-month-select"
            className="input-field"
            value={month}
            onChange={(e) => setMonth(parseInt(e.target.value, 10))}
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {monthName(m)}
              </option>
            ))}
          </select>
        </div>
        {canEdit && (
          <button type="button" className="btn-primary" onClick={openAdd}>
            {t('al.add_entry')}
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="text-center text-gray-400 py-10">{t('al.no_entries')}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200">
                <th className="py-2 px-3">{t('al.col_date')}</th>
                <th className="py-2 px-3">{t('al.col_project')}</th>
                <th className="py-2 px-3">{t('al.col_type')}</th>
                <th className="py-2 px-3 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const isEditable = Number(a.IsEditRow) === 1
                const typeCls = a.type === 'S' ? 'badge-manday' : 'badge-pending'
                const typeLabel = a.type === 'S' ? t('al.type_special') : t('al.type_normal')
                return (
                  <tr key={a.ID} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 px-3 whitespace-nowrap">{formatDate(a.log_date)}</td>
                    <td className="py-2 px-3">
                      <span className="project-name-cell" title={a.ProjectCode || ''}>
                        {a.Description || ''}
                      </span>
                    </td>
                    <td className="py-2 px-3">
                      <span className={`badge ${typeCls}`}>{typeLabel}</span>
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      {canEdit && isEditable && (
                        <>
                          <button
                            className="btn-icon"
                            title="Edit"
                            disabled={deletingId != null}
                            onClick={() => openEdit(a)}
                          >
                            ✎
                          </button>
                          <button
                            className="btn-icon danger"
                            title="Delete"
                            disabled={deletingId != null}
                            onClick={() => onDelete(a.ID)}
                          >
                            {deletingId === a.ID ? '…' : '🗑'}
                          </button>
                        </>
                      )}
                      {canEdit && !isEditable && (
                        <span className="inline-flex items-center text-gray-300" title="Row is locked">
                          🔒
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <AllowanceModal
          mode={modalMode}
          initial={draft}
          projectOptions={projectOptions}
          saving={save.isPending}
          onClose={() => setModalOpen(false)}
          onSubmit={(d) => save.mutate(d)}
        />
      )}
    </div>
  )
}
