// React port of static/app/core.js's toast(msg, type='success') + the
// static #toast div in templates/app.html. lib.ts's toast() dispatches the
// 'mwl:toast' CustomEvent; this component is the sole listener/renderer,
// mounted once by AppShell. Same visuals: #dc2626 background for 'error',
// #1f2937 otherwise, auto-hide after 2500ms.
import { useEffect, useRef, useState } from 'react'

interface ToastDetail {
  msg: string
  type: 'success' | 'error'
}

export function ToastHost() {
  const [toast, setToast] = useState<ToastDetail | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function onToast(e: Event) {
      const detail = (e as CustomEvent<ToastDetail>).detail
      if (!detail) return
      setToast(detail)
      if (hideTimer.current) clearTimeout(hideTimer.current)
      hideTimer.current = setTimeout(() => setToast(null), 2500)
    }
    window.addEventListener('mwl:toast', onToast)
    return () => {
      window.removeEventListener('mwl:toast', onToast)
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
  }, [])

  if (!toast) return null

  return (
    <div
      id="toast"
      style={{
        position: 'fixed',
        bottom: '1.5rem',
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '0.75rem 1.25rem',
        borderRadius: '0.5rem',
        color: '#fff',
        fontSize: '0.875rem',
        fontWeight: 500,
        zIndex: 9999,
        boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
        background: toast.type === 'error' ? '#dc2626' : '#1f2937',
      }}
    >
      {toast.msg}
    </div>
  )
}
