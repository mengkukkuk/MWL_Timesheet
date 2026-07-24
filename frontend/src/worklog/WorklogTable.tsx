// Resizable liquid-glass worklog table. Pure display + selection bookkeeping —
// every mutation (edit/delete) delegates to the existing vanilla globals so the
// add/edit modal, overlap detection, and CRUD endpoints stay untouched.
import { formatDate, statusClass } from './format'
import { EditIcon, TrashIcon } from './icons'
import type { ColumnDef } from './useColumnWidths'
import { useColumnWidths } from './useColumnWidths'
import type { Worklog } from './types'
import { t } from '../lib'

const COLUMNS: ColumnDef[] = [
  { key: 'date', min: 84, default: 104 },
  { key: 'project', min: 100, default: 180 },
  { key: 'task', min: 100, default: 200 },
  { key: 'start', min: 64, default: 76 },
  { key: 'end', min: 64, default: 76 },
  { key: 'hours', min: 64, default: 80 },
  { key: 'status', min: 90, default: 120 },
  { key: 'note', min: 100, default: 200 },
]

const COLUMN_LABEL_KEYS: Record<string, string> = {
  date: 'wl.col_date',
  project: 'wl.col_project',
  task: 'wl.col_task',
  start: 'wl.col_start',
  end: 'wl.col_end',
  hours: 'wl.col_hours',
  status: 'wl.col_status',
  note: 'wl.col_note',
}

function isRowEditable(w: Worklog, canEdit: boolean): boolean {
  return canEdit && Number(w.IsEditRow) !== 0
}

interface WorklogTableProps {
  worklogs: Worklog[]
  canEdit: boolean
  selected: Set<number>
  onToggleRow: (id: number) => void
  onToggleAll: (ids: number[], checked: boolean) => void
}

export function WorklogTable({ worklogs, canEdit, selected, onToggleRow, onToggleAll }: WorklogTableProps) {
  const { widths, startResize } = useColumnWidths(COLUMNS)

  const editableIds = worklogs.filter((w) => isRowEditable(w, canEdit)).map((w) => w.id)
  const selectedEditableCount = editableIds.filter((id) => selected.has(id)).length
  const allChecked = editableIds.length > 0 && selectedEditableCount === editableIds.length
  const indeterminate = selectedEditableCount > 0 && selectedEditableCount < editableIds.length

  return (
    <div className="wl-table-shell">
      <table className="wl-table" style={{ tableLayout: 'fixed' }}>
        <colgroup>
          {canEdit ? <col style={{ width: 36 }} /> : null}
          {COLUMNS.map((c) => (
            <col key={c.key} style={{ width: widths[c.key] }} />
          ))}
          {canEdit ? <col style={{ width: 76 }} /> : null}
        </colgroup>
        <thead>
          <tr>
            {canEdit ? (
              <th className="wl-th-checkbox">
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={(el) => {
                    if (el) el.indeterminate = indeterminate
                  }}
                  onChange={(e) => onToggleAll(editableIds, e.target.checked)}
                />
              </th>
            ) : null}
            {COLUMNS.map((c) => (
              <th key={c.key} className="wl-th">
                <span className="wl-th__label">{t(COLUMN_LABEL_KEYS[c.key])}</span>
                <span
                  className="wl-resize-handle"
                  onPointerDown={startResize(c.key)}
                  role="separator"
                  aria-orientation="vertical"
                />
              </th>
            ))}
            {canEdit ? <th className="wl-th-actions" /> : null}
          </tr>
        </thead>
        <tbody>
          {worklogs.map((w) => {
            const rowEditable = isRowEditable(w, canEdit)
            const isSelected = selected.has(w.id)
            return (
              <tr key={w.id} className={isSelected ? 'wl-row wl-row--selected' : 'wl-row'}>
                {canEdit ? (
                  <td className="wl-td-checkbox">
                    {rowEditable ? (
                      <input type="checkbox" checked={isSelected} onChange={() => onToggleRow(w.id)} />
                    ) : null}
                  </td>
                ) : null}
                <td className="wl-td">{formatDate(w.log_date)}</td>
                <td className="wl-td wl-td--project" title={w.project_description || w.project || ''}>
                  {w.project || ''}
                </td>
                <td className="wl-td">{w.task || ''}</td>
                <td className="wl-td wl-td--center">{w.start_time || ''}</td>
                <td className="wl-td wl-td--center">{w.end_time || ''}</td>
                <td className="wl-td wl-td--right">{w.hours != null ? w.hours.toFixed(2) : ''}</td>
                <td className="wl-td wl-td--center">
                  <span className={`wl-pill ${statusClass(w.status)}`}>{w.status || ''}</span>
                </td>
                <td className="wl-td wl-td--note">{w.note || ''}</td>
                {canEdit ? (
                  <td className="wl-td-actions">
                    {rowEditable ? (
                      <>
                        <button
                          type="button"
                          className="wl-icon-btn"
                          title="Edit"
                          onClick={() => window.editWorklog?.(w)}
                        >
                          <EditIcon />
                        </button>
                        <button
                          type="button"
                          className="wl-icon-btn wl-icon-btn--danger"
                          title="Delete"
                          onClick={() => window.deleteWorklog?.(w.id)}
                        >
                          <TrashIcon />
                        </button>
                      </>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            )
          })}
        </tbody>
      </table>
      {worklogs.length === 0 ? (
        <div className="wl-empty">
          <p>{t('wl.no_entries') || 'No entries for this month yet'}</p>
          {canEdit ? (
            <button type="button" className="wl-empty__cta" onClick={() => window.openAddWorklog?.()}>
              {t('wl.add_first') || 'Add your first entry'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}