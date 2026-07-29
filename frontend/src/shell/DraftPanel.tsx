// Squad Draft side panel — additive React port of static/app/draft.js. A
// TFT-inspired team-composition planner: a 28-slot Field, a Synergies panel
// (skill-level totals across deployed members), and a Roster with drag-to-place
// and click-to-toggle. Slot layout is persisted per project in
// localStorage['draftState']; "DEPLOY" writes the field back to the project's
// main_members via /api/projects/<id>/assign|unassign (elevated only).
//
// Self-contained (owns open/close + slot state) and re-exposes the same window
// globals draft.js did (openDraftPanel/closeDraftPanel/restoreDraftPanelState/
// saveDraftDeployment) so the vanilla-rendered #btn-draft / .draft-save-btn /
// .draft-close-btn onclick handlers in templates/app.html keep working until
// that markup is React-rendered. Not wired in until AppShell mounts it.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  api,
  isElevated,
  parseProjectMemberList,
  toast,
  useCurrentUser,
  type Member,
  type ProjectRow,
  type Skill,
  type SkillsByMember,
} from '../lib'

declare global {
  interface Window {
    openDraftPanel?: () => void
    closeDraftPanel?: () => void
    restoreDraftPanelState?: () => void
    saveDraftDeployment?: () => void
  }
}

const FIELD_SLOT_COUNT = 28
const DRAFT_STATE_KEY = 'draftState'

interface Tier {
  min: number
  label: string
  color: string
  glow: string
}

const DRAFT_TIERS: readonly Tier[] = [
  { min: 15, label: 'DIAMOND', color: '#a78bfa', glow: '#7c3aed' },
  { min: 10, label: 'GOLD', color: '#f59e0b', glow: '#d97706' },
  { min: 6, label: 'SILVER', color: '#94a3b8', glow: '#64748b' },
  { min: 2, label: 'BRONZE', color: '#b45309', glow: '#92400e' },
  { min: 1, label: '', color: '#4b5563', glow: '#374151' },
]

const STAR_COLORS = ['#6b7280', '#22c55e', '#3b82f6', '#a855f7', '#f59e0b']

function getTier(total: number): Tier {
  for (const tier of DRAFT_TIERS) {
    if (total >= tier.min) return tier
  }
  return DRAFT_TIERS[DRAFT_TIERS.length - 1]
}

function levelColor(level: number): string {
  return STAR_COLORS[Math.min(level, 5) - 1] || STAR_COLORS[0]
}

function memberPower(skills: SkillsByMember, mid: string): number {
  return (skills[mid] || []).reduce((sum, sk) => sum + (sk.level || 0), 0)
}

type SlotsByProject = Record<string, (string | null)[]>

function emptySlots(): (string | null)[] {
  return Array(FIELD_SLOT_COUNT).fill(null)
}

function normalizeSlots(arr: unknown): (string | null)[] {
  const next = emptySlots()
  if (Array.isArray(arr)) {
    arr.forEach((v, i) => {
      if (i < FIELD_SLOT_COUNT) next[i] = v == null ? null : String(v)
    })
  }
  return next
}

interface DraftPersistState {
  open: boolean
  projectId: string | null
  slots: SlotsByProject
}

function loadDraftState(): DraftPersistState {
  try {
    const raw = localStorage.getItem(DRAFT_STATE_KEY)
    if (!raw) return { open: false, projectId: null, slots: {} }
    const parsed = JSON.parse(raw) as {
      open?: unknown
      projectId?: unknown
      slots?: Record<string, unknown>
    }
    const slots: SlotsByProject = {}
    if (parsed.slots && typeof parsed.slots === 'object') {
      for (const [k, v] of Object.entries(parsed.slots)) {
        if (Array.isArray(v)) slots[k] = normalizeSlots(v)
      }
    }
    const pid = parsed.projectId
    return {
      open: !!parsed.open,
      projectId: pid == null ? null : String(pid),
      slots,
    }
  } catch {
    return { open: false, projectId: null, slots: {} }
  }
}

function saveDraftState(state: DraftPersistState): void {
  try {
    localStorage.setItem(DRAFT_STATE_KEY, JSON.stringify(state))
  } catch {
    /* quota / disabled storage — non-fatal */
  }
}

function Avatar({ url, letter }: { url: string; letter: string }) {
  const [err, setErr] = useState(false)
  if (url && !err) {
    return <img src={url} alt="" className="template-avatar-img" onError={() => setErr(true)} />
  }
  return <span className="template-avatar-fallback">{letter}</span>
}

interface HexUnitProps {
  member: Member
  skills: SkillsByMember
  large: boolean
  deployed: boolean
}

function HexUnit({ member, skills, large, deployed }: HexUnitProps) {
  const all = (skills[member.id] || []).slice(0, 10)
  const letter = (member.name || '?').charAt(0).toUpperCase()
  const avatarUrl = member.avatar_url || ''
  const cols = all.length <= 1 ? 1 : all.length <= 4 ? 2 : all.length <= 9 ? 3 : 4

  if (!large) {
    return (
      <div className={`template-outer template-sm ${deployed ? 'template-deployed' : ''}`}>
        <div className="template-body">
          <div className="template-avatar">
            <Avatar url={avatarUrl} letter={letter} />
          </div>
          {deployed && <div className="template-tick">✓</div>}
        </div>
      </div>
    )
  }

  return (
    <div className={`template-outer template-lg ${deployed ? 'template-deployed' : ''}`}>
      <div className="template-card">
        <div className="template-avatar">
          <Avatar url={avatarUrl} letter={letter} />
        </div>
        <div className="template-name" title={member.name}>
          {member.name.split(' ')[0]}
        </div>
        <div
          className="template-skill-grid"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {all.length ? (
            all.map((s) => (
              <div
                key={s.id}
                className="template-skill-chip"
                style={{ ['--chip-c' as string]: levelColor(s.level) } as React.CSSProperties}
              >
                <span className="ts-name">{s.name}</span>
                <span className="ts-lvl">{s.level}</span>
              </div>
            ))
          ) : (
            <div className="template-no-skills">No skills</div>
          )}
        </div>
      </div>
    </div>
  )
}

export function DraftPanel() {
  const user = useCurrentUser()
  const elevated = isElevated(user?.role)
  const queryClient = useQueryClient()

  const [open, setOpen] = useState(false)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [slotsByProject, setSlotsByProject] = useState<SlotsByProject>({})
  const [fieldUrl, setFieldUrl] = useState('')

  const membersQuery = useQuery({
    queryKey: ['members'],
    queryFn: async () => (await api<Member[]>('/api/members')).data ?? [],
    staleTime: 600_000,
    enabled: open,
  })
  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: async () => (await api<ProjectRow[]>('/api/projects')).data ?? [],
    staleTime: 600_000,
    enabled: open,
  })
  const skillsQuery = useQuery({
    queryKey: ['skills'],
    queryFn: async () => (await api<SkillsByMember>('/api/skills')).data ?? {},
    staleTime: 600_000,
    enabled: open,
  })

  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data])
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data])
  const skills = useMemo(() => skillsQuery.data ?? {}, [skillsQuery.data])

  const openPanel = useCallback(() => {
    const saved = loadDraftState()
    setSlotsByProject(saved.slots)
    setProjectId(saved.projectId)
    setOpen(true)
  }, [])

  const closePanel = useCallback(() => setOpen(false), [])

  // Seed slots for any project without saved layout from its main_members, and
  // pick a valid default project once the projects list is loaded.
  useEffect(() => {
    if (!open || !projects.length) return
    const known = new Set(members.map((m) => String(m.id)))
    setSlotsByProject((prev) => {
      let changed = false
      const next: SlotsByProject = { ...prev }
      for (const p of projects) {
        const key = String(p.id)
        if (!next[key]) {
          const mids = parseProjectMemberList(p.main_members).filter((id) => known.has(id))
          const slots = emptySlots()
          mids.slice(0, FIELD_SLOT_COUNT).forEach((mid, i) => {
            slots[i] = mid
          })
          next[key] = slots
          changed = true
        }
      }
      return changed ? next : prev
    })
    setProjectId((prev) =>
      prev && projects.some((p) => String(p.id) === prev) ? prev : String(projects[0].id),
    )
  }, [open, projects, members])

  // Persist open/project/slot state on every change (mirrors draft.js's
  // _saveDraftState calls after each mutation, open, and close).
  useEffect(() => {
    saveDraftState({ open, projectId, slots: slotsByProject })
  }, [open, projectId, slotsByProject])

  // Resolve the field background image (SVG preferred, PNG fallback) on open.
  useEffect(() => {
    if (!open) return
    let alive = true
    ;(async () => {
      for (const url of ['/static/field_image.svg', '/static/field_image.png']) {
        try {
          const r = await fetch(url, { method: 'HEAD' })
          if (r.ok) {
            if (alive) setFieldUrl(url)
            return
          }
        } catch {
          /* ignore network/permission errors, try next */
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [open])

  const slots = useMemo(
    () => (projectId && slotsByProject[projectId]) || emptySlots(),
    [projectId, slotsByProject],
  )
  const deployed = useMemo(() => new Set(slots.filter(Boolean) as string[]), [slots])

  const toggleMember = useCallback(
    (mid: string) => {
      if (!projectId) return
      setSlotsByProject((prev) => {
        const cur = prev[projectId] ? [...prev[projectId]] : emptySlots()
        if (cur.includes(mid)) {
          return { ...prev, [projectId]: cur.map((v) => (v === mid ? null : v)) }
        }
        const idx = cur.findIndex((v) => !v)
        if (idx < 0) {
          toast('Field is full', 'error')
          return prev
        }
        const next = cur.map((v) => (v === mid ? null : v))
        next[idx] = mid
        return { ...prev, [projectId]: next }
      })
    },
    [projectId],
  )

  const placeInSlot = useCallback(
    (mid: string, slotIdx: number) => {
      if (!projectId || slotIdx < 0 || slotIdx >= FIELD_SLOT_COUNT) return
      setSlotsByProject((prev) => {
        const cur = prev[projectId] ? [...prev[projectId]] : emptySlots()
        const next = cur.map((v) => (v === mid ? null : v))
        next[slotIdx] = mid
        return { ...prev, [projectId]: next }
      })
    },
    [projectId],
  )

  const onRosterDragStart = (mid: string, e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/member-id', mid)
  }
  const onUnitDragStart = (slotIdx: number, e: React.DragEvent) => {
    const mid = slots[slotIdx]
    if (!mid) return
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/member-id', mid)
  }
  const allowDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }
  const onSlotDrop = (slotIdx: number, e: React.DragEvent) => {
    e.preventDefault()
    const mid = e.dataTransfer.getData('text/member-id')
    if (mid) placeInSlot(mid, slotIdx)
  }

  const saveDeployment = useMutation({
    mutationFn: async () => {
      if (!elevated) throw new Error('Permission denied')
      if (!projectId) return null
      const project = projects.find((p) => String(p.id) === projectId)
      if (!project) throw new Error('Project not found')

      const draftedIds = [...deployed]
      const currentIds = parseProjectMemberList(project.main_members)
      const draftedSet = new Set(draftedIds)
      const currentSet = new Set(currentIds)
      const toAdd = draftedIds.filter((id) => !currentSet.has(id))
      const toRemove = currentIds.filter((id) => !draftedSet.has(id))

      if (!toAdd.length && !toRemove.length) {
        return { name: project.name, count: draftedIds.length, fail: 0, noChange: true }
      }

      let fail = 0
      for (const memberId of toAdd) {
        const r = await api(`/api/projects/${projectId}/assign`, {
          json: { member_id: memberId, type: 'main' },
        })
        if (!r.ok) fail++
      }
      for (const memberId of toRemove) {
        const r = await api(`/api/projects/${projectId}/unassign`, {
          json: { member_id: memberId, type: 'main' },
        })
        if (!r.ok) fail++
      }
      return { name: project.name, count: draftedIds.length, fail, noChange: false }
    },
    onSuccess: (res) => {
      if (!res) return
      if (res.noChange) {
        toast('No changes to save')
        return
      }
      if (res.fail) toast(`${res.fail} change(s) failed`, 'error')
      if (res.count && !res.fail) toast(`${res.name} — deployed ${res.count} member(s)`)
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      window.dispatchEvent(new Event('mwl:dashboard'))
    },
    onError: (err) => toast(err instanceof Error ? err.message : 'Deployment failed', 'error'),
  })

  const restoreDraftPanelState = useCallback(() => {
    const st = loadDraftState()
    if (st.projectId) setProjectId(st.projectId)
    if (!st.open) return
    if (!isElevated(user?.role)) {
      setOpen(false)
      saveDraftState({ ...st, open: false })
      return
    }
    openPanel()
  }, [user, openPanel])

  // Re-expose the vanilla window globals so app.html's still-vanilla draft
  // buttons (#btn-draft, .draft-save-btn, .draft-close-btn) drive this panel.
  useEffect(() => {
    window.openDraftPanel = openPanel
    window.closeDraftPanel = closePanel
    window.restoreDraftPanelState = restoreDraftPanelState
    window.saveDraftDeployment = () => saveDeployment.mutate()
    return () => {
      delete window.openDraftPanel
      delete window.closeDraftPanel
      delete window.restoreDraftPanelState
      delete window.saveDraftDeployment
    }
  }, [openPanel, closePanel, restoreDraftPanelState, saveDeployment])

  // ── Derived synergy / power figures ──
  const totals: Record<string, number> = {}
  deployed.forEach((mid) => {
    ;(skills[mid] || []).forEach((sk: Skill) => {
      totals[sk.name] = (totals[sk.name] || 0) + sk.level
    })
  })
  const synergyEntries = Object.entries(totals).sort((a, b) => b[1] - a[1])
  const teamPower = [...deployed].reduce((s, mid) => s + memberPower(skills, mid), 0)
  const maxTotal = synergyEntries[0]?.[1] || 1
  const maxPossible = members.reduce((s, m) => s + memberPower(skills, m.id), 0) || 1
  const powerPct = Math.min(100, Math.round((teamPower / maxPossible) * 100))
  const powerCol = powerPct > 65 ? '#f59e0b' : powerPct > 35 ? '#3b82f6' : '#4b5563'

  const rosterSorted = useMemo(
    () => [...members].sort((a, b) => memberPower(skills, b.id) - memberPower(skills, a.id)),
    [members, skills],
  )

  const memberById = useMemo(() => {
    const map = new Map<string, Member>()
    members.forEach((m) => map.set(String(m.id), m))
    return map
  }, [members])

  return (
    <div id="draft-overlay" className={`draft-overlay${open ? ' draft-open' : ''}`}>
      <div className="draft-header">
        <div className="draft-header-left">
          <div className="draft-logo">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
          </div>
          <span className="draft-title-text">SQUAD DRAFT</span>
          <span className="draft-subtitle">Team Competency Planner</span>
        </div>
        <div className="draft-header-right">
          <button
            className={`draft-save-btn${elevated ? '' : ' hidden'}`}
            onClick={() => saveDeployment.mutate()}
            disabled={saveDeployment.isPending}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            {saveDeployment.isPending ? 'DEPLOYING...' : 'DEPLOY'}
          </button>
          <button
            className="draft-close-btn"
            onClick={closePanel}
            disabled={saveDeployment.isPending}
            title={saveDeployment.isPending ? 'Deployment in progress…' : undefined}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="draft-tabs-bar">
        <div className="draft-tabs-label">PROJECT</div>
        <div id="draft-project-tabs" className="draft-tabs">
          {projects.map((p) => (
            <button
              key={p.id}
              className={`draft-tab${String(p.id) === projectId ? ' active' : ''}`}
              onClick={() => setProjectId(String(p.id))}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      <div className="draft-body">
        {/* LEFT: Synergies */}
        <div className="draft-panel draft-panel-left">
          <div className="draft-panel-header">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            SYNERGIES
          </div>
          <div id="draft-synergies" className="draft-synergy-list">
            {synergyEntries.length === 0 ? (
              <div className="synergy-empty">
                <svg
                  className="w-10 h-10 mx-auto mb-3 opacity-20"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <p>
                  Deploy members
                  <br />
                  to see synergies
                </p>
              </div>
            ) : (
              synergyEntries.map(([name, total]) => {
                const tier = getTier(total)
                const pct = Math.min(100, Math.round((total / Math.max(maxTotal, 15)) * 100))
                return (
                  <div key={name} className="synergy-row" title={`${name}: ${total} pts total`}>
                    <div
                      className="synergy-badge"
                      style={{ background: `${tier.color}22`, border: `1px solid ${tier.color}66`, color: tier.color }}
                    >
                      {total}
                    </div>
                    <div className="synergy-info">
                      <div className="synergy-name-row">
                        <span className="synergy-name">{name}</span>
                        {tier.label && (
                          <span className="synergy-tier" style={{ color: tier.color }}>
                            {tier.label}
                          </span>
                        )}
                      </div>
                      <div className="synergy-bar-track">
                        <div
                          className="synergy-bar-fill"
                          style={{
                            width: `${pct}%`,
                            background: `linear-gradient(90deg,${tier.glow},${tier.color})`,
                            boxShadow: `0 0 6px ${tier.color}90`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
          <div className="draft-panel-footer" id="draft-team-size">
            {deployed.size ? (
              <>
                <span className="syn-footer-label">Team</span>
                <span className="syn-footer-val">{deployed.size} members</span>
                <span className="syn-footer-sep">·</span>
                <span className="syn-footer-val" style={{ color: '#f59e0b' }}>
                  {teamPower} pts
                </span>
              </>
            ) : (
              <span className="syn-footer-label opacity-40">No members deployed</span>
            )}
          </div>
        </div>

        {/* CENTER: Field */}
        <div className="draft-panel draft-panel-center">
          <div className="draft-panel-header">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064"
              />
            </svg>
            FIELD
          </div>
          <div
            id="draft-board-units"
            className="draft-board-grid"
            style={
              fieldUrl
                ? {
                    backgroundImage: `url('${fieldUrl}')`,
                    backgroundSize: 'contain',
                    backgroundPosition: 'center',
                    backgroundRepeat: 'no-repeat',
                  }
                : undefined
            }
          >
            {slots.map((mid, idx) => {
              const rowClass = Math.floor(idx / 7) % 2 === 1 ? 'odd' : 'even'
              const m = mid ? memberById.get(mid) : undefined
              if (m) {
                return (
                  <div
                    key={idx}
                    className={`draft-board-slot ${rowClass} is-filled`}
                    data-slot={idx}
                    onDragOver={allowDrop}
                    onDrop={(e) => onSlotDrop(idx, e)}
                  >
                    <div
                      className="draft-unit"
                      draggable
                      onDragStart={(e) => onUnitDragStart(idx, e)}
                      onClick={() => toggleMember(m.id)}
                      title={`Remove ${m.name}`}
                    >
                      <HexUnit member={m} skills={skills} large deployed />
                    </div>
                  </div>
                )
              }
              return (
                <div
                  key={idx}
                  className={`draft-board-slot ${rowClass} is-empty`}
                  data-slot={idx}
                  onDragOver={allowDrop}
                  onDrop={(e) => onSlotDrop(idx, e)}
                >
                  <div className="draft-slot-ghost" />
                </div>
              )
            })}
          </div>
          <div className="draft-power-section">
            <div className="draft-power-label">
              <span>FIELD POWER</span>
              <span id="draft-power-num" className="draft-power-num">
                {teamPower}
              </span>
              <span className="draft-power-unit">pts</span>
            </div>
            <div className="draft-power-track">
              <div
                id="draft-power-bar"
                className="draft-power-fill"
                style={{
                  width: `${powerPct}%`,
                  background: `linear-gradient(90deg, ${powerCol}cc, ${powerCol})`,
                  boxShadow: `0 0 10px ${powerCol}90`,
                }}
              />
            </div>
          </div>
        </div>

        {/* RIGHT: Roster */}
        <div className="draft-panel draft-panel-right">
          <div className="draft-panel-header">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            ROSTER
            <span id="draft-roster-count" className="draft-count-badge">
              {members.length}
            </span>
          </div>
          <div className="draft-roster-hint">Drag a member to a Field slot (or click to auto-place)</div>
          <div id="draft-roster-list" className="draft-roster-list">
            {rosterSorted.map((m) => {
              const isOn = deployed.has(String(m.id))
              const topLevel = (skills[m.id] || []).reduce((max, s) => Math.max(max, s.level || 0), 0)
              const color = topLevel > 0 ? levelColor(topLevel) : STAR_COLORS[0]
              const allSkills = skills[m.id] || []
              return (
                <div
                  key={m.id}
                  className={`roster-unit${isOn ? ' roster-unit-on' : ''}`}
                  draggable
                  onDragStart={(e) => onRosterDragStart(String(m.id), e)}
                  onClick={() => toggleMember(String(m.id))}
                  style={{ ['--rc' as string]: color } as React.CSSProperties}
                >
                  <div className="roster-hex">
                    <HexUnit member={m} skills={skills} large={false} deployed={isOn} />
                  </div>
                  <div className="roster-info">
                    <div className="roster-name">{m.name}</div>
                    <div className="roster-skills">
                      {allSkills.length ? (
                        allSkills.map((s) => (
                          <span
                            key={s.id}
                            className="roster-skill-chip"
                            style={{ ['--chip-c' as string]: levelColor(s.level) } as React.CSSProperties}
                          >
                            <span className="roster-skill-chip-name">{s.name}</span>
                            <span className="roster-skill-chip-lvl">{s.level}</span>
                          </span>
                        ))
                      ) : (
                        <span className="roster-skill-none">No skills</span>
                      )}
                    </div>
                  </div>
                  <div className={`roster-status${isOn ? ' on' : ''}`}>
                    {isOn ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
