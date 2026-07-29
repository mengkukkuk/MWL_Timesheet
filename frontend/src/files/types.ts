// Shared types for the Files island (ported from static/app/files.js +
// file-preview.js). Field names mirror the JSON returned by app/files.py.

export interface FolderNode {
  id: number
  name: string
  parent_id: number | null
  is_classified: boolean
  children: FolderNode[]
}

export interface Breadcrumb {
  id: number
  name: string
}

export interface FolderSummary {
  id: number
  name: string
  parent_id: number | null
  is_classified: boolean
}

export interface FileEntry {
  id: number
  original_name: string
  size_bytes: number
  mime_type: string | null
  uploaded_at: string
  uploaded_by: number
  is_classified: boolean
  uploaded_by_name: string | null
}

export interface FolderContents {
  folder_id: number | null
  breadcrumbs: Breadcrumb[]
  folders: FolderSummary[]
  files: FileEntry[]
}

export interface FileStats {
  file_count: number
  folder_count: number
  used_bytes: number
  cap_bytes: number
  free_disk_bytes: number
  min_free_bytes: number
  total_bytes: number
}

export interface FolderStats {
  folder_id: number | null
  file_count: number
  total_bytes: number
  subfolder_count: number
}

export interface RecentUpload {
  id: number
  original_name: string
  size_bytes: number
  uploaded_by_name: string | null
  folder_name: string | null
  uploaded_at: string
}

export type SortKey = 'name' | 'size' | 'date' | 'uploader'
export type SortDir = 'asc' | 'desc'
