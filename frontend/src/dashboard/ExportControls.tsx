// PR4: React port of static/app/export.js. Renders the two export buttons that
// used to live inside #dashboard-content (Export to Excel + Export Multiple)
// plus the month-filter and bulk-export modals. Downloads still go through a
// hard `window.location.href` to /api/export/excel[/bulk] (browser file
// download — fetch can't stream an attachment to disk), exactly as the vanilla
// module did. Context (member/year) is read from the vanilla #member-select /
// #year-select controls; the bulk member list is read from #member-select's
// options. The "Export Multiple" button is elevated-only (replaces core.js:81's
// classList toggle of #btn-export-multiple).
import { useEffect, useState } from 'react'
import { isElevated, t, toast, useCurrentUser } from '../lib'

declare global {
  interface Window {
    // Optional vanilla-i18n helper. Absent in the React SPA bundle (monthAbbrs
    // then falls back to English); may still be present on other server-rendered
    // pages that load static/app/i18n.js.
    t?: (key: string) => unknown
  }
}

interface MemberOption {
  id: string
  name: string
}

type ExportCtx =
  | { mode: 'single'; memberId: string; year: string }
  | { mode: 'bulk'; memberIds: string[]; year: string }

function readSelect(id: string): string {
  const el = document.getElementById(id) as HTMLSelectElement | null
  return el?.value || ''
}

function currentMemberId(): string {
  const fromGlobal = window.currentMemberId
  if (fromGlobal !== undefined && fromGlobal !== null && fromGlobal !== '') {
    return String(fromGlobal)
  }
  return readSelect('member-select')
}

// 1-indexed abbreviations (index 0 is a placeholder), mirroring i18n `months.abbr`.
function monthAbbrs(): string[] {
  const arr = typeof window.t === 'function' ? (window.t('months.abbr') as unknown) : null
  if (Array.isArray(arr)) return arr.map(String)
  return ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
}

function readMemberOptions(): MemberOption[] {
  const sel = document.getElementById('member-select') as HTMLSelectElement | null
  if (!sel) return []
  // slice(1): skip the leading "Select member…" placeholder option.
  return Array.from(sel.options)
    .slice(1)
    .map((opt) => ({ id: opt.value, name: opt.textContent || '' }))
}

export function ExportControls() {
  const user = useCurrentUser()
  const elevated = isElevated(user?.role)
  const [, bumpLang] = useState(0)

  // Month-filter modal state.
  const [monthCtx, setMonthCtx] = useState<ExportCtx | null>(null)
  const [monthChecked, setMonthChecked] = useState<boolean[]>(() => Array(12).fill(true))

  // Bulk-export modal state.
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkYear, setBulkYear] = useState('')
  const [bulkMembers, setBulkMembers] = useState<MemberOption[]>([])
  const [bulkChecked, setBulkChecked] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const onLang = () => bumpLang((n) => n + 1)
    window.addEventListener('mwl:langchange', onLang)
    return () => window.removeEventListener('mwl:langchange', onLang)
  }, [])

  // ── Single export ──
  function openSingleExport() {
    const id = currentMemberId()
    if (!id) {
      toast(t('toast.select_member'), 'error')
      return
    }
    const year = readSelect('year-select') || String(new Date().getFullYear())
    setMonthChecked(Array(12).fill(true))
    setMonthCtx({ mode: 'single', memberId: id, year })
  }

  // ── Bulk export ──
  function openBulkExport() {
    const currentYear = readSelect('year-select')
    const now = new Date().getFullYear()
    const years: number[] = []
    for (let y = now - 2; y <= now + 1; y++) years.push(y)
    setBulkYear(currentYear && years.map(String).includes(currentYear) ? currentYear : String(now))
    const members = readMemberOptions()
    setBulkMembers(members)
    setBulkChecked(Object.fromEntries(members.map((m) => [m.id, true])))
    setBulkOpen(true)
  }

  function confirmBulkMembers() {
    const ids = bulkMembers.filter((m) => bulkChecked[m.id]).map((m) => m.id)
    if (ids.length === 0) {
      toast('Select at least one member', 'error')
      return
    }
    setBulkOpen(false)
    setMonthChecked(Array(12).fill(true))
    setMonthCtx({ mode: 'bulk', memberIds: ids, year: bulkYear })
  }

  // ── Month filter → trigger download ──
  function confirmMonthExport() {
    const months = monthChecked
      .map((checked, i) => (checked ? i + 1 : 0))
      .filter((m) => m > 0)
    if (months.length === 0) {
      toast(t('toast.select_one_month'), 'error')
      return
    }
    const ctx = monthCtx
    if (!ctx) return
    setMonthCtx(null)
    const mp = months.join(',')
    if (ctx.mode === 'single') {
      window.location.href = `/api/export/excel?member_id=${ctx.memberId}&year=${ctx.year}&months=${mp}`
    } else {
      toast(`Preparing ZIP for ${ctx.memberIds.length} member${ctx.memberIds.length > 1 ? 's' : ''}...`)
      window.location.href = `/api/export/excel/bulk?member_ids=${ctx.memberIds.join(',')}&year=${ctx.year}&months=${mp}`
    }
  }

  const abbrs = monthAbbrs()
  const monthAllChecked = monthChecked.every(Boolean)
  const bulkAllChecked = bulkMembers.length > 0 && bulkMembers.every((m) => bulkChecked[m.id])
  const bulkYears: number[] = []
  {
    const now = new Date().getFullYear()
    for (let y = now - 2; y <= now + 1; y++) bulkYears.push(y)
  }

  return (
    <>
      <div className="flex flex-wrap justify-end mb-4 gap-2">
        {elevated && (
          <button
            id="btn-export-multiple"
            type="button"
            onClick={openBulkExport}
            className="inline-flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg shadow-sm transition-colors"
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span>{t('dash.export_multiple') || 'Export Multiple'}</span>
          </button>
        )}
        <button
          type="button"
          onClick={openSingleExport}
          className="inline-flex items-center px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg shadow-sm transition-colors"
        >
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span>{t('dash.export_excel') || 'Export to Excel'}</span>
        </button>
      </div>

      {/* Bulk Export Modal (elevated only) */}
      {bulkOpen && (
        <div className="modal-overlay" onClick={() => setBulkOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">
                {t('modal.export_title') || 'Export Multiple Members'}
              </h3>
              <button onClick={() => setBulkOpen(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="mb-4">
              <label className="label">{t('modal.year') || 'Year'}</label>
              <select
                className="input-field w-full"
                value={bulkYear}
                onChange={(e) => setBulkYear(e.target.value)}
              >
                {bulkYears.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2 pb-2 mb-2 border-b border-gray-100">
              <input
                type="checkbox"
                id="bulk-select-all"
                className="w-4 h-4 text-indigo-600 rounded"
                checked={bulkAllChecked}
                onChange={(e) =>
                  setBulkChecked(Object.fromEntries(bulkMembers.map((m) => [m.id, e.target.checked])))
                }
              />
              <label htmlFor="bulk-select-all" className="text-sm font-medium text-gray-700 cursor-pointer select-none">
                {t('modal.select_all') || 'Select All'}
              </label>
            </div>

            <div className="space-y-1 max-h-56 overflow-y-auto mb-5 pr-1">
              {bulkMembers.map((m) => (
                <label
                  key={m.id}
                  className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    className="w-4 h-4 text-indigo-600 rounded"
                    checked={!!bulkChecked[m.id]}
                    onChange={(e) => setBulkChecked((prev) => ({ ...prev, [m.id]: e.target.checked }))}
                  />
                  <span className="text-sm text-gray-700">{m.name}</span>
                </label>
              ))}
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setBulkOpen(false)} className="btn-secondary">
                {t('modal.cancel') || 'Cancel'}
              </button>
              <button
                type="button"
                onClick={confirmBulkMembers}
                className="inline-flex items-center px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span>{t('modal.download_zip') || 'Download ZIP'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Month Filter Modal */}
      {monthCtx && (
        <div className="modal-overlay" onClick={() => setMonthCtx(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 360 }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">
                {t('modal.select_months') || 'Select Months to Export'}
              </h3>
              <button onClick={() => setMonthCtx(null)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex items-center gap-2 pb-2 mb-3 border-b border-gray-100">
              <input
                type="checkbox"
                id="month-select-all"
                className="w-4 h-4 text-indigo-600 rounded"
                checked={monthAllChecked}
                onChange={(e) => setMonthChecked(Array(12).fill(e.target.checked))}
              />
              <label htmlFor="month-select-all" className="text-sm font-medium text-gray-700 cursor-pointer select-none">
                {t('modal.select_all') || 'Select All'}
              </label>
            </div>
            <div className="grid grid-cols-3 gap-1 mb-5">
              {Array.from({ length: 12 }, (_, i) => (
                <label
                  key={i}
                  className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    className="w-4 h-4 text-indigo-600 rounded"
                    checked={monthChecked[i]}
                    onChange={(e) =>
                      setMonthChecked((prev) => {
                        const next = [...prev]
                        next[i] = e.target.checked
                        return next
                      })
                    }
                  />
                  <span className="text-sm text-gray-700">{abbrs[i + 1] ?? ''}</span>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setMonthCtx(null)} className="btn-secondary">
                {t('modal.cancel') || 'Cancel'}
              </button>
              <button
                type="button"
                onClick={confirmMonthExport}
                className="inline-flex items-center px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span>{t('modal.download') || 'Download'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
