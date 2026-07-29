// TanStack Query data layer for the Settings island. Replaces the ad-hoc
// api()/loadX() calls in static/app/settings.js with cached queries +
// mutations that invalidate the relevant keys on write. Pattern mirrors
// frontend/src/files/useFilesData.ts.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib'
import type {
  Employee,
  PendingCountResp,
  PendingUser,
  SettingsProject,
  TimePresets,
  UserRow,
  VisibilityResp,
} from './types'

const STALE_STATIC = 10 * 60_000 // 10m, per the migration plan's ['employees']/['projects'] tier.

async function fetchJson<T>(url: string): Promise<T> {
  const r = await api<T>(url)
  if (!r.ok || r.data == null) throw new Error(r.error || `request failed (${r.status})`)
  return r.data
}

// ── Employees (Team Members panel) ─────────────────────────────────────────

export function useEmployees() {
  return useQuery({
    queryKey: ['employees'],
    queryFn: () => fetchJson<Employee[]>('/api/employees'),
    staleTime: STALE_STATIC,
  })
}

function useEmployeesInvalidator() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['employees'] })
}

export interface EmployeeInput {
  name: string
  department: string
  staff_id: string
  position: string
  level?: string
  jg?: string
}

export function useAddEmployee() {
  const invalidate = useEmployeesInvalidator()
  return useMutation({
    mutationFn: async (vars: EmployeeInput) => {
      const r = await api('/api/employees', { json: vars })
      if (!r.ok) throw new Error(r.error || `create failed (${r.status})`)
      return r.data
    },
    onSuccess: invalidate,
  })
}

export function useUpdateEmployee() {
  const invalidate = useEmployeesInvalidator()
  return useMutation({
    mutationFn: async (vars: { id: number } & Partial<EmployeeInput>) => {
      const { id, ...body } = vars
      const r = await api(`/api/employees/${id}`, { method: 'PUT', json: body })
      if (!r.ok) throw new Error(r.error || `save failed (${r.status})`)
      return r.data
    },
    onSuccess: invalidate,
  })
}

export interface DeleteEmployeeResult {
  ok: boolean
  linked_member_rows: number
  warning?: string
}

export function useDeleteEmployee() {
  const invalidate = useEmployeesInvalidator()
  return useMutation({
    mutationFn: async (id: number) => {
      const r = await api<DeleteEmployeeResult>(`/api/employees/${id}`, { method: 'DELETE' })
      if (!r.ok || r.data == null) throw new Error(r.error || `delete failed (${r.status})`)
      return r.data
    },
    onSuccess: invalidate,
  })
}

// ── Projects panel ──────────────────────────────────────────────────────────

export function useSettingsProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => fetchJson<SettingsProject[]>('/api/projects'),
    staleTime: STALE_STATIC,
  })
}

function useProjectsInvalidator() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['projects'] })
}

export function useAddProject() {
  const invalidate = useProjectsInvalidator()
  return useMutation({
    mutationFn: async (name: string) => {
      const r = await api('/api/projects', { json: { name } })
      if (!r.ok) throw new Error(r.error || `create failed (${r.status})`)
      return r.data
    },
    onSuccess: invalidate,
  })
}

export function useDeleteProject() {
  const invalidate = useProjectsInvalidator()
  return useMutation({
    mutationFn: async (id: number) => {
      const r = await api(`/api/projects/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(r.error || `delete failed (${r.status})`)
      return r.data
    },
    onSuccess: invalidate,
  })
}

// ── User accounts + pending approvals ───────────────────────────────────────

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: () => fetchJson<UserRow[]>('/api/users'),
  })
}

export function usePendingUsers() {
  return useQuery({
    queryKey: ['users', 'pending'],
    queryFn: () => fetchJson<PendingUser[]>('/api/users/pending'),
  })
}

// Cadence for the top-nav pending-badge poll (usePendingBadgeSync in
// ../lib/legacyBridge.ts) — mirrors the 60s interval static/app/core.js
// used for its refreshPendingBadge() ticker before PR8.
export const PENDING_BADGE_POLL_MS = 60_000

export function usePendingCount(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['users', 'pending', 'count'],
    queryFn: () => fetchJson<PendingCountResp>('/api/users/pending/count'),
    enabled: options?.enabled,
    refetchInterval: options?.enabled ? PENDING_BADGE_POLL_MS : false,
  })
}

function useUsersInvalidator() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['users'] })
}

export function useApprovePendingUser() {
  const invalidate = useUsersInvalidator()
  return useMutation({
    mutationFn: async (uid: number) => {
      const r = await api(`/api/users/${uid}/approve`, { method: 'POST' })
      if (!r.ok) throw new Error(r.error || `approve failed (${r.status})`)
      return r.data
    },
    onSuccess: invalidate,
  })
}

export function useDeclinePendingUser() {
  const invalidate = useUsersInvalidator()
  return useMutation({
    mutationFn: async (uid: number) => {
      const r = await api(`/api/users/${uid}/decline`, { method: 'POST' })
      if (!r.ok) throw new Error(r.error || `decline failed (${r.status})`)
      return r.data
    },
    onSuccess: invalidate,
  })
}

export function useChangeUserRole() {
  const invalidate = useUsersInvalidator()
  return useMutation({
    mutationFn: async (vars: { uid: number; role: string }) => {
      const r = await api(`/api/users/${vars.uid}/role`, { method: 'PUT', json: { role: vars.role } })
      if (!r.ok) throw new Error(r.error || `role change failed (${r.status})`)
      return r.data
    },
    onSuccess: invalidate,
  })
}

export function useResetUserPassword() {
  return useMutation({
    mutationFn: async (vars: { uid: number; password: string }) => {
      const r = await api(`/api/users/${vars.uid}/password`, {
        method: 'PUT',
        json: { password: vars.password },
      })
      if (!r.ok) throw new Error(r.error || `password reset failed (${r.status})`)
      return r.data
    },
  })
}

export interface DeleteUserResult {
  ok: boolean
  member_id: string | null
}

export function useDeleteUser() {
  const invalidate = useUsersInvalidator()
  return useMutation({
    mutationFn: async (uid: number) => {
      const r = await api<DeleteUserResult>(`/api/users/${uid}`, { method: 'DELETE' })
      if (!r.ok || r.data == null) throw new Error(r.error || `delete failed (${r.status})`)
      return r.data
    },
    onSuccess: invalidate,
  })
}

// ── Time presets ─────────────────────────────────────────────────────────

export function useTimePresets() {
  return useQuery({
    queryKey: ['settings', 'time-presets'],
    queryFn: () => fetchJson<TimePresets>('/api/settings/time-presets'),
  })
}

export function useSaveTimePresets() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: TimePresets) => {
      const r = await api('/api/settings/time-presets', { method: 'PUT', json: vars })
      if (!r.ok) throw new Error(r.error || `save failed (${r.status})`)
      return r.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings', 'time-presets'] }),
  })
}

// ── Worklog visibility ──────────────────────────────────────────────────────

export function useVisibilitySettings() {
  return useQuery({
    queryKey: ['settings', 'visibility'],
    queryFn: () => fetchJson<VisibilityResp>('/api/settings'),
  })
}

export function useSetVisibility() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (open: boolean) => {
      // Backend field is `open`; response echoes back `worklog_open`.
      const r = await api<VisibilityResp & { ok: boolean }>('/api/settings/worklog-visibility', {
        method: 'PUT',
        json: { open },
      })
      if (!r.ok || r.data == null) throw new Error(r.error || `save failed (${r.status})`)
      return r.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings', 'visibility'] }),
  })
}
