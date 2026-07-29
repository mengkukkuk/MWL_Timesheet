// Files island orchestrator (ports static/app/files.js's top-level state +
// wiring into a single React component). Owns folder selection, selection set,
// search/sort, drag-to-move, upload, and modal state; delegates rendering to
// FolderTree / FileList / UploadPanel / PreviewModal / the modal components,
// and all data access to the useFilesData hooks + useUploader.

import { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react'
import { isElevated, t, useCurrentUser } from '../lib'
import { FileList } from './FileList'
import { FolderTree } from './FolderTree'
import { FileEditModal, FolderEditModal, NewFolderModal, RecentModal } from './Modals'
import { PreviewModal } from './PreviewModal'
import { UploadPanel } from './UploadPanel'
import { UsageCard } from './UsageCard'
import {
  bulkDownload,
  useBulkDelete,
  useCreateFolder,
  useDeleteFile,
  useDeleteFolder,
  useEditFile,
  useFileStats,
  useFileTree,
  useFilesInvalidator,
  useFolderContents,
  useFolderStats,
  useMoveFile,
  useRecentUploads,
  useRenameFolder,
} from './useFilesData'
import { useUploader } from './useUploader'
import { toast } from '../lib'
import type { FileEntry, FolderNode, FolderSummary, SortKey } from './types'

const COLLAPSE_KEY = 'mwl_files_collapsed'

function loadCollapsed(): Set<number> {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as unknown
    if (Array.isArray(arr)) return new Set(arr.map(Number).filter((n) => !Number.isNaN(n)))
  } catch {
    /* localStorage unavailable / bad json */
  }
  return new Set()
}

function persistCollapsed(set: Set<number>): void {
  try {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...set]))
  } catch {
    /* ignore */
  }
}

// Walk the tree to collect the ancestor folder ids of `fid` (excluding fid).
function findFolderPath(fid: number, nodes: FolderNode[], path: number[]): number[] | null {
  for (const n of nodes) {
    if (n.id === fid) return path
    if (n.children && n.children.length) {
      const hit = findFolderPath(fid, n.children, [...path, n.id])
      if (hit) return hit
    }
  }
  return null
}

function findFolderNode(fid: number, nodes: FolderNode[]): FolderNode | null {
  const stack = [...nodes]
  while (stack.length) {
    const n = stack.pop() as FolderNode
    if (n.id === fid) return n
    if (n.children && n.children.length) stack.push(...n.children)
  }
  return null
}

export function FilesIsland() {
  const user = useCurrentUser()
  const elevated = isElevated(user?.role)
  const currentUserId = user?.id

  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [searchInput, setSearchInput] = useState('')
  const searchTerm = useDeferredValue(searchInput).trim()
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [collapsed, setCollapsed] = useState<Set<number>>(loadCollapsed)

  const [previewFile, setPreviewFile] = useState<FileEntry | null>(null)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [editFolder, setEditFolder] = useState<FolderSummary | null>(null)
  const [editFile, setEditFile] = useState<FileEntry | null>(null)
  const [recentOpen, setRecentOpen] = useState(false)

  const [dragFileId, setDragFileId] = useState<number | null>(null)
  const [dropTargetId, setDropTargetId] = useState<number | null | 'root' | undefined>(undefined)
  const [dropOverlayVisible, setDropOverlayVisible] = useState(false)
  const dragDepth = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const treeQuery = useFileTree()
  const contentsQuery = useFolderContents(currentFolderId)
  const statsQuery = useFileStats()
  const folderStatsQuery = useFolderStats(currentFolderId)
  const recentQuery = useRecentUploads(recentOpen)

  const invalidate = useFilesInvalidator()
  const createFolder = useCreateFolder()
  const renameFolder = useRenameFolder()
  const deleteFolder = useDeleteFolder()
  const editFileMut = useEditFile()
  const deleteFileMut = useDeleteFile()
  const moveFile = useMoveFile()
  const bulkDelete = useBulkDelete()

  const uploader = useUploader(invalidate)

  const tree = useMemo<FolderNode[]>(() => treeQuery.data || [], [treeQuery.data])
  const contents = contentsQuery.data
  const folderName = useCallback(
    (fid: number | null): string =>
      fid == null ? 'Root' : findFolderNode(fid, tree)?.name || `Folder #${fid}`,
    [tree],
  )

  // ── Folder navigation ──
  const selectFolder = useCallback(
    (fid: number | null) => {
      setCurrentFolderId(fid)
      setSelectedIds(new Set())
      setSearchInput('')
      if (fid != null) {
        const ancestors = findFolderPath(fid, tree, [])
        if (ancestors && ancestors.length) {
          setCollapsed((prev) => {
            let changed = false
            const next = new Set(prev)
            ancestors.forEach((id) => {
              if (next.delete(id)) changed = true
            })
            if (changed) persistCollapsed(next)
            return changed ? next : prev
          })
        }
      }
    },
    [tree],
  )

  const toggleCollapse = useCallback((fid: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(fid)) next.delete(fid)
      else next.add(fid)
      persistCollapsed(next)
      return next
    })
  }, [])

  // ── Selection ──
  const toggleSelect = useCallback((id: number, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const selectAll = useCallback((ids: number[], checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) ids.forEach((id) => next.add(id))
      else ids.forEach((id) => next.delete(id))
      return next
    })
  }, [])

  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])

  const onSortClick = useCallback((key: SortKey) => {
    setSortKey((prevKey) => {
      if (prevKey === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
        return prevKey
      }
      setSortDir('asc')
      return key
    })
  }, [])

  // ── File CRUD ──
  const openEditFile = useCallback(
    (id: number) => {
      const f = (contents?.files || []).find((x) => x.id === id)
      if (f) setEditFile(f)
    },
    [contents],
  )

  const doEditFile = useCallback(
    (isClassified: boolean) => {
      if (!editFile) return
      editFileMut.mutate(
        { id: editFile.id, is_classified: isClassified },
        {
          onSuccess: () => {
            toast(t('files.saved') || 'Saved')
            setEditFile(null)
          },
          onError: (e) => toast(e instanceof Error ? e.message : 'Save failed', 'error'),
        },
      )
    },
    [editFile, editFileMut],
  )

  const deleteFile = useCallback(
    (id: number) => {
      const f = (contents?.files || []).find((x) => x.id === id)
      const name = f?.original_name || ''
      if (!window.confirm(`Delete file "${name}"?`)) return
      deleteFileMut.mutate(id, {
        onSuccess: () => {
          toast('File deleted')
          setSelectedIds((prev) => {
            if (!prev.has(id)) return prev
            const next = new Set(prev)
            next.delete(id)
            return next
          })
        },
        onError: (e) => toast(e instanceof Error ? e.message : 'Delete failed', 'error'),
      })
    },
    [contents, deleteFileMut],
  )

  // ── Folder CRUD ──
  const doCreateFolder = useCallback(
    (name: string) => {
      createFolder.mutate(
        { name, parent_id: currentFolderId },
        {
          onSuccess: () => {
            toast('Folder created')
            setNewFolderOpen(false)
          },
          onError: (e) => toast(e instanceof Error ? e.message : 'Create failed', 'error'),
        },
      )
    },
    [createFolder, currentFolderId],
  )

  const openEditFolder = useCallback(
    (id: number) => {
      const n = findFolderNode(id, tree)
      if (n)
        setEditFolder({
          id: n.id,
          name: n.name,
          parent_id: n.parent_id,
          is_classified: n.is_classified,
        })
    },
    [tree],
  )

  const doRenameFolder = useCallback(
    (name: string, isClassified: boolean) => {
      if (!editFolder) return
      renameFolder.mutate(
        { id: editFolder.id, name, is_classified: isClassified },
        {
          onSuccess: () => {
            toast(t('files.saved') || 'Saved')
            setEditFolder(null)
          },
          onError: (e) => toast(e instanceof Error ? e.message : 'Save failed', 'error'),
        },
      )
    },
    [editFolder, renameFolder],
  )

  const deleteFolderHandler = useCallback(
    (id: number) => {
      const name = findFolderNode(id, tree)?.name || ''
      if (!window.confirm(`Delete folder "${name}"? Folder must be empty.`)) return
      deleteFolder.mutate(id, {
        onSuccess: () => {
          toast('Folder deleted')
          if (currentFolderId === id) selectFolder(null)
        },
        onError: (e) => toast(e instanceof Error ? e.message : 'Delete failed', 'error'),
      })
    },
    [tree, deleteFolder, currentFolderId, selectFolder],
  )

  // ── Bulk actions ──
  const onBulkDownload = useCallback(() => {
    const ids = [...selectedIds]
    if (!ids.length) return
    bulkDownload(ids).catch((e) =>
      toast(e instanceof Error ? e.message : 'Download failed', 'error'),
    )
  }, [selectedIds])

  const onBulkDelete = useCallback(() => {
    const ids = [...selectedIds]
    if (!ids.length) return
    if (!window.confirm(`Delete ${ids.length} file${ids.length === 1 ? '' : 's'}?`)) return
    bulkDelete.mutate(ids, {
      onSuccess: (res) => {
        const nDel = res.deleted.length
        if (nDel) toast(`Deleted ${nDel} file${nDel === 1 ? '' : 's'}`)
        if (res.failed.length) toast(`${res.failed.length} could not be deleted`, 'error')
        clearSelection()
      },
      onError: (e) => toast(e instanceof Error ? e.message : 'Delete failed', 'error'),
    })
  }, [selectedIds, bulkDelete, clearSelection])

  // ── Upload ──
  const onUploadClick = useCallback(() => fileInputRef.current?.click(), [])
  const onFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? Array.from(e.target.files) : []
      e.target.value = ''
      if (!files.length) return
      uploader.uploadFiles(files, currentFolderId, folderName(currentFolderId))
    },
    [uploader, currentFolderId, folderName],
  )

  // ── Drag-to-move (file row → folder tree node) ──
  const onFileDragStart = useCallback((id: number) => setDragFileId(id), [])
  const onFileDragEnd = useCallback(() => {
    setDragFileId(null)
    setDropTargetId(undefined)
  }, [])

  const onDropFolder = useCallback(
    (targetId: number | null) => {
      const movedId = dragFileId
      setDragFileId(null)
      setDropTargetId(undefined)
      if (movedId == null) return
      if (targetId === currentFolderId) return
      moveFile.mutate(
        { id: movedId, folder_id: targetId },
        {
          onSuccess: () => toast('File moved'),
          onError: (err) => toast(err instanceof Error ? err.message : 'Move failed', 'error'),
        },
      )
    },
    [dragFileId, currentFolderId, moveFile],
  )

  // ── Drop-to-upload overlay (gated so a file-move drag doesn't trigger it) ──
  const onDropOverlayDragOver = useCallback(
    (e: React.DragEvent) => {
      if (dragFileId != null) return
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    },
    [dragFileId],
  )

  const onDropOverlayDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (dragFileId != null) return
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return
      dragDepth.current += 1
      setDropOverlayVisible(true)
    },
    [dragFileId],
  )

  const onDropOverlayDragLeave = useCallback(() => {
    if (dragFileId != null) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDropOverlayVisible(false)
  }, [dragFileId])

  const onDropOverlayDrop = useCallback(
    (e: React.DragEvent) => {
      dragDepth.current = 0
      setDropOverlayVisible(false)
      if (dragFileId != null) return
      const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : []
      if (!files.length) return
      e.preventDefault()
      uploader.uploadFiles(files, currentFolderId, folderName(currentFolderId))
    },
    [dragFileId, uploader, currentFolderId, folderName],
  )

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <h2 className="text-lg font-semibold text-gray-800">{t('files.title') || 'Files'}</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setNewFolderOpen(true)}
            className="btn-secondary text-sm px-3 py-1.5 inline-flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 6v6m0 0v6m0-6h6m-6 0H6"
              />
            </svg>
            {t('files.new_folder') || 'New Folder'}
          </button>
          <button
            type="button"
            onClick={onUploadClick}
            className="btn-primary text-sm px-3 py-1.5 inline-flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 8l5-5 5 5M12 3v12"
              />
            </svg>
            {t('files.upload') || 'Upload'}
          </button>
          <input ref={fileInputRef} type="file" multiple hidden onChange={onFileInputChange} />
        </div>
      </div>

      <UsageCard stats={statsQuery.data} />

      <div
        className="grid grid-cols-1 md:grid-cols-4 gap-4"
        onDragEnter={onDropOverlayDragEnter}
        onDragLeave={onDropOverlayDragLeave}
      >
        <aside className="card bg-white p-4 md:col-span-1">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              {t('files.folders') || 'Folders'}
            </h4>
            <button
              type="button"
              onClick={() => invalidate()}
              className="text-gray-300 hover:text-indigo-500 text-xs"
              title={t('files.refresh') || 'Refresh'}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
          </div>
          <FolderTree
            tree={tree}
            currentFolderId={currentFolderId}
            collapsed={collapsed}
            elevated={elevated}
            dragActive={dragFileId != null}
            dropTargetId={dropTargetId}
            onSelect={selectFolder}
            onToggleCollapse={toggleCollapse}
            onDeleteFolder={deleteFolderHandler}
            onEditFolder={openEditFolder}
            onDropFolder={onDropFolder}
            onDragOverFolder={setDropTargetId}
            onDragLeaveFolder={() => setDropTargetId(undefined)}
          />
        </aside>

        <FileList
          contents={contents}
          folderStats={folderStatsQuery.data}
          currentUserId={currentUserId}
          elevated={elevated}
          selectedIds={selectedIds}
          searchInput={searchInput}
          searchTerm={searchTerm}
          sortKey={sortKey}
          sortDir={sortDir}
          dropOverlayVisible={dropOverlayVisible}
          onSelectFolder={selectFolder}
          onSearchChange={setSearchInput}
          onSortClick={onSortClick}
          onToggleSelect={toggleSelect}
          onSelectAll={selectAll}
          onOpenPreview={setPreviewFile}
          onEditFile={openEditFile}
          onDeleteFile={deleteFile}
          onBulkDownload={onBulkDownload}
          onBulkDelete={onBulkDelete}
          onClearSelection={clearSelection}
          onOpenRecent={() => setRecentOpen(true)}
          onFileDragStart={onFileDragStart}
          onFileDragEnd={onFileDragEnd}
          onDropOverlayDragOver={onDropOverlayDragOver}
          onDropOverlayDragLeave={onDropOverlayDragLeave}
          onDropOverlayDrop={onDropOverlayDrop}
        />
      </div>

      <UploadPanel uploader={uploader} />
      <PreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
      <NewFolderModal
        open={newFolderOpen}
        parentName={currentFolderId == null ? null : folderName(currentFolderId)}
        onClose={() => setNewFolderOpen(false)}
        onCreate={doCreateFolder}
      />
      <FolderEditModal folder={editFolder} onClose={() => setEditFolder(null)} onSave={doRenameFolder} />
      <FileEditModal file={editFile} onClose={() => setEditFile(null)} onSave={doEditFile} />
      <RecentModal
        open={recentOpen}
        rows={recentQuery.data}
        loading={recentQuery.isLoading}
        onClose={() => setRecentOpen(false)}
      />
    </div>
  )
}
