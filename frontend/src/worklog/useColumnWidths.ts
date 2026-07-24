// Column-width state for the resizable worklog table, persisted to
// localStorage so a user's preferred layout survives reloads/navigation.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

const STORAGE_KEY = 'mwl.worklog.colw'

export interface ColumnDef {
  key: string
  min: number
  default: number
}

interface DragState {
  key: string
  startX: number
  startWidth: number
}

function loadSaved(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {}
  } catch {
    return {}
  }
}

export function useColumnWidths(columns: ColumnDef[]) {
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    const saved = loadSaved()
    const initial: Record<string, number> = {}
    columns.forEach((c) => {
      const v = saved[c.key]
      initial[c.key] = typeof v === 'number' && v >= c.min ? v : c.default
    })
    return initial
  })

  const dragRef = useRef<DragState | null>(null)
  const columnsRef = useRef(columns)
  columnsRef.current = columns

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const drag = dragRef.current
      if (!drag) return
      const col = columnsRef.current.find((c) => c.key === drag.key)
      const min = col?.min ?? 60
      const next = Math.max(min, drag.startWidth + (e.clientX - drag.startX))
      setWidths((w) => ({ ...w, [drag.key]: next }))
    }
    function onUp() {
      if (!dragRef.current) return
      dragRef.current = null
      document.body.classList.remove('wl-resizing')
      setWidths((w) => {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(w))
        } catch {
          /* storage unavailable — widths just won't persist */
        }
        return w
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  const startResize = useCallback(
    (key: string) => (e: ReactPointerEvent<HTMLSpanElement>) => {
      e.preventDefault()
      dragRef.current = { key, startX: e.clientX, startWidth: widths[key] ?? 100 }
      document.body.classList.add('wl-resizing')
    },
    [widths],
  )

  return { widths, startResize }
}