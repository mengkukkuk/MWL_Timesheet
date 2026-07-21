// One team-overview card. A quiet dark-ink card that mirrors the staff identity
// card (.mwl-staff); members with no project use the muted variant. Clicking the
// card selects that member (sets #member-select + window.onMemberChange, which
// updates core.js's currentMemberId and swaps the shell to the individual view).
// Avatar upload/remove reuses useAvatarActions (PDPA: own photo / super-admin
// only); skills preview + edit reuse the shared SkillsBox.
import { useState } from 'react'
import type { Member, Skill } from '../lib'
import { t } from '../lib'
import { SkillsBox } from './SkillsBox'
import { useAvatarActions } from './useAvatarActions'

declare global {
  interface Window {
    onMemberChange?: () => void
  }
}

function initial(name: string): string {
  return (name || '?').trim().charAt(0).toUpperCase() || '?'
}

function openMember(id: string): void {
  const sel = document.getElementById('member-select') as HTMLSelectElement | null
  if (sel) sel.value = id
  // onMemberChange reads #member-select, updates the vanilla currentMemberId
  // (a module-scoped let React cannot set) and drives onContextChange.
  window.onMemberChange?.()
}

interface TeamCardProps {
  member: Member
  main: string[]
  support: string[]
  skills: Skill[]
  missing: number
  canManageSkills: boolean
  canEditAvatar: boolean
}

export function TeamCard({
  member,
  main,
  support,
  skills,
  missing,
  canManageSkills,
  canEditAvatar,
}: TeamCardProps) {
  const [imgOk, setImgOk] = useState(true)
  const hasProject = main.length > 0 || support.length > 0
  const onChanged = () => window.dispatchEvent(new Event('mwl:dashboard'))
  const { pick, remove } = useAvatarActions(member.id, canEditAvatar, onChanged)
  const showImg = member.avatar_url && imgOk

  return (
    <div
      className={`mwl-tcard ${hasProject ? '' : 'mwl-tcard--muted'}`}
      role="button"
      tabIndex={0}
      onClick={() => openMember(member.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          openMember(member.id)
        }
      }}
    >
      <div className="mwl-tcard__top">
        <div
          className={`mwl-tcard__avatar ${canEditAvatar ? 'mwl-tcard__avatar--edit' : ''}`}
          title={canEditAvatar ? 'Click to change photo' : undefined}
          onClick={(e) => {
            if (!canEditAvatar) return
            e.stopPropagation()
            pick()
          }}
        >
          {showImg ? (
            <img src={member.avatar_url as string} alt="" onError={() => setImgOk(false)} />
          ) : (
            <span className="mwl-tcard__letter">{initial(member.name)}</span>
          )}
          {canEditAvatar && member.avatar_url ? (
            <button
              type="button"
              className="mwl-tcard__avatar-x"
              title="Remove photo"
              aria-label="Remove photo"
              onClick={(e) => {
                e.stopPropagation()
                remove()
              }}
            >
              ×
            </button>
          ) : null}
        </div>
        <div className="mwl-tcard__id">
          <div className="mwl-tcard__name">{member.name}</div>
          <div className="mwl-tcard__sub">ID {member.staff_id || '—'}</div>
          <div className="mwl-tcard__sub">{member.position || '—'}</div>
        </div>
      </div>

      <div className="mwl-tcard__roles">
        <div className="mwl-tcard__roleline">
          <span className="mwl-tcard__rolelabel">{t('dash.main_project') || 'Main'}</span>
          <span className="mwl-tcard__roleval">{main.length ? main.join(', ') : '—'}</span>
        </div>
        <div className="mwl-tcard__roleline">
          <span className="mwl-tcard__rolelabel">{t('dash.support') || 'Support'}</span>
          <span className="mwl-tcard__roleval">{support.length ? support.join(', ') : '—'}</span>
        </div>
      </div>

      <SkillsBox memberId={member.id} skills={skills} canManage={canManageSkills} />

      {missing > 0 ? (
        <div className="mwl-tcard__missing">
          {t('dash.missing_n_days', missing) || `Missing ${missing} day${missing === 1 ? '' : 's'}`}
        </div>
      ) : null}
    </div>
  )
}
