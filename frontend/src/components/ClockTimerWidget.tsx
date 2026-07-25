
// Signature login-panel instrument: a duty clock whose dial arc traces the
// actual configured workday (08:30–17:30), not a generic 12-hour face. Three
// modes share one dial: Live (current time), Log (stopwatch for a work
// session), Shift (elapsed % of the workday). A lockout state takes over the
// whole widget when the caller is throttling login attempts.
import { useEffect, useRef, useState } from "react"
import { Play, Pause, RotateCcw, Lock, Clock, Timer } from "lucide-react"

interface ClockTimerProps {
  lockoutSeconds?: number
}

type Tab = "live" | "timer" | "shift"

// Dial geometry: 0deg = 12 o'clock, increasing clockwise — matches the
// visual clock face directly, no extra rotation needed for ticks/arc.
const CX = 50
const CY = 50
const R = 44
const CIRCUMFERENCE = 2 * Math.PI * R

function polarToCartesian(angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180
  return { x: CX + R * Math.sin(rad), y: CY - R * Math.cos(rad) }
}

// Shift boundaries expressed as clock-face angles (hour/12 * 360).
const SHIFT_START_ANGLE = (8.5 / 12) * 360 // 08:30
const SHIFT_END_ANGLE = (17.5 / 12) * 360 - 360 // 17:30 folded onto a 12h face -> 165deg
const BOUNDARY_ANGLES = [SHIFT_START_ANGLE, 0, 30, SHIFT_END_ANGLE] // start, lunch, resume, close

function shiftArcPath(): string {
  const start = polarToCartesian(SHIFT_START_ANGLE)
  const end = polarToCartesian(SHIFT_END_ANGLE)
  return `M ${start.x} ${start.y} A ${R} ${R} 0 1 1 ${end.x} ${end.y}`
}

export function ClockTimerWidget({ lockoutSeconds = 0 }: ClockTimerProps) {
  const [now, setNow] = useState(new Date())
  const [activeTab, setActiveTab] = useState<Tab>("live")

  const [swRunning, setSwRunning] = useState(false)
  const [swTimeMs, setSwTimeMs] = useState(0)
  const swRef = useRef<number | null>(null)
  const lastTickRef = useRef(0)

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 50)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (lockoutSeconds > 0) setActiveTab("live")
  }, [lockoutSeconds])

  useEffect(() => {
    if (swRunning) {
      lastTickRef.current = performance.now()
      swRef.current = window.setInterval(() => {
        const delta = performance.now() - lastTickRef.current
        lastTickRef.current = performance.now()
        setSwTimeMs((prev) => prev + delta)
      }, 30)
    } else if (swRef.current) {
      clearInterval(swRef.current)
    }
    return () => {
      if (swRef.current) clearInterval(swRef.current)
    }
  }, [swRunning])

  const hours = now.getHours()
  const minutes = now.getMinutes()
  const seconds = now.getSeconds()
  const millis = now.getMilliseconds()

  const secDegree = ((seconds + millis / 1000) / 60) * 360
  const minDegree = ((minutes + seconds / 60) / 60) * 360
  const hourDegree = (((hours % 12) + minutes / 60) / 12) * 360

  const startOfDay = new Date(now)
  startOfDay.setHours(8, 30, 0, 0)
  const endOfDay = new Date(now)
  endOfDay.setHours(17, 30, 0, 0)
  const isOnShift = now >= startOfDay && now <= endOfDay

  const totalShiftMs = 9 * 3600 * 1000
  const elapsedShiftMs = Math.max(
    0,
    Math.min(totalShiftMs, now.getTime() - startOfDay.getTime()),
  )
  const shiftPercent = Math.min(100, Math.max(0, (elapsedShiftMs / totalShiftMs) * 100))

  const formatDigit = (n: number) => n.toString().padStart(2, "0")
  const formatTimeStr = (d: Date) =>
    `${formatDigit(d.getHours())}:${formatDigit(d.getMinutes())}:${formatDigit(d.getSeconds())}`
  const formatMsStr = (totalMs: number) => {
    const mins = Math.floor(totalMs / 60000)
    const secs = Math.floor((totalMs % 60000) / 1000)
    const cs = Math.floor((totalMs % 1000) / 10)
    return `${formatDigit(mins)}:${formatDigit(secs)}.${formatDigit(cs)}`
  }

  const maxLockout = useRef(lockoutSeconds || 300)
  useEffect(() => {
    if (lockoutSeconds > maxLockout.current) maxLockout.current = lockoutSeconds
  }, [lockoutSeconds])

  const isLocked = lockoutSeconds > 0
  const lockoutPercent = isLocked ? Math.min(100, (lockoutSeconds / maxLockout.current) * 100) : 0

  const ringDashOffset = isLocked
    ? (CIRCUMFERENCE * (100 - lockoutPercent)) / 100
    : CIRCUMFERENCE - (CIRCUMFERENCE * secDegree) / 360

  return (
    <div className="mwl-clock">
      <div className="mwl-clock__head">
        <div className="mwl-clock__title">
          <div className="mwl-clock__title-icon">
            {isLocked ? <Lock /> : <Clock />}
          </div>
          <div className="mwl-clock__title-text">
            <div className={isLocked ? "mwl-clock__eyebrow mwl-clock__eyebrow--locked" : "mwl-clock__eyebrow"}>
              {isLocked ? "Account locked" : "Duty clock"}
            </div>
            {!isLocked && <div className="mwl-clock__sub">08:30 – 17:30 shift</div>}
          </div>
        </div>

        {!isLocked && (
          <div className="mwl-clock__tabs" role="tablist" aria-label="Clock mode">
            {(["live", "timer", "shift"] as Tab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                onClick={() => setActiveTab(tab)}
                className={
                  activeTab === tab ? "mwl-clock__tab mwl-clock__tab--active" : "mwl-clock__tab"
                }
              >
                {tab === "live" ? "Live" : tab === "timer" ? "Log" : "Shift"}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mwl-clock__body">
        <div className="mwl-clock__dial" aria-hidden="true">
          <svg className="mwl-clock__face" viewBox="0 0 100 100">
            <path d={shiftArcPath()} className="mwl-clock__shift-arc" fill="none" strokeWidth={3} strokeLinecap="round" />
            {BOUNDARY_ANGLES.map((angle) => {
              const p = polarToCartesian(angle)
              return <circle key={angle} cx={p.x} cy={p.y} r={1.6} className="mwl-clock__tick" />
            })}
          </svg>
          <svg className="mwl-clock__face" viewBox="0 0 100 100" style={{ transform: "rotate(-90deg)" }}>
            <circle cx={CX} cy={CY} r={R} className="mwl-clock__face-bg" fill="none" strokeWidth={2} />
            <circle
              cx={CX}
              cy={CY}
              r={R}
              fill="none"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={ringDashOffset}
              className={isLocked ? "mwl-clock__ring mwl-clock__ring--lockout" : "mwl-clock__ring"}
            />
          </svg>

          {isLocked ? (
            <div className="mwl-clock__lock">
              <Lock />
              <span>LOCKED</span>
            </div>
          ) : (
            <>
              <div className="mwl-clock__hand mwl-clock__hand--hour" style={{ transform: `rotate(${hourDegree}deg)` }} />
              <div className="mwl-clock__hand mwl-clock__hand--min" style={{ transform: `rotate(${minDegree}deg)` }} />
              <div className="mwl-clock__hand mwl-clock__hand--sec" style={{ transform: `rotate(${secDegree}deg)` }} />
              <div className="mwl-clock__pin" />
            </>
          )}
        </div>

        <div className="mwl-clock__panel">
          {isLocked ? (
            <>
              <div className="mwl-clock__row">
                <span className="mwl-clock__label">Try again in</span>
              </div>
              <div className="mwl-clock__value mwl-clock__value--lock">
                {Math.floor(lockoutSeconds / 60)}m {formatDigit(lockoutSeconds % 60)}s
              </div>
              <p className="mwl-clock__lockmsg">
                Too many failed sign-in attempts. The lock clears on its own — no action needed.
              </p>
            </>
          ) : activeTab === "live" ? (
            <>
              <div className="mwl-clock__row">
                <span className="mwl-clock__label">Local time</span>
                <span className="mwl-clock__live-dot">
                  <span className="mwl-clock__dot mwl-clock__dot--pulse" />
                  {isOnShift ? "On shift" : "Off shift"}
                </span>
              </div>
              <div className="mwl-clock__value">
                <span>{formatTimeStr(now)}</span>
                <span className="mwl-clock__value-ms">.{formatDigit(Math.floor(millis / 10))}</span>
              </div>
              <div className="mwl-clock__meta">
                <span>
                  {now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                </span>
              </div>
            </>
          ) : activeTab === "timer" ? (
            <>
              <div className="mwl-clock__row">
                <span className="mwl-clock__label">Session log</span>
                <Timer size={13} color="var(--paper-50)" />
              </div>
              <div className="mwl-clock__value mwl-clock__value--accent">{formatMsStr(swTimeMs)}</div>
              <div className="mwl-clock__actions">
                <button
                  type="button"
                  onClick={() => setSwRunning((r) => !r)}
                  className={
                    swRunning
                      ? "mwl-clock__action mwl-clock__action--pause"
                      : "mwl-clock__action mwl-clock__action--primary"
                  }
                >
                  {swRunning ? <Pause size={12} /> : <Play size={12} />}
                  {swRunning ? "Pause" : "Start"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSwRunning(false)
                    setSwTimeMs(0)
                  }}
                  className="mwl-clock__action mwl-clock__action--ghost"
                  title="Reset"
                  aria-label="Reset session timer"
                >
                  <RotateCcw size={12} />
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="mwl-clock__row">
                <span className="mwl-clock__label">Workday</span>
                <span className="mwl-clock__value-ms" style={{ color: "var(--indigo-glow)", fontWeight: 600 }}>
                  {shiftPercent.toFixed(0)}%
                </span>
              </div>
              <div className="mwl-clock__bar">
                <div className="mwl-clock__bar-fill" style={{ width: `${shiftPercent}%` }} />
              </div>
              <div className="mwl-clock__bounds">
                <div>
                  <b>08:30</b>
                  <span>Start</span>
                </div>
                <div>
                  <b>17:30</b>
                  <span>Close</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}