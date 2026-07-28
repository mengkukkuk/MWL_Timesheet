import { useEffect } from 'react'

declare global {
  interface Window {
    showTab?: (name: string) => void | Promise<void>
    __mwlCoreReady?: boolean
  }
}

interface LegacyRouteProps {
  tab: string
}

// Bridges a react-router path to the vanilla shell's existing showTab(name)
// tab-switcher (static/app/core.js). Renders nothing — the actual tab
// content lives in the vanilla #view-<tab> DOM outside #root. See PR1 in
// purring-weaving-pillow.md: routing becomes real here; each tab's
// *internals* still migrate to React one PR at a time (PR2-PR9).
//
// __mwlCoreReady guards against calling showTab before core.js's own
// initializeApp() has fetched /api/me + members/projects. Without the
// guard, a cold load could have the router (which mounts fast, no network
// wait in its own loader) call showTab() before currentUser/members exist,
// flashing a "no member selected" state that initializeApp()'s own
// (idempotent) showTab call would immediately overwrite anyway — simpler to
// just defer to it once on cold load. Every subsequent navigation (nav
// clicks via mwlNavigate) runs after core.js is ready, so this only affects
// the very first paint.
export function LegacyRoute({ tab }: LegacyRouteProps) {
  useEffect(() => {
    if (!window.__mwlCoreReady) return
    window.showTab?.(tab)
  }, [tab])

  return null
}
