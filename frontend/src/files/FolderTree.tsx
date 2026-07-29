// Sidebar folder tree (ported from static/app/files.js renderFileTree /
// renderTreeNodes). Collapsible nodes, classified lock, elevated-only edit /
// delete affordances, and drag-drop targets for moving files between folders.

import { t } from '../lib'
import type { FolderNode } from './types'

interface FolderTreeProps {
  tree: FolderNode[]
  currentFolderId: number | null
  collapsed: Set<number>
  elevated: boolean
  dragActive: boolean
  dropTargetId: number | null | 'root' | undefined
  onSelect: (id: number | null) => void
  onToggleCollapse: (id: number) => void
  onDeleteFolder: (id: number) => void
  onEditFolder: (id: number) => void
  onDropFolder: (id: number | null) => void
  onDragOverFolder: (id: number | null | 'root') => void
  onDragLeaveFolder: () => void
}

interface NodeProps extends FolderTreeProps {
  nodes: FolderNode[]
  depth: number
}

function TreeNodes(props: NodeProps) {
  const {
    nodes,
    depth,
    currentFolderId,
    collapsed,
    elevated,
    dragActive,
    dropTargetId,
    onSelect,
    onToggleCollapse,
    onDeleteFolder,
    onEditFolder,
    onDropFolder,
    onDragOverFolder,
    onDragLeaveFolder,
  } = props
  if (!nodes || !nodes.length) return null
  return (
    <>
      {nodes.map((n) => {
        const isActive = currentFolderId === n.id
        const pad = 8 + depth * 12
        const hasChildren = !!(n.children && n.children.length)
        const isCollapsed = hasChildren && collapsed.has(n.id)
        const isDropTarget = dropTargetId === n.id
        return (
          <div key={n.id}>
            <div
              className={`folder-tree-node ${isActive ? 'active' : ''} ${isDropTarget ? 'drop-target' : ''}`}
              style={{ paddingLeft: pad + 'px' }}
              onClick={() => onSelect(n.id)}
              onDragOver={(e) => {
                if (!dragActive) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                onDragOverFolder(n.id)
              }}
              onDragLeave={() => {
                if (dragActive) onDragLeaveFolder()
              }}
              onDrop={(e) => {
                if (!dragActive) return
                e.preventDefault()
                e.stopPropagation()
                onDropFolder(n.id)
              }}
            >
              {hasChildren ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleCollapse(n.id)
                  }}
                  className="folder-tree-toggle inline-flex items-center justify-center w-4 h-4 -mt-0.5 text-gray-400 hover:text-gray-600 flex-shrink-0"
                  title={isCollapsed ? t('files.expand') || 'Expand' : t('files.collapse') || 'Collapse'}
                >
                  <svg
                    className={`w-3 h-3 transition-transform duration-150 ${isCollapsed ? '' : 'rotate-90'}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              ) : (
                <span className="inline-block w-4 h-4 flex-shrink-0" />
              )}
              <svg
                className="w-4 h-4 inline-block -mt-0.5 text-indigo-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                />
              </svg>
              <span className="ml-1">{n.name}</span>
              {n.is_classified && (
                <span className="ml-1 text-amber-500" title={t('files.classified')}>
                  {'\u{1F512}'}
                </span>
              )}
              {elevated && (
                <>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDeleteFolder(n.id)
                    }}
                    className="float-right text-gray-300 hover:text-red-500 text-xs px-1"
                    title="Delete folder"
                  >
                    {'\u00D7'}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onEditFolder(n.id)
                    }}
                    className="float-right text-gray-300 hover:text-indigo-500 text-xs px-1"
                    title={t('files.edit')}
                  >
                    {'\u270E'}
                  </button>
                </>
              )}
            </div>
            {!isCollapsed && (
              <TreeNodes {...props} nodes={n.children} depth={depth + 1} />
            )}
          </div>
        )
      })}
    </>
  )
}

export function FolderTree(props: FolderTreeProps) {
  const { currentFolderId, dragActive, dropTargetId, onSelect, onDropFolder, onDragOverFolder, onDragLeaveFolder } =
    props
  return (
    <div id="file-tree" className="text-sm text-gray-700 space-y-0.5">
      <div
        className={`folder-tree-node ${currentFolderId === null ? 'active' : ''} ${dropTargetId === 'root' ? 'drop-target' : ''}`}
        onClick={() => onSelect(null)}
        onDragOver={(e) => {
          if (!dragActive) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          onDragOverFolder('root')
        }}
        onDragLeave={() => {
          if (dragActive) onDragLeaveFolder()
        }}
        onDrop={(e) => {
          if (!dragActive) return
          e.preventDefault()
          e.stopPropagation()
          onDropFolder(null)
        }}
      >
        <svg
          className="w-4 h-4 inline-block -mt-0.5 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
          />
        </svg>
        <span className="ml-1">Root</span>
      </div>
      <TreeNodes {...props} nodes={props.tree} depth={1} />
    </div>
  )
}
