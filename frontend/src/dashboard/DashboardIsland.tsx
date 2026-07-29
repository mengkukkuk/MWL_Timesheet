// Dashboard React island. Mounts inside the existing SPA shell's
// #view-dashboard and reads the selected member/year from the vanilla
// #member-select / #year-select controls, re-fetching on their `change`
// events (and on the custom `mwl:dashboard` / `mwl:langchange` events). All
// backend endpoints are untouched:
//   GET /api/dashboard?member_id=&year=   (member profile + monthly rollup + OT)
//   GET /api/employees                    (adds the JG grade — the "addition on
//                                          staff information")
// The one bold spend here is the enriched StaffIdentityCard; stat numbers are
// set in DM Mono. Clicking a month row hands control back to the vanilla shell
// (#month-select + showTab('worklog')) so the rest of the app is unchanged.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectRolesResp, Skill } from '../lib'
import { api, canManageMember, useCurrentUser } from '../lib'
import { MonthlyLedger } from './MonthlyLedger'
import { ProjectRoles } from './ProjectRoles'
import { SkillsBox } from './SkillsBox'
import { Spinner } from '../shell/Spinner'

const EMPTY_ROLES: ProjectRolesResp = { main: [], support: [] }

interface DashMember {
  name: string
  department: string
  position: string
  level: string
  staff_id: string
  avatar_url: string | null
  jg?: string
}
interface DashMonthRow {
  month: number
  name?: string
  total_hours: number | string
  done: number
  missing?: number
  man_day: number | string
  overtime_hours?: number | string
}
interface DashboardData {
  member: DashMember
  months: DashMonthRow[]
  total_hours: number
  total_done: number
  total_in_progress: number
  total_man_day?: number
  total_overtime: number
  total_OT1: number
  total_OT1_5: number
  total_OT3: number
}

declare global {
  interface Window {
    currentMemberId?: string | number | null
    showTab?: (name: string) => void
  }
}

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

export function DashboardIsland() {
  const user = useCurrentUser()
  const [data, setData] = useState<DashboardData | null>(null)
  const [skills, setSkills] = useState<Skill[]>([])
  const [roles, setRoles] = useState<ProjectRolesResp>(EMPTY_ROLES)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [memberId, setMemberId] = useState<string>(currentMemberId())
  const [, bumpLang] = useState(0)
  // Guards against out-of-order responses: a slower, stale request (e.g. from
  // a superseded load() call caused by rapid member switching, or React
  // StrictMode's dev-only double-invoke of mount effects) must not overwrite
  // state set by a request that was started later.
  const requestIdRef = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current
    const id = currentMemberId()
    setMemberId(id)
    if (!id) {
      setData(null)
      setError(null)
      return
    }
    const year = readSelect('year-select') || String(new Date().getFullYear())
    setLoading(true)
    setError(null)
    const [dash, employees, sk, pr] = await Promise.all([
      api<DashboardData>(
        `/api/dashboard?member_id=${encodeURIComponent(id)}&year=${encodeURIComponent(year)}`,
      ),
      api<Array<{ id: string; jg?: string }>>('/api/employees'),
      api<Skill[]>(`/api/members/${encodeURIComponent(id)}/skills`),
      api<ProjectRolesResp>(`/api/members/${encodeURIComponent(id)}/project-roles`),
    ])
    if (requestId !== requestIdRef.current) return
    setLoading(false)
    setSkills(sk.data ?? [])
    setRoles(pr.data ?? EMPTY_ROLES)
    if (!dash.ok || !dash.data) {
      setData(null)
      setError(dash.error || `Failed to load dashboard (${dash.status || 'network error'})`)
      return
    }
    const jg = employees.data?.find((e) => String(e.id) === String(id))?.jg
    setData({ ...dash.data, member: { ...dash.data.member, jg } })
  }, [])

  useEffect(() => {
    load()
    const onChange = () => load()
    const onLang = () => bumpLang((n) => n + 1)
    const memberSel = document.getElementById('member-select')
    const yearSel = document.getElementById('year-select')
    memberSel?.addEventListener('change', onChange)
    yearSel?.addEventListener('change', onChange)
    window.addEventListener('mwl:dashboard', onChange)
    window.addEventListener('mwl:langchange', onLang)
    return () => {
      memberSel?.removeEventListener('change', onChange)
      yearSel?.removeEventListener('change', onChange)
      window.removeEventListener('mwl:dashboard', onChange)
      window.removeEventListener('mwl:langchange', onLang)
    }
  }, [load])

  if (!memberId) {
    return (
      <div className="mwl-dash">
        <p className="mwl-eyebrow">Dashboard</p>
        <p style={{ color: 'var(--ink-50)' }}>
          Select a team member to view their workday summary.
        </p>
      </div>
    )
  }

  // Checked before `!data` (not just alongside it) so a member switch — which
  // sets loading=true but leaves the *previous* member's data in place until
  // the new payload arrives — shows this instead of silently continuing to
  // render stale content with no visible feedback.
  if (loading) {
    return (
      <div className="mwl-dash flex flex-col items-center gap-3 py-16 text-center">
        <Spinner />
        <p style={{ color: 'var(--ink-50)' }}>Loading…</p>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="mwl-dash">
        <p style={{ color: error ? '#dc2626' : 'var(--ink-50)' }}>{error || 'No data available.'}</p>
        {error && (
          <button type="button" className="btn-secondary" onClick={() => load()}>
            Retry
          </button>
        )}
      </div>
    )
  }

  const canManage = canManageMember(user, memberId)

  return (
    <div className="mwl-dash mwl-fadein">
      <StaffIdentityCard member={data.member} memberId={memberId} />
      <StatCards data={data} />
      <ProjectRoles memberId={memberId} roles={roles} canManage={canManage} />
      <SkillsBox memberId={memberId} memberName={data.member.name} skills={skills} canManage={canManage} limit={16} />
      <MonthlyLedger months={data.months} />
    </div>
  )
}

function initial(name: string): string {
  return (name || '?').trim().charAt(0).toUpperCase() || '?'
}

function StaffIdentityCard({ member, memberId }: { member: DashMember; memberId: string }) {
  const [imgOk, setImgOk] = useState(true)
  const meta: Array<[string, string]> = [
    ['Department', member.department || '—'],
    ['Position', member.position || '—'],
    ['Level', member.level || '—'],
  ]
  return (
    <>
      <p className="mwl-eyebrow">Staff Profile</p>
      <div className="mwl-staff">
        {member.avatar_url && imgOk ? (
          <img
            className="mwl-staff__avatar"
            src={member.avatar_url}
            alt=""
            onError={() => setImgOk(false)}
          />
        ) : (
          <div
            className="mwl-staff__avatar"
            style={{
              display: 'grid',
              placeItems: 'center',
              fontSize: '1.6rem',
              fontWeight: 700,
            }}
          >
            {initial(member.name)}
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <h2 className="mwl-staff__name">
            {member.name}
            {member.jg ? (
              <span className="mwl-badge" style={{ marginLeft: '0.6rem' }}>
                {member.jg}
              </span>
            ) : null}
          </h2>
          <div className="mwl-staff__meta">
            <span className="mwl-staff__id">ID {memberId}</span>
            {meta.map(([label, value]) => (
              <span key={label}>
                {label} <b>{value}</b>
              </span>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

function num(v: number | string | undefined): string {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0))
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '0'
}

function StatCards({ data }: { data: DashboardData }) {
  const cards: Array<{ label: string; value: string; unit?: string; tone?: string }> = [
    { label: 'Total Hours', value: num(data.total_hours), unit: 'hrs', tone: 'indigo' },
    { label: 'Done', value: num(data.total_done), tone: 'green' },
    { label: 'Man-days', value: num(data.total_man_day ?? data.total_in_progress) },
    { label: 'Overtime', value: num(data.total_overtime), unit: 'hrs', tone: 'amber' },
  ]
  return (
    <div className="mwl-stats">
      {cards.map((c) => (
        <div className="mwl-stat" key={c.label}>
          <div className="mwl-stat__label">{c.label}</div>
          <div className={`mwl-stat__value ${c.tone ? `mwl-stat__value--${c.tone}` : ''}`}>
            {c.value}
            {c.unit ? <span className="mwl-stat__unit">{c.unit}</span> : null}
          </div>
        </div>
      ))}
    </div>
  )
}
