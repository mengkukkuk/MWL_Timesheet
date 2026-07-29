// Contents pane for the Files island (ported from static/app/files.js's
// renderBreadcrumbs / renderSubfolders / _renderFileList / bulk bar / sort
// header / drop overlay). Filtering + sorting happen here off the folder's
// file list; selection/sort/search state is owned by FilesIsland.

import { useEffect, useMemo, useRef } from 'react'
import { t } from '../lib'
import { fmtBytes, fmtDateShort, isImageMime, isPreviewableDoc } from './helpers'
import type { FileEntry, FolderContents, FolderStats, SortDir, SortKey } from './types'

interface FileListProps {
  contents: FolderContents | undefined
  folderStats: FolderStats | undefined
  currentUserId: number | undefined
  elevated: boolean
  selectedIds: Set<number>
  searchInput: string
  searchTerm: string
  sortKey: SortKey
  sortDir: SortDir
  dropOverlayVisible: boolean
  onSelectFolder: (id: number | null) => void
  onSearchChange: (v: string) => void
  onSortClick: (key: SortKey) => void
  onToggleSelect: (id: number, checked: boolean) => void
  onSelectAll: (ids: number[], checked: boolean) => void
  onOpenPreview: (file: FileEntry) => void
  onEditFile: (id: number) => void
  onDeleteFile: (id: number) => void
  onBulkDownload: () => void
  onBulkDelete: () => void
  onClearSelection: () => void
  onOpenRecent: () => void
  onFileDragStart: (id: number) => void
  onFileDragEnd: () => void
  onDropOverlayDragOver: (e: React.DragEvent) => void
  onDropOverlayDragLeave: (e: React.DragEvent) => void
  onDropOverlayDrop: (e: React.DragEvent) => void
}

function applyFilterSort(
  files: FileEntry[],
  searchTerm: string,
  sortKey: SortKey,
  sortDir: SortDir,
): FileEntry[] {
  let out = files.slice()
  if (searchTerm) {
    const q = searchTerm.toLowerCase()
    out = out.filter((f) => (f.original_name || '').toLowerCase().includes(q))
  }
  const dir = sortDir === 'asc' ? 1 : -1
  out.sort((a, b) => {
    let av: string | number
    let bv: string | number
    switch (sortKey) {
      case 'size':
        av = a.size_bytes || 0
        bv = b.size_bytes || 0
        break
      case 'date':
        av = a.uploaded_at || ''
        bv = b.uploaded_at || ''
        break
      case 'uploader':
        av = (a.uploaded_by_name || '').toLowerCase()
        bv = (b.uploaded_by_name || '').toLowerCase()
        break
      default:
        av = (a.original_name || '').toLowerCase()
        bv = (b.original_name || '').toLowerCase()
    }
    if (av < bv) return -1 * dir
    if (av > bv) return 1 * dir
    return 0
  })
  return out
}

function sortIndicator(active: boolean, dir: SortDir): string {
  if (!active) return ''
  return dir === 'asc' ? '\u25B2' : '\u25BC'
}

function folderStatsText(s: FolderStats | undefined): string {
  if (!s) return ''
  return (
    `${s.file_count} file${s.file_count === 1 ? '' : 's'} · ${fmtBytes(s.total_bytes)}` +
    (s.subfolder_count
      ? ` · ${s.subfolder_count} subfolder${s.subfolder_count === 1 ? '' : 's'}`
      : '')
  )
}

export function FileList(props: FileListProps) {
  const {
    contents,
    folderStats,
    currentUserId,
    elevated,
    selectedIds,
    searchInput,
    searchTerm,
    sortKey,
    sortDir,
    dropOverlayVisible,
    onSelectFolder,
    onSearchChange,
    onSortClick,
    onToggleSelect,
    onSelectAll,
    onOpenPreview,
    onEditFile,
    onDeleteFile,
    onBulkDownload,
    onBulkDelete,
    onClearSelection,
    onOpenRecent,
    onFileDragStart,
    onFileDragEnd,
    onDropOverlayDragOver,
    onDropOverlayDragLeave,
    onDropOverlayDrop,
  } = props

  const files = contents?.files || []
  const folders = contents?.folders || []
  const breadcrumbs = contents?.breadcrumbs || []

  const visible = useMemo(
    () => applyFilterSort(files, searchTerm, sortKey, sortDir),
    [files, searchTerm, sortKey, sortDir],
  )

  const selectedCount = selectedIds.size
  const visibleSelected = visible.filter((f) => selectedIds.has(f.id)).length
  const allChecked = visible.length > 0 && visibleSelected === visible.length
  const indeterminate = visibleSelected > 0 && visibleSelected < visible.length

  const selectAllRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = indeterminate
  }, [indeterminate])

  return (
    <section
      className="card bg-white md:col-span-3 p-4 min-h-[24rem] relative"
      id="file-contents-pane"
      onDragOver={onDropOverlayDragOver}
      onDragLeave={onDropOverlayDragLeave}
      onDrop={onDropOverlayDrop}
    >
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <nav id="file-breadcrumbs" className="flex items-center gap-1 text-sm text-gray-500 flex-wrap">
          <a onClick={() => onSelectFolder(null)} className="cursor-pointer hover:text-indigo-600">
            Root
          </a>
          {breadcrumbs.map((c) => (
            <span key={c.id} className="contents">
              <span className="text-gray-300"> / </span>
              <a
                onClick={() => onSelectFolder(c.id)}
                className="cursor-pointer hover:text-indigo-600"
              >
                {c.name}
              </a>
            </span>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <button
            type="button"
            id="file-recent-btn"
            onClick={onOpenRecent}
            className="text-xs px-2.5 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            Recent uploads
          </button>
          <span id="file-folder-stats" className="text-xs text-gray-400">
            {folderStatsText(folderStats)}
          </span>
        </div>
      </div>

      {/* Search bar */}
      <div className="search-wrap mb-3 relative">
        <svg
          className="search-icon w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z"
          />
        </svg>
        <input
          id="file-search"
          type="text"
          placeholder="       Search files in this folder..."
          value={searchInput}
          onChange={(e) => onSearchChange(e.target.value)}
          className="input-field w-full pl-9 text-sm"
        />
      </div>

      {/* Subfolders */}
      {folders.length > 0 && (
        <div id="file-subfolders-wrap" className="mb-4">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            {t('files.subfolders') || 'Subfolders'}
          </h4>
          <div id="file-subfolders" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {folders.map((f) => (
              <div
                key={f.id}
                onClick={() => onSelectFolder(f.id)}
                className="flex items-center gap-2 p-2 border border-gray-200 rounded-md cursor-pointer hover:bg-indigo-50 hover:border-indigo-300 transition-colors"
              >
                <svg
                  className="w-5 h-5 text-indigo-500 flex-shrink-0"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z" />
                </svg>
                <span className="text-sm text-gray-700 truncate">{f.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bulk action bar */}
      {selectedCount > 0 && (
        <div
          id="file-bulk-bar"
          className="mb-2 flex items-center justify-between gap-2 px-3 py-2 bg-indigo-50 border border-indigo-200 rounded-lg"
        >
          <span className="text-sm font-medium text-indigo-800">
            <span id="file-bulk-count">{selectedCount}</span> selected
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBulkDownload}
              className="text-xs px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded inline-flex items-center gap-1"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3"
                />
              </svg>
              Download
            </button>
            <button
              type="button"
              onClick={onBulkDelete}
              className="text-xs px-2.5 py-1 bg-white hover:bg-red-50 text-red-600 border border-red-200 rounded inline-flex items-center gap-1"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a2 2 0 012-2h2a2 2 0 012 2v3"
                />
              </svg>
              Delete
            </button>
            <button
              type="button"
              onClick={onClearSelection}
              className="text-xs px-2 py-1 text-gray-500 hover:text-gray-700"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Files */}
      <div>
        <div className="grid grid-cols-12 gap-2 px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-200">
          <div className="col-span-1 flex items-center">
            <input
              ref={selectAllRef}
              type="checkbox"
              id="file-select-all"
              checked={allChecked}
              onChange={(e) => onSelectAll(visible.map((f) => f.id), e.target.checked)}
              className="cursor-pointer"
            />
          </div>
          <div
            className="col-span-5 flex items-center cursor-pointer hover:text-indigo-600 select-none"
            onClick={() => onSortClick('name')}
          >
            Name <span className="ml-1">{sortIndicator(sortKey === 'name', sortDir)}</span>
          </div>
          <div
            className="col-span-2 hidden sm:flex items-center cursor-pointer hover:text-indigo-600 select-none"
            onClick={() => onSortClick('size')}
          >
            Size <span className="ml-1">{sortIndicator(sortKey === 'size', sortDir)}</span>
          </div>
          <div
            className="col-span-2 hidden sm:flex items-center cursor-pointer hover:text-indigo-600 select-none"
            onClick={() => onSortClick('uploader')}
          >
            Uploader <span className="ml-1">{sortIndicator(sortKey === 'uploader', sortDir)}</span>
          </div>
          <div
            className="col-span-2 hidden sm:flex items-center cursor-pointer hover:text-indigo-600 select-none"
            onClick={() => onSortClick('date')}
          >
            Uploaded <span className="ml-1">{sortIndicator(sortKey === 'date', sortDir)}</span>
          </div>
        </div>
        <div id="file-list" className="divide-y divide-gray-100">
          {visible.map((f) => (
            <FileRow
              key={f.id}
              file={f}
              selected={selectedIds.has(f.id)}
              elevated={elevated}
              currentUserId={currentUserId}
              onToggleSelect={onToggleSelect}
              onOpenPreview={onOpenPreview}
              onEditFile={onEditFile}
              onDeleteFile={onDeleteFile}
              onFileDragStart={onFileDragStart}
              onFileDragEnd={onFileDragEnd}
            />
          ))}
        </div>
        {visible.length === 0 && (
          <p id="file-empty-msg" className="text-sm text-gray-400 text-center py-8">
            {searchTerm
              ? `No files match "${searchTerm}".`
              : 'No files here yet. Drop files anywhere in this panel to upload.'}
          </p>
        )}
      </div>

      {/* Drop overlay */}
      {dropOverlayVisible && (
        <div
          id="file-drop-overlay"
          className="absolute inset-0 bg-indigo-50/80 border-2 border-dashed border-indigo-400 rounded-lg flex items-center justify-center pointer-events-none"
        >
          <p className="text-indigo-700 font-medium">{t('files.drop_here') || 'Drop to upload'}</p>
        </div>
      )}
    </section>
  )
}

interface FileRowProps {
  file: FileEntry
  selected: boolean
  elevated: boolean
  currentUserId: number | undefined
  onToggleSelect: (id: number, checked: boolean) => void
  onOpenPreview: (file: FileEntry) => void
  onEditFile: (id: number) => void
  onDeleteFile: (id: number) => void
  onFileDragStart: (id: number) => void
  onFileDragEnd: () => void
}

function FileRow(props: FileRowProps) {
  const {
    file: f,
    selected,
    elevated,
    currentUserId,
    onToggleSelect,
    onOpenPreview,
    onEditFile,
    onDeleteFile,
    onFileDragStart,
    onFileDragEnd,
  } = props
  const canDelete = elevated || currentUserId === f.uploaded_by
  const canMove = elevated || currentUserId === f.uploaded_by
  const canManage = elevated
  const isImg = isImageMime(f.mime_type)
  const isDoc = !isImg && isPreviewableDoc(f.mime_type, f.original_name)
  const canPreview = isImg || isDoc

  return (
    <div
      className={`file-row ${selected ? 'selected' : ''}`}
      data-file-id={f.id}
      draggable={canMove || undefined}
      onDragStart={
        canMove
          ? (e) => {
              try {
                e.dataTransfer.setData('text/plain', String(f.id))
                e.dataTransfer.effectAllowed = 'move'
              } catch {
                /* ignore */
              }
              onFileDragStart(f.id)
            }
          : undefined
      }
      onDragEnd={canMove ? onFileDragEnd : undefined}
    >
      <div className="file-row-checkbox">
        <input
          type="checkbox"
          data-file-cb={f.id}
          checked={selected}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onToggleSelect(f.id, e.target.checked)}
        />
      </div>
      <div className="file-row-name">
        {isImg ? (
          <img
            className="file-row-thumb"
            src={`/api/files/${f.id}/download?inline=1`}
            alt=""
            loading="lazy"
            onClick={() => onOpenPreview(f)}
          />
        ) : (
          <svg
            className="w-4 h-4 text-gray-400 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        )}
        <span
          className="file-row-name-text"
          title={f.original_name}
          onClick={
            canPreview
              ? () => onOpenPreview(f)
              : () => {
                  window.location.href = `/api/files/${f.id}/download`
                }
          }
        >
          {f.original_name}
        </span>
        {f.is_classified && (
          <span className="ml-1 text-amber-500 flex-shrink-0" title={t('files.classified')}>
            {'\u{1F512}'}
          </span>
        )}
        <div className="file-row-actions">
          {canPreview && (
            <button type="button" onClick={() => onOpenPreview(f)}>
              Preview
            </button>
          )}
          <a href={`/api/files/${f.id}/download`}>Download</a>
          {canManage && (
            <button type="button" onClick={() => onEditFile(f.id)} title={t('files.edit')}>
              {t('files.edit')}
            </button>
          )}
          {canDelete && (
            <button type="button" className="danger" onClick={() => onDeleteFile(f.id)}>
              Delete
            </button>
          )}
        </div>
      </div>
      <div className="file-row-size">{fmtBytes(f.size_bytes)}</div>
      <div className="file-row-uploader">{f.uploaded_by_name || ''}</div>
      <div className="file-row-date">{fmtDateShort(f.uploaded_at)}</div>
    </div>
  )
}
