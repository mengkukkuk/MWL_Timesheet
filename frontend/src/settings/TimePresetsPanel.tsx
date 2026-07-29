// Time Presets panel (ported from static/app/settings.js's
// loadTimePresetsPanel/_renderPresetChips/addTimePreset/removeTimePreset).

import { useState } from 'react'
import { toast } from '../lib'
import type { TimePresetItem, TimePresets } from './types'
import { useSaveTimePresets, useTimePresets } from './useSettingsData'

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback
}

interface ChipListProps {
  kind: 'start' | 'end'
  items: TimePresetItem[]
  onAdd: (item: TimePresetItem) => void
  onRemove: (index: number) => void
}

function ChipList({ kind, items, onAdd, onRemove }: ChipListProps) {
  const [value, setValue] = useState('')
  const [label, setLabel] = useState('')

  const add = () => {
    const raw = value.trim()
    if (!raw) {
      toast('Select a time', 'error')
      return
    }
    const v = raw.substring(0, 5)
    onAdd({ label: label.trim() || v, value: v })
    setValue('')
    setLabel('')
  }

  return (
    <div>
      <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">
        {kind === 'start' ? 'Start Times' : 'End Times'}
      </h4>
      <div className="flex flex-wrap gap-2 mb-2" id={`preset-chips-${kind}`}>
        {items.map((p, i) => (
          <div
            key={`${p.value}-${i}`}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-medium border border-indigo-100"
          >
            <span>{p.label}</span>
            <button
              type="button"
              onClick={() => onRemove(i)}
              className="ml-1 text-indigo-300 hover:text-red-500 font-bold leading-none"
            >
              &times;
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="time"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="input-field text-sm"
        />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (optional)"
          className="input-field text-sm flex-1"
        />
        <button type="button" onClick={add} className="btn-primary text-xs px-3">
          Add
        </button>
      </div>
    </div>
  )
}

export function TimePresetsPanel() {
  const presetsQuery = useTimePresets()
  const savePresets = useSaveTimePresets()
  const data: TimePresets = presetsQuery.data || { start: [], end: [] }

  const save = (next: TimePresets) => {
    savePresets.mutate(next, {
      onSuccess: () => {
        // Still-vanilla Add/Edit Worklog modal caches presets on `window` —
        // bust that cache so its preset dropdown picks up the change.
        const invalidate = (window as unknown as { _invalidateTimePresetsCache?: () => void })
          ._invalidateTimePresetsCache
        if (typeof invalidate === 'function') invalidate()
      },
      onError: (e) => toast(errMsg(e, 'Failed to save preset'), 'error'),
    })
  }

  const addPreset = (kind: 'start' | 'end', item: TimePresetItem) => {
    save({ ...data, [kind]: [...(data[kind] || []), item] })
  }

  const removePreset = (kind: 'start' | 'end', index: number) => {
    save({ ...data, [kind]: (data[kind] || []).filter((_, i) => i !== index) })
  }

  return (
    <div id="settings-panel-time-presets" className="settings-panel card bg-white">
      <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">Time Presets</h3>
      <div className="space-y-4">
        <ChipList
          kind="start"
          items={data.start || []}
          onAdd={(item) => addPreset('start', item)}
          onRemove={(i) => removePreset('start', i)}
        />
        <ChipList
          kind="end"
          items={data.end || []}
          onAdd={(item) => addPreset('end', item)}
          onRemove={(i) => removePreset('end', i)}
        />
      </div>
    </div>
  )
}
