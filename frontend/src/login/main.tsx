import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles.css'
import { LoginApp } from './LoginApp'

const el = document.getElementById('login-root')
if (el) {
  createRoot(el).render(
    <StrictMode>
      <LoginApp />
    </StrictMode>,
  )
}
