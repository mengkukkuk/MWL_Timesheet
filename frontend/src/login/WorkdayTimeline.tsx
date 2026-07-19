// Signature element: an ambient "workday timeline" on the login brand panel.
// Faint vertical rail of DM-Mono time ticks at the app's REAL workday
// boundaries (08:30 start · 12:00–13:00 lunch · 17:30 end) with a soft indigo
// glow sweeping top→bottom, plus an hours counter easing up to 8.0.
// Domain-specific, not generic particles. Honors prefers-reduced-motion: the
// counter snaps to 8.0 and the sweep is frozen by CSS.
import { useEffect, useState } from 'react'
import { t } from '../lib'

interface Tick {
  time: string
  labelKey: string
  fallback: string
}

const TICKS: Tick[] = [
  { time: '08:30', labelKey: 'login.tl_start', fallback: 'Start' },
  { time: '12:00', labelKey: 'login.tl_lunch', fallback: 'Lunch' },
  { time: '13:00', labelKey: 'login.tl_resume', fallback: 'Resume' },
  { time: '17:30', labelKey: 'login.tl_end', fallback: 'End' },
]

const TARGET_HOURS = 8

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  )
}

export function WorkdayTimeline() {
  const [hours, setHours] = useState(prefersReducedMotion() ? TARGET_HOURS : 0)

  useEffect(() => {
    if (prefersReducedMotion()) return
    const duration = 1600
    const start = performance.now()
    let raf = 0
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration)
      // easeOutCubic
      const eased = 1 - Math.pow(1 - p, 3)
      setHours(eased * TARGET_HOURS)
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="mwl-timeline" aria-hidden="true">
      <div className="mwl-timeline__rail" />
      <div className="mwl-timeline__sweep" />
      {TICKS.map((tick) => {
        const label = t(tick.labelKey)
        return (
          <div className="mwl-tick" key={tick.time}>
            <span className="mwl-tick__time">{tick.time}</span>
            <span className="mwl-tick__label">
              {label === tick.labelKey ? tick.fallback : label}
            </span>
          </div>
        )
      })}
      <div className="mwl-timeline__total">
        <span className="mwl-timeline__total-num">{hours.toFixed(1)}</span>
        <span className="mwl-timeline__total-label">hrs / day</span>
      </div>
    </div>
  )
}
