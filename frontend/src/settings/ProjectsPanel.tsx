// Projects panel (ported from static/app/worklogs.js's loadProjectsList/
// addProject/deleteProject, formerly rendered into #projects-list).

import { useState } from 'react'
import { toast } from '../lib'
import { useAddProject, useDeleteProject, useSettingsProjects } from './useSettingsData'

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback
}

export function ProjectsPanel() {
  const projectsQuery = useSettingsProjects()
  const addProject = useAddProject()
  const deleteProject = useDeleteProject()
  const [name, setName] = useState('')

  const add = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    addProject.mutate(trimmed, {
      onSuccess: () => {
        setName('')
        toast('Project added')
      },
      onError: (e) => toast(errMsg(e, 'Create failed'), 'error'),
    })
  }

  const remove = (id: number, projectName: string) => {
    if (!window.confirm(`Delete project "${projectName}"?`)) return
    deleteProject.mutate(id, {
      onSuccess: () => toast('Project deleted'),
      onError: (e) => toast(errMsg(e, 'Delete failed'), 'error'),
    })
  }

  return (
    <div id="settings-panel-projects" className="settings-panel card bg-white">
      <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">Projects</h3>
      <div className="flex gap-2 mb-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Project name"
          className="input-field flex-1"
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
        />
        <button onClick={add} className="btn-primary text-sm px-3">
          Add
        </button>
      </div>
      <ul className="space-y-2">
        {(projectsQuery.data || []).map((p) => (
          <li
            key={p.id}
            className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-gray-50"
          >
            <span className="text-sm font-medium">{p.name}</span>
            <button className="btn-icon danger" onClick={() => remove(p.id, p.name)} title="Remove">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
