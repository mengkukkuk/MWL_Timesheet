import { useState } from 'react'
import { monthName, t } from '../lib'
import type { Member } from '../lib'

interface SelectorProps {
  elevated: boolean
  members: Member[]
  memberId: string
  year: number
  yearDisabled: boolean
  showOverallMonth: boolean
  setMemberId: (id: string) => void
  setYear: (y: number) => void
  selectOverall: () => void
}

function yearOptions(current: number): number[] {
  const now = new Date().getFullYear()
  const years = new Set<number>()
  for (let y = now - 2; y <= now + 2; y++) years.add(y)
  years.add(current)
  return Array.from(years).sort((a, b) => a - b)
}

export function Selector({
  elevated,
  members,
  memberId,
  year,
  yearDisabled,
  showOverallMonth,
  setMemberId,
  setYear,
  selectOverall,
}: SelectorProps) {
  const [overallMonth, setOverallMonth] = useState<number>(new Date().getMonth() + 1)

  return (
    <div className="bg-gray-50 border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center gap-3">
        <label htmlFor="member-select" className="text-sm font-medium text-gray-700">
          {t('sel.member')}
        </label>
        <select
          id="member-select"
          value={memberId}
          disabled={!elevated}
          onChange={(e) => setMemberId(e.target.value)}
          className="border border-gray-300 rounded-md px-2 py-1 text-sm bg-white disabled:bg-gray-100"
        >
          <option value="">{t('sel.select_ph')}</option>
          {members.map((m) => (
            <option key={m.id} value={String(m.id)}>
              {m.name}
            </option>
          ))}
        </select>

        {elevated && (
          <button
            id="btn-overall"
            type="button"
            onClick={() => selectOverall()}
            className="px-3 py-1 text-sm font-medium text-indigo-700 border border-indigo-300 rounded-md hover:bg-indigo-50"
          >
            {t('sel.overall')}
          </button>
        )}

        <label htmlFor="year-select" className="text-sm font-medium text-gray-700 ml-2">
          {t('sel.year')}
        </label>
        <select
          id="year-select"
          value={year}
          disabled={yearDisabled}
          onChange={(e) => setYear(parseInt(e.target.value, 10))}
          className="border border-gray-300 rounded-md px-2 py-1 text-sm bg-white disabled:bg-gray-100"
        >
          {yearOptions(year).map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>

        <div id="overall-month-wrap" className={showOverallMonth ? 'flex items-center gap-2' : 'hidden'}>
          <label htmlFor="overall-month-select" className="text-sm font-medium text-gray-700">
            {t('dash.overall_month_label')}
          </label>
          <select
            id="overall-month-select"
            value={overallMonth}
            onChange={(e) => setOverallMonth(parseInt(e.target.value, 10))}
            className="border border-gray-300 rounded-md px-2 py-1 text-sm bg-white"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {monthName(m)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
