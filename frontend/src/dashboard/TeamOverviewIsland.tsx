// Team Overview grid island — mounts into #overall-member-grid (shown by the
// vanilla shell when no single member is selected). Self-fetches the roster,
// projects, the all-members skill map and the per-member missing-day map, then
// renders a TeamCard per member. Reloads on #year-select / #overall-month-select
// changes and on the `mwl:dashboard` refresh event; re-renders on
// `mwl:langchange`. The member-count label lives outside this root, so it is set
// imperatively (the same DOM-bridge style the dashboard island already uses).
import { useCallback, useEffect, useState } from 'react'
import type { MeResp, Member, MissingMap, ProjectRow, SkillsByMember } from '../lib'
import { api, isElevated, parseProjectMemberList, t, useCurrentUser } from '../lib'
import { TeamCard } from './TeamCard'

interface Roles {
  main: string[]
  support: string[]
}

function readSelectInt(id: string, fallback: number): number {
  const el = document.getElementById(id) as HTMLSelectElement | null
  const v = el?.value ? parseInt(el.value, 10) : NaN
  return Number.isFinite(v) ? v : fallback
}

function canEditAvatar(user: MeResp | null, employeeId: string): boolean {
  if (!user) return false
  if (user.role === 'Super_Ultimate_ADMIN') return true
  return String(user.member_id) === String(employeeId)
}

// Map each member to the project names they belong to. main_members/support_members
// are JSON-array strings of EmployeeIDs (or legacy "#"-joined names).
function buildMemberProjects(members: Member[], projects: ProjectRow[]): Record<string, Roles> {
  const map: Record<string, Roles> = {}
  members.forEach((m) => {
    map[m.id] = { main: [], support: [] }
  })
  const belongs = (list: string[], m: Member): boolean =>
    list.some((item) => {
      const n = Number(item)
      if (Number.isFinite(n) && String(n) === String(m.id)) return true
      return item.trim() === m.name
    })
  projects.forEach((p) => {
    const mains = parseProjectMemberList(p.main_members)
    const supps = parseProjectMemberList(p.support_members)
    members.forEach((m) => {
      if (belongs(mains, m)) map[m.id].main.push(p.name)
      if (belongs(supps, m)) map[m.id].support.push(p.name)
    })
  })
  return map
}

interface TeamOverviewIslandProps {
  onSelectMember: (id: string) => void
}

export function TeamOverviewIsland({ onSelectMember }: TeamOverviewIslandProps) {
  const user = useCurrentUser()
  const [members, setMembers] = useState<Member[]>([])
  const [roles, setRoles] = useState<Record<string, Roles>>({})
  const [skills, setSkills] = useState<SkillsByMember>({})
  const [missing, setMissing] = useState<MissingMap>({})
  const [, bumpLang] = useState(0)

  const load = useCallback(async () => {
    const year = readSelectInt('year-select', new Date().getFullYear())
    const month = readSelectInt('overall-month-select', new Date().getMonth() + 1)
    const [mem, proj, sk, miss] = await Promise.all([
      api<Member[]>('/api/members'),
      api<ProjectRow[]>('/api/projects'),
      api<SkillsByMember>('/api/skills'),
      api<MissingMap>(`/api/dashboard/missing?year=${year}&month=${month}`),
    ])
    const memberList = mem.data ?? []
    setMembers(memberList)
    setRoles(buildMemberProjects(memberList, proj.data ?? []))
    setSkills(sk.data ?? {})
    setMissing(miss.data ?? {})

    const countEl = document.getElementById('overall-member-count')
    if (countEl) {
      countEl.textContent =
        t('dash.members_count', memberList.length) || `${memberList.length} members`
    }
  }, [])

  useEffect(() => {
    load()
    const onChange = () => load()
    const onLang = () => bumpLang((n) => n + 1)
    const yearSel = document.getElementById('year-select')
    const monthSel = document.getElementById('overall-month-select')
    yearSel?.addEventListener('change', onChange)
    monthSel?.addEventListener('change', onChange)
    window.addEventListener('mwl:dashboard', onChange)
    window.addEventListener('mwl:langchange', onLang)
    return () => {
      yearSel?.removeEventListener('change', onChange)
      monthSel?.removeEventListener('change', onChange)
      window.removeEventListener('mwl:dashboard', onChange)
      window.removeEventListener('mwl:langchange', onLang)
    }
  }, [load])

  const elevated = isElevated(user?.role)

  return (
    <div className="mwl-team">
      {members.map((m) => {
        const r = roles[m.id] ?? { main: [], support: [] }
        const canManageSkills = elevated || String(user?.member_id) === String(m.id)
        return (
          <TeamCard
            key={m.id}
            member={m}
            main={r.main}
            support={r.support}
            skills={skills[m.id] ?? []}
            missing={Number(missing[m.id] ?? 0)}
            canManageSkills={canManageSkills}
            canEditAvatar={canEditAvatar(user, m.id)}
            onSelect={() => onSelectMember(m.id)}
          />
        )
      })}
    </div>
  )
}
