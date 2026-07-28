// Skills Manager modal — replaces the vanilla static/app/dashboard.js
// openSkillsManager/saveSkillsManager pair (window.openSkillsManager bridge).
// Fully owned by SkillsBox.tsx: local to the calling component, no window
// globals. Draft rows are edited locally, then diffed against the server on
// Save (DELETE removed rows with an id, POST new rows, PUT dirty existing
// rows) — same semantics as the vanilla saveSkillsManager().
import { useEffect, useState } from 'react'
import type { Skill } from '../lib'
import { api, t, toast } from '../lib'

interface DraftSkill extends Skill {
  _new?: boolean
  _deleted?: boolean
  _dirty?: boolean
}

type SortMode = 'level' | 'name'

let _nextTempId = -1

function sortDraft(draft: DraftSkill[], mode: SortMode): DraftSkill[] {
  const old = draft.filter((s) => !s._new && !s._deleted)
  const fresh = draft.filter((s) => s._new && !s._deleted)
  const sorted =
    mode === 'name'
      ? [...old].sort((a, b) => a.name.localeCompare(b.name))
      : [...old].sort((a, b) => b.level - a.level || a.name.localeCompare(b.name))
  return [...sorted, ...fresh]
}

interface SkillsManagerModalProps {
  memberId: string
  memberName: string
  onClose: () => void
  onSaved: () => void
}

export function SkillsManagerModal({ memberId, memberName, onClose, onSaved }: SkillsManagerModalProps) {
  const [draft, setDraft] = useState<DraftSkill[]>([])
  const [sortMode, setSortMode] = useState<SortMode>('level')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    api<Skill[]>(`/api/members/${memberId}/skills`).then((r) => {
      if (alive) setDraft((r.data ?? []).map((s) => ({ ...s })))
    })
    return () => {
      alive = false
    }
  }, [memberId])

  const updateRow = (id: number, patch: Partial<DraftSkill>) => {
    setDraft((d) => d.map((s) => (s.id === id ? { ...s, ...patch, _dirty: true } : s)))
  }

  const deleteRow = (id: number) => {
    setDraft((d) => d.map((s) => (s.id === id ? { ...s, _deleted: true } : s)))
  }

  const addRow = () => {
    const id = _nextTempId--
    setDraft((d) => [...d, { id, name: '', level: 3, _new: true, _dirty: true }])
  }

  const save = async () => {
    const visible = draft.filter((s) => !s._deleted)
    const seen = new Set<string>()
    for (const s of visible) {
      const nm = s.name.trim()
      if (!nm) {
        toast('Skill name is required', 'error')
        return
      }
      const key = nm.toLowerCase()
      if (seen.has(key)) {
        toast(`Duplicate skill: ${nm}`, 'error')
        return
      }
      seen.add(key)
      if (s.level < 1 || s.level > 5) {
        toast('Level must be 1–5', 'error')
        return
      }
    }

    setSaving(true)
    let ok = 0
    let fail = 0
    for (const s of draft) {
      if (s._deleted && !s._new) {
        const r = await api(`/api/skills/${s.id}`, { method: 'DELETE' })
        if (r.ok) ok++
        else fail++
      } else if (s._new && !s._deleted) {
        const r = await api(`/api/members/${memberId}/skills`, {
          json: { name: s.name.trim(), level: s.level },
        })
        if (r.ok) ok++
        else fail++
      } else if (s._dirty && !s._deleted) {
        const r = await api(`/api/skills/${s.id}`, {
          method: 'PUT',
          json: { name: s.name.trim(), level: s.level },
        })
        if (r.ok) ok++
        else fail++
      }
    }
    setSaving(false)

    if (fail) toast(`${fail} skill change${fail === 1 ? '' : 's'} failed`, 'error')
    if (ok) toast(`Saved ${ok} skill change${ok === 1 ? '' : 's'}`)

    onSaved()
    onClose()
  }

  const visible = sortDraft(draft, sortMode)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800">Skills — {memberName}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Sort</span>
            <button
              type="button"
              className={`skill-sort-btn ${sortMode === 'level' ? 'active' : ''}`}
              onClick={() => setSortMode('level')}
            >
              Level ↓
            </button>
            <button
              type="button"
              className={`skill-sort-btn ${sortMode === 'name' ? 'active' : ''}`}
              onClick={() => setSortMode('name')}
            >
              A → Z
            </button>
          </div>
          <button type="button" onClick={addRow} className="btn-primary text-sm" style={{ padding: '0.4rem 0.85rem' }}>
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            Add Skill
          </button>
        </div>

        <div className="mb-4" style={{ maxHeight: '50vh', overflowY: 'auto' }}>
          {visible.length === 0 ? (
            <div className="text-sm text-gray-400 italic text-center py-6">
              No skills yet — add one below.
            </div>
          ) : (
            visible.map((s) => (
              <div className="skill-edit-row" key={s.id}>
                <input
                  type="text"
                  className="skill-name-input"
                  maxLength={120}
                  placeholder="Skill name"
                  value={s.name}
                  onChange={(e) => updateRow(s.id, { name: e.target.value })}
                />
                <span className="skill-bar skill-bar-edit" data-lvl={s.level}>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <span
                      key={i}
                      className={`skill-seg ${i <= s.level ? 'on' : ''}`}
                      onClick={() => updateRow(s.id, { level: i })}
                    />
                  ))}
                </span>
                <span className="skill-level-num">{s.level}/5</span>
                <button type="button" className="skill-del-btn" title="Delete" onClick={() => deleteRow(s.id)}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              </div>
            ))
          )}
        </div>

        <div className="text-xs text-gray-400 mb-3 italic">
          Tip: click any segment in the bar to set the level. Click the trash to delete. Changes apply on Save.
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            {t('modal.cancel') || 'Cancel'}
          </button>
          <button type="button" onClick={save} disabled={saving} className="btn-primary">
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
