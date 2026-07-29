// TanStack Query data layer for the Files island. Replaces the ad-hoc
// api()/loadX() calls scattered through static/app/files.js with cached
// queries + mutations that invalidate the relevant keys on write.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib'
import type {
  FileStats,
  FolderContents,
  FolderNode,
  FolderStats,
  RecentUpload,
} from './types'

const STALE = 60_000 // 60s, per the migration plan's ['files', ...] tier.

async function fetchJson<T>(url: string): Promise<T> {
  const r = await api<T>(url)
  if (!r.ok || r.data == null) throw new Error(r.error || `request failed (${r.status})`)
  return r.data
}

export function useFileTree() {
  return useQuery({
    queryKey: ['files', 'tree'],
    queryFn: () => fetchJson<FolderNode[]>('/api/files/tree'),
    staleTime: STALE,
  })
}

export function useFolderContents(folderId: number | null) {
  return useQuery({
    queryKey: ['files', 'folder', folderId],
    queryFn: () =>
      fetchJson<FolderContents>(
        folderId == null ? '/api/files/folder' : `/api/files/folder/${folderId}`,
      ),
    staleTime: STALE,
  })
}

export function useFileStats() {
  return useQuery({
    queryKey: ['files', 'stats'],
    queryFn: () => fetchJson<FileStats>('/api/files/stats'),
    staleTime: STALE,
  })
}

export function useFolderStats(folderId: number | null) {
  return useQuery({
    queryKey: ['files', 'folder-stats', folderId],
    queryFn: () =>
      fetchJson<FolderStats>(
        folderId == null
          ? '/api/files/folder/stats'
          : `/api/files/folder/${folderId}/stats`,
      ),
    staleTime: STALE,
  })
}

export function useRecentUploads(enabled: boolean) {
  return useQuery({
    queryKey: ['files', 'recent'],
    queryFn: () => fetchJson<RecentUpload[]>('/api/files/recent?limit=20'),
    enabled,
    staleTime: STALE,
  })
}

// Invalidate every ['files', ...] query after a write so the tree, contents,
// stats and folder-stats all refresh from the server.
export function useFilesInvalidator() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['files'] })
}

export function useCreateFolder() {
  const invalidate = useFilesInvalidator()
  return useMutation({
    mutationFn: async (vars: { name: string; parent_id: number | null }) => {
      const r = await api('/api/files/folder', { json: vars })
      if (!r.ok) throw new Error(r.error || `create failed (${r.status})`)
      return r.data
    },
    onSuccess: invalidate,
  })
}

export function useRenameFolder() {
  const invalidate = useFilesInvalidator()
  return useMutation({
    mutationFn: async (vars: { id: number; name: string; is_classified: boolean }) => {
      const r = await api(`/api/files/folder/${vars.id}`, {
        method: 'PUT',
        json: { name: vars.name, is_classified: vars.is_classified },
      })
      if (!r.ok) throw new Error(r.error || `save failed (${r.status})`)
      return r.data
    },
    onSuccess: invalidate,
  })
}

export function useDeleteFolder() {
  const invalidate = useFilesInvalidator()
  return useMutation({
    mutationFn: async (id: number) => {
      const r = await api(`/api/files/folder/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(r.error || `delete failed (${r.status})`)
      return r.data
    },
    onSuccess: invalidate,
  })
}

export function useEditFile() {
  const invalidate = useFilesInvalidator()
  return useMutation({
    mutationFn: async (vars: { id: number; is_classified: boolean }) => {
      const r = await api(`/api/files/${vars.id}`, {
        method: 'PATCH',
        json: { is_classified: vars.is_classified },
      })
      if (!r.ok) throw new Error(r.error || `save failed (${r.status})`)
      return r.data
    },
    onSuccess: invalidate,
  })
}

export function useDeleteFile() {
  const invalidate = useFilesInvalidator()
  return useMutation({
    mutationFn: async (id: number) => {
      const r = await api(`/api/files/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(r.error || `delete failed (${r.status})`)
      return r.data
    },
    onSuccess: invalidate,
  })
}

export function useMoveFile() {
  const invalidate = useFilesInvalidator()
  return useMutation({
    mutationFn: async (vars: { id: number; folder_id: number | null }) => {
      const r = await api(`/api/files/${vars.id}/move`, {
        json: { folder_id: vars.folder_id },
      })
      if (!r.ok) throw new Error(r.error || `move failed (${r.status})`)
      return r.data
    },
    onSuccess: invalidate,
  })
}

export interface BulkDeleteResult {
  deleted: number[]
  failed: { id: number; reason: string }[]
}

export function useBulkDelete() {
  const invalidate = useFilesInvalidator()
  return useMutation({
    mutationFn: async (ids: number[]) => {
      const r = await api<BulkDeleteResult>('/api/files/bulk/delete', { json: { ids } })
      if (!r.ok || r.data == null) throw new Error(r.error || `delete failed (${r.status})`)
      return r.data
    },
    onSuccess: invalidate,
  })
}

// Bulk download streams a zip blob, so it stays a plain fetch rather than a
// query/mutation — there is no cache entry to manage.
export async function bulkDownload(ids: number[]): Promise<void> {
  const res = await fetch('/api/files/bulk/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ ids }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error || String(res.status))
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const cd = res.headers.get('Content-Disposition') || ''
  const match = /filename="?([^";]+)"?/.exec(cd)
  a.download = match ? match[1] : 'files.zip'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
