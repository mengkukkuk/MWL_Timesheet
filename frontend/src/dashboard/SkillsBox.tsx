// Skills box — shared by the individual dashboard (limit 16, matrix layout)
// and each team card (limit 3, preview). Parents own fetching and pass the
// skill array in; editing opens the React-owned SkillsManagerModal (local
// state, no window bridge). Sort mode is local state (replacing the old
// global _skillSortMode in static/app/dashboard.js).
import { useState } from 'react'
import type { Skill } from '../lib'
import { SkillsManagerModal } from './SkillsManagerModal'

const PREVIEW_COUNT = 3
type SortMode = 'level' | 'name'

function sortSkills(skills: Skill[], mode: SortMode): Skill[] {
  const arr = [...skills]
  if (mode === 'name') {
    arr.sort((a, b) => a.name.localeCompare(b.name))
  } else {
    arr.sort((a, b) => b.level - a.level || a.name.localeCompare(b.name))
  }
  return arr
}

function SkillBar({ level }: { level: number }) {
  const lvl = Math.max(1, Math.min(5, Math.round(level) || 1))
  return (
    <span className="mwl-skillbar" title={`Level ${lvl}/5`} aria-label={`Level ${lvl} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`mwl-seg ${i <= lvl ? 'mwl-seg--on' : ''}`} />
      ))}
    </span>
  )
}

interface SkillsBoxProps {
  memberId: string
  memberName: string
  skills: Skill[]
  canManage: boolean
  /** Preview count. Individual dashboard passes 16 (matrix); team cards use 3. */
  limit?: number
}

export function SkillsBox({ memberId, memberName, skills, canManage, limit = PREVIEW_COUNT }: SkillsBoxProps) {
  const [sortMode, setSortMode] = useState<SortMode>('level')
  const [managing, setManaging] = useState(false)
  const sorted = sortSkills(skills, sortMode)
  const visible = sorted.slice(0, limit)
  const overflow = sorted.length - visible.length
  const matrix = limit > PREVIEW_COUNT

  return (
    <div className="mwl-skills">
      <div className="mwl-skills__head">
        <span className="mwl-skills__title">Skills</span>
        <span className="mwl-skills__actions">
          {sorted.length > 1 ? (
            <button
              type="button"
              className="mwl-iconbtn"
              title={sortMode === 'level' ? 'Sort by level' : 'Sort by name'}
              onClick={(e) => {
                e.stopPropagation()
                setSortMode((m) => (m === 'level' ? 'name' : 'level'))
              }}
            >
              {sortMode === 'level' ? '↕' : 'A→Z'}
            </button>
          ) : null}
          {canManage ? (
            <button
              type="button"
              className="mwl-iconbtn"
              title="Manage skills"
              aria-label="Manage skills"
              onClick={(e) => {
                e.stopPropagation()
                setManaging(true)
              }}
            >
              ✎
            </button>
          ) : null}
        </span>
      </div>
      <div className={matrix ? 'mwl-skills__list mwl-skills__list--matrix' : 'mwl-skills__list'}>
        {visible.length ? (
          visible.map((s) => (
            <div className="mwl-skill-row" key={s.id}>
              <span className="mwl-skill-name">{s.name}</span>
              <SkillBar level={s.level} />
            </div>
          ))
        ) : (
          <div className="mwl-skill-empty">
            {canManage ? 'No skills yet — click ✎ to add' : 'No skills yet'}
          </div>
        )}
        {overflow > 0 ? <div className="mwl-skill-more">+{overflow} more</div> : null}
      </div>
      {managing ? (
        <SkillsManagerModal
          memberId={memberId}
          memberName={memberName}
          onClose={() => setManaging(false)}
          onSaved={() => window.dispatchEvent(new Event('mwl:dashboard'))}
        />
      ) : null}
    </div>
  )
}
