// React login page — full parity with the retired vanilla templates/login.html,
// against the same untouched backend endpoints:
//   POST /api/login            (429 → lockout countdown; 403 pending/declined)
//   POST /api/register         (employee_id link; pending-approval result)
//   POST /api/reset-password   (username + staff_id + new password)
//   GET  /api/employee-lookup/<id>  (live preview, via useEmployeeLookup)
// Left brand panel carries the workday-clock signature; right panel is the
// disciplined auth card that switches between login / register / reset.
// Below 860px the brand panel is dropped entirely (see styles.css) — the form
// is the whole page, so narrow viewports never have to share their width.
import { useEffect, useRef, useState } from 'react'
import { Lock } from 'lucide-react'
import { api, t, toggleLang, currentLang } from '../lib'
import type { LoginResp } from '../lib'
//import { WorkdayTimeline } from './WorkdayTimeline'
import { useEmployeeLookup } from './useEmployeeLookup'
import {ClockTimerWidget} from "../components/ClockTimerWidget.tsx";

declare global {
  interface Window {
    // Optional vanilla-i18n helper injected by static/app/i18n.js when the
    // login page loads it; guarded with ?. so it is a no-op when absent.
    applyTranslations?: () => void
  }
}

type Mode = 'login' | 'register' | 'reset'
type Msg = { text: string; kind: 'err' | 'ok' } | null

const REMEMBER_KEY = 'login.remember.v1'

function loadRemembered(): string {
  try {
    const raw = localStorage.getItem(REMEMBER_KEY)
    if (!raw) return ''
    const obj = JSON.parse(raw)
    return obj && obj.username ? String(obj.username) : ''
  } catch {
    return ''
  }
}
function saveRemembered(username: string): void {
  try {
    localStorage.setItem(REMEMBER_KEY, JSON.stringify({ mode: 'username', username }))
  } catch {
    /* ignore */
  }
}
function clearRemembered(): void {
  try {
    localStorage.removeItem(REMEMBER_KEY)
  } catch {
    /* ignore */
  }
}

export function LoginApp() {
  const [mode, setMode] = useState<Mode>('login')
  const [msg, setMsg] = useState<Msg>(null)
  const [, forceLang] = useState(0)

  useEffect(() => {
    const onLang = () => {
      forceLang((n) => n + 1)
      window.applyTranslations?.()
    }
    window.addEventListener('mwl:langchange', onLang)
    return () => window.removeEventListener('mwl:langchange', onLang)
  }, [])

  const switchMode = (m: Mode) => {
    setMode(m)
    setMsg(null)
  }

  return (
    <div className="mwl-login">
      <section className="mwl-brand">
        <button
          className="mwl-langtoggle"
          onClick={toggleLang}
          aria-label="Toggle language"
        >
          {currentLang() === 'en' ? 'TH' : 'EN'}
        </button>

        <div className="mwl-brand__hero">
          <div className="mwl-brand__logo">
            <img className="mwl-brand__logo-mark" src="/static/mwllogo.png" alt="" />
            <span>MeterWorklog</span>
          </div>
          <h1 className="mwl-brand__headline">
            Every hour, <em>accounted for.</em>
          </h1>
          <p className="mwl-brand__sub">
            Log the workday against its real boundaries — start, lunch, and the
            8-hour close.
          </p>
          <ClockTimerWidget />
        </div>

        <div className="mwl-brand__footnote">{t('login.title')}</div>
      </section>

      <section className="mwl-auth">
        <button
          type="button"
          className="mwl-login__langtoggle-mobile"
          onClick={toggleLang}
          aria-label="Toggle language"
        >
          {currentLang() === 'en' ? 'TH' : 'EN'}
        </button>
        <div className="mwl-auth__card">
          {mode === 'login' && (
            <LoginForm onMsg={setMsg} msg={msg} onSwitch={switchMode} />
          )}
          {mode === 'register' && (
            <RegisterForm onMsg={setMsg} msg={msg} onSwitch={switchMode} />
          )}
          {mode === 'reset' && (
            <ResetForm onMsg={setMsg} msg={msg} onSwitch={switchMode} />
          )}
        </div>
      </section>
    </div>
  )
}

interface FormProps {
  onMsg: (m: Msg) => void
  msg: Msg
  onSwitch: (m: Mode) => void
}

function MessageBox({ msg }: { msg: Msg }) {
  if (!msg) return null
  return <div className={`mwl-msg mwl-msg--${msg.kind}`}>{msg.text}</div>
}

function LoginForm({ onMsg, msg, onSwitch }: FormProps) {
  const [username, setUsername] = useState(loadRemembered())
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(() => loadRemembered() !== '')
  const [busy, setBusy] = useState(false)
  const [lockLeft, setLockLeft] = useState(0)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [])

  const startLockout = (seconds: number) => {
    setLockLeft(seconds)
    if (timerRef.current) window.clearInterval(timerRef.current)
    timerRef.current = window.setInterval(() => {
      setLockLeft((s) => {
        if (s <= 1) {
          if (timerRef.current) window.clearInterval(timerRef.current)
          timerRef.current = null
          onMsg(null)
          return 0
        }
        return s - 1
      })
    }, 1000)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (lockLeft > 0) return
    setBusy(true)
    onMsg(null)
    const res = await api<LoginResp>('/api/login', {
      json: { username: username.trim(), password },
    })
    setBusy(false)
    if (res.ok) {
      if (remember) saveRemembered(username.trim())
      else clearRemembered()
      window.location.href = '/'
      return
    }
    if (res.status === 429) {
      startLockout(res.data?.locked_for_seconds || 300)
      return
    }
    if (res.status === 403 && res.error === 'pending_approval') {
      onMsg({ text: t('login.pending_approval'), kind: 'err' })
      return
    }
    if (res.status === 403 && res.error === 'declined') {
      onMsg({ text: t('login.declined'), kind: 'err' })
      return
    }
    onMsg({ text: res.error || 'Login failed', kind: 'err' })
  }

  const locked = lockLeft > 0
  const lockLabel = () => {
    const m = Math.floor(lockLeft / 60)
    const s = lockLeft % 60
    return m > 0 ? `${m}m ${s}s` : `${s}s`
  }

  return (
    <form onSubmit={submit}>
      <div className="mwl-auth__head">
        <h2 className="mwl-auth__title">{t('login.sign_in')}</h2>
        <p className="mwl-auth__hint">{t('login.title')}</p>
      </div>
      {locked ? (
        <div className="mwl-msg mwl-msg--err mwl-msg--lock">
          <Lock size={15} />
          <span>
            Too many failed attempts. Try again in {lockLabel()} {'\u2014'} it clears on its own.
          </span>
        </div>
      ) : (
        <MessageBox msg={msg} />
      )}
      <div className="mwl-field">
        <label className="mwl-label" htmlFor="login-username">
          {t('login.username')}
        </label>
        <input
          id="login-username"
          className="mwl-input"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
      </div>
      <div className="mwl-field">
        <label className="mwl-label" htmlFor="login-password">
          {t('login.password')}
        </label>
        <input
          id="login-password"
          className="mwl-input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <label className="mwl-check">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
        />
        <span>{t('login.remember')}</span>
      </label>
      <div className="mwl-auth__submitbar">
        <button className="mwl-btn" type="submit" disabled={busy || locked}>
          {locked
            ? `Locked (${lockLabel()})`
            : busy
              ? t('login.signing_in')
              : t('login.login_btn')}
        </button>
      </div>
      <div className="mwl-linkrow">
        <button type="button" className="mwl-link" onClick={() => onSwitch('register')}>
          {t('login.create_link')}
        </button>
        <button type="button" className="mwl-link" onClick={() => onSwitch('reset')}>
          {t('login.forgot_pw')}
        </button>
      </div>
    </form>
  )
}

function RegisterForm({ onMsg, msg, onSwitch }: FormProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [empId, setEmpId] = useState('')
  const [busy, setBusy] = useState(false)
  const lookup = useEmployeeLookup(empId)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== password2) {
      onMsg({ text: t('login.pw_mismatch'), kind: 'err' })
      return
    }
    if (!/^\d+$/.test(empId.trim())) {
      onMsg({ text: 'Employee ID must be a number', kind: 'err' })
      return
    }
    if (lookup.status === 'taken') {
      onMsg({ text: 'This Employee ID is already linked to an account', kind: 'err' })
      return
    }
    setBusy(true)
    onMsg(null)
    const res = await api<{ pending?: boolean }>('/api/register', {
      json: { username: username.trim(), password, employee_id: empId.trim() },
    })
    setBusy(false)
    if (res.ok) {
      onSwitch('login')
      onMsg({
        text: res.data?.pending
          ? t('login.pending_approval_after_register')
          : t('login.account_created'),
        kind: 'ok',
      })
      return
    }
    onMsg({ text: res.error || 'Registration failed', kind: 'err' })
  }

  return (
    <form onSubmit={submit}>
      <div className="mwl-auth__head">
        <h2 className="mwl-auth__title">{t('login.create_title')}</h2>
      </div>
      <MessageBox msg={msg} />
      <div className="mwl-field">
        <label className="mwl-label" htmlFor="register-username">
          {t('login.username')}
        </label>
        <input
          id="register-username"
          className="mwl-input"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
      </div>
      <div className="mwl-field">
        <label className="mwl-label" htmlFor="register-password">
          {t('login.password')}
        </label>
        <input
          id="register-password"
          className="mwl-input"
          type="password"
          autoComplete="new-password"
          minLength={8}
          placeholder="Min. 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <div className="mwl-field">
        <label className="mwl-label" htmlFor="register-password2">
          {t('login.confirm_password')}
        </label>
        <input
          id="register-password2"
          className="mwl-input"
          type="password"
          autoComplete="new-password"
          value={password2}
          onChange={(e) => setPassword2(e.target.value)}
          required
        />
      </div>
      <div className="mwl-field">
        <label className="mwl-label" htmlFor="register-empid">
          {t('login.employee_id')}
        </label>
        <input
          id="register-empid"
          className="mwl-input mwl-input--mono"
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder="12345"
          autoComplete="off"
          value={empId}
          onChange={(e) => setEmpId(e.target.value)}
          required
        />
        <EmployeeStatus lookup={lookup} />
      </div>
      <div className="mwl-auth__submitbar">
        <button className="mwl-btn" type="submit" disabled={busy}>
          {busy ? t('login.creating') : t('login.create_link')}
        </button>
      </div>
      <div className="mwl-linkrow" style={{ justifyContent: 'center' }}>
        <span style={{ color: 'var(--ink-50)' }}>
          {t('login.have_account')}{' '}
          <button type="button" className="mwl-link" onClick={() => onSwitch('login')}>
            {t('login.sign_in_link')}
          </button>
        </span>
      </div>
    </form>
  )
}

function EmployeeStatus({ lookup }: { lookup: ReturnType<typeof useEmployeeLookup> }) {
  const { status, record } = lookup
  const line = (text: string, kind: 'ok' | 'warn' | 'err') => (
    <p className={`mwl-status mwl-status--${kind}`} style={{ marginTop: '0.5rem' }}>
      {text}
    </p>
  )
  return (
    <>
      {status === 'looking' && (
        <p className="mwl-status" style={{ marginTop: '0.5rem', color: 'var(--ink-50)' }}>
          Looking up…
        </p>
      )}
      {status === 'invalid' && line('Employee ID must be a number', 'err')}
      {status === 'notfound' && line('No employee with that ID — contact HR', 'err')}
      {status === 'error' && line('Lookup failed', 'err')}
      {status === 'taken' && line('This Employee ID is already linked to an account', 'warn')}
      {status === 'ok' && line('Verified', 'ok')}
      {record && (status === 'ok' || status === 'taken') && (
        <div className="mwl-preview">
          <div
            style={{
              fontSize: '0.7rem',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--ink-30)',
              marginBottom: '0.3rem',
            }}
          >
            {t('login.emp_record_label')}
          </div>
          <div style={{ fontWeight: 600, color: 'var(--ink-90)' }}>{record.name || '—'}</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--ink-50)' }}>
            {record.department || '—'}
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--ink-50)' }}>
            {record.position || '—'}
          </div>
        </div>
      )}
    </>
  )
}

function ResetForm({ onMsg, msg, onSwitch }: FormProps) {
  const [username, setUsername] = useState('')
  const [staffId, setStaffId] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== password2) {
      onMsg({ text: t('login.pw_mismatch'), kind: 'err' })
      return
    }
    setBusy(true)
    onMsg(null)
    const res = await api('/api/reset-password', {
      json: { username: username.trim(), staff_id: staffId.trim(), password },
    })
    setBusy(false)
    if (res.ok) {
      onSwitch('login')
      onMsg({ text: t('login.reset_success'), kind: 'ok' })
      return
    }
    if (res.error === 'no_staff_id') {
      onMsg({ text: t('login.no_staff_id'), kind: 'err' })
      return
    }
    onMsg({ text: res.error || 'Reset failed', kind: 'err' })
  }

  return (
    <form onSubmit={submit}>
      <div className="mwl-auth__head">
        <h2 className="mwl-auth__title">{t('login.reset_title')}</h2>
        <p className="mwl-auth__hint">{t('login.reset_desc')}</p>
      </div>
      <MessageBox msg={msg} />
      <div className="mwl-field">
        <label className="mwl-label" htmlFor="reset-username">
          {t('login.username')}
        </label>
        <input
          id="reset-username"
          className="mwl-input"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
      </div>
      <div className="mwl-field">
        <label className="mwl-label" htmlFor="reset-staffid">
          Staff ID
        </label>
        <input
          id="reset-staffid"
          className="mwl-input mwl-input--mono"
          placeholder="e.g. EMP-001"
          value={staffId}
          onChange={(e) => setStaffId(e.target.value)}
          required
        />
      </div>
      <div className="mwl-field">
        <label className="mwl-label" htmlFor="reset-password">
          {t('login.password')}
        </label>
        <input
          id="reset-password"
          className="mwl-input"
          type="password"
          autoComplete="new-password"
          minLength={8}
          placeholder="Min. 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <div className="mwl-field">
        <label className="mwl-label" htmlFor="reset-password2">
          {t('login.confirm_password')}
        </label>
        <input
          id="reset-password2"
          className="mwl-input"
          type="password"
          autoComplete="new-password"
          value={password2}
          onChange={(e) => setPassword2(e.target.value)}
          required
        />
      </div>
      <div className="mwl-auth__submitbar">
        <button className="mwl-btn" type="submit" disabled={busy}>
          {busy ? t('login.resetting') : t('login.reset_btn')}
        </button>
      </div>
      <div className="mwl-linkrow" style={{ justifyContent: 'center' }}>
        <button type="button" className="mwl-link" onClick={() => onSwitch('login')}>
          {t('login.sign_in_link')}
        </button>
      </div>
    </form>
  )
}
