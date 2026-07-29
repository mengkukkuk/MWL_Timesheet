// Team Members panel (ported from static/app/settings.js's
// loadMembersList/_renderMembersList/toggleEditMember/saveMemberEdit/
// addMember/deleteMember). Backed by dbo.Employee via /api/employees.

import { useState } from 'react'
import { toast } from '../lib'
import type { Employee } from './types'
import {
  useAddEmployee,
  useDeleteEmployee,
  useEmployees,
  useUpdateEmployee,
} from './useSettingsData'

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback
}

interface MemberRowProps {
  member: Employee
}

function MemberRow({ member }: MemberRowProps) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(member.name)
  const [department, setDepartment] = useState(member.department || '')
  const [position, setPosition] = useState(member.position || '')
  const [level, setLevel] = useState(member.level || '')
  const [jg, setJg] = useState(member.jg || '')

  const updateEmployee = useUpdateEmployee()
  const deleteEmployee = useDeleteEmployee()

  const openEdit = () => {
    setName(member.name)
    setDepartment(member.department || '')
    setPosition(member.position || '')
    setLevel(member.level || '')
    setJg(member.jg || '')
    setEditing(true)
  }

  const save = () => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      toast('Name is required', 'error')
      return
    }
    updateEmployee.mutate(
      {
        id: Number(member.id),
        name: trimmedName,
        department: department.trim(),
        position: position.trim(),
        level: level.trim(),
        jg: jg.trim(),
      },
      {
        onSuccess: () => {
          toast('Member updated')
          setEditing(false)
        },
        onError: (e) => toast(errMsg(e, 'Save failed'), 'error'),
      },
    )
  }

  const remove = () => {
    if (
      !window.confirm(
        'Remove this employee from the directory?\n\nNote: any existing user accounts that referenced this Employee ID will keep working until the next migration phase.',
      )
    )
      return
    deleteEmployee.mutate(Number(member.id), {
      onSuccess: (res) => {
        if (res.warning) toast(res.warning, 'error')
        toast('Member removed')
      },
      onError: (e) => toast(errMsg(e, 'Delete failed'), 'error'),
    })
  }

  return (
    <li className="rounded-lg bg-gray-50 overflow-hidden">
      <div className="flex items-center justify-between py-1.5 px-3">
        <div>
          <span className="text-sm font-medium">{member.name}</span>
          <span className="text-xs text-gray-500 ml-2">{member.department || ''}</span>
          <span className="text-xs text-indigo-500 ml-2">
            EmpID: {member.staff_id || String(member.id)}
          </span>
          {member.position ? (
            <span className="text-xs text-gray-400 ml-2">{member.position}</span>
          ) : null}
          {member.level ? (
            <span className="text-xs text-purple-600 ml-2 font-medium">{member.level}</span>
          ) : null}
        </div>
        <div className="flex gap-1">
          <button className="btn-icon" onClick={openEdit} title="Edit">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
          </button>
          <button className="btn-icon danger" onClick={remove} title="Remove">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </div>
      {editing ? (
        <div className="px-3 pb-3 border-t border-gray-200 pt-2">
          <div className="grid grid-cols-2 gap-2 mb-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              className="input-field text-sm"
            />
            <input
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="Department"
              className="input-field text-sm"
            />
            <input
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              placeholder="Position (optional)"
              className="input-field text-sm"
            />
            <input
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              placeholder="Level (e.g. O3)"
              className="input-field text-sm"
            />
            <input
              value={jg}
              onChange={(e) => setJg(e.target.value)}
              placeholder="JG00"
              className="input-field text-sm"
            />
          </div>
          <p className="text-xs text-gray-400 mb-2">
            EmployeeID <strong>{member.staff_id || String(member.id)}</strong> cannot be changed.
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditing(false)} className="btn-secondary text-xs px-3">
              Cancel
            </button>
            <button onClick={save} className="btn-primary text-xs px-3">
              Save
            </button>
          </div>
        </div>
      ) : null}
    </li>
  )
}

export function MembersPanel() {
  const employeesQuery = useEmployees()
  const addEmployee = useAddEmployee()

  const [name, setName] = useState('')
  const [department, setDepartment] = useState('')
  const [staffId, setStaffId] = useState('')
  const [position, setPosition] = useState('')

  const add = () => {
    const trimmedName = name.trim()
    const trimmedStaffId = staffId.trim()
    if (!trimmedName) {
      toast('Name is required', 'error')
      return
    }
    if (!trimmedStaffId) {
      toast('Employee ID is required', 'error')
      return
    }
    if (!/^\d+$/.test(trimmedStaffId)) {
      toast('Employee ID must be a number', 'error')
      return
    }
    addEmployee.mutate(
      { name: trimmedName, department: department.trim(), staff_id: trimmedStaffId, position: position.trim() },
      {
        onSuccess: () => {
          setName('')
          setDepartment('')
          setStaffId('')
          setPosition('')
          toast('Member added')
        },
        onError: (e) => toast(errMsg(e, 'Create failed'), 'error'),
      },
    )
  }

  return (
    <div id="settings-panel-members" className="settings-panel card bg-white">
      <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">
        Team Members
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="input-field"
        />
        <input
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          placeholder="Department"
          className="input-field"
        />
        <input
          value={staffId}
          onChange={(e) => setStaffId(e.target.value)}
          placeholder="Employee ID *"
          inputMode="numeric"
          pattern="[0-9]*"
          className="input-field"
        />
        <input
          value={position}
          onChange={(e) => setPosition(e.target.value)}
          placeholder="Position (optional)"
          className="input-field"
        />
      </div>
      <button onClick={add} className="btn-primary text-sm px-3 mb-4">
        Add Member
      </button>
      <ul className="space-y-2">
        {(employeesQuery.data || []).map((m) => (
          <MemberRow key={m.id} member={m} />
        ))}
      </ul>
    </div>
  )
}
