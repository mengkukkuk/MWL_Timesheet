import { t, toggleLang, useLang } from '../lib'
import type { MeResp } from '../lib'

export type TabName = 'dashboard' | 'worklog' | 'allowance' | 'files' | 'projects-summary' | 'settings'

interface NavProps {
  elevated: boolean
  user: MeResp | null
  pendingCount: number
  activeTab: TabName
  onNavigate: (tab: TabName) => void
}

interface TabDef {
  name: TabName
  labelKey: string
  elevatedOnly: boolean
}

const TABS: readonly TabDef[] = [
  { name: 'dashboard', labelKey: 'nav.dashboard', elevatedOnly: false },
  { name: 'worklog', labelKey: 'nav.worklog', elevatedOnly: false },
  { name: 'allowance', labelKey: 'nav.allowance', elevatedOnly: false },
  { name: 'files', labelKey: 'nav.files', elevatedOnly: false },
  { name: 'projects-summary', labelKey: 'nav.projects_summary', elevatedOnly: true },
  { name: 'settings', labelKey: 'nav.settings', elevatedOnly: true },
]

export function Nav({ elevated, user, pendingCount, activeTab, onNavigate }: NavProps) {
  const lang = useLang()
  const otherLang = lang === 'th' ? 'EN' : 'TH'

  return (
    <nav className="sticky top-0 z-50 bg-white shadow-sm border-b">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-4">
            <img src="/static/mwllogo.png" alt="MWL" className="h-8 w-auto" />
            <div className="hidden md:flex items-center gap-1">
              {TABS.filter((tab) => !tab.elevatedOnly || elevated).map((tab) => (
                <button
                  key={tab.name}
                  type="button"
                  onClick={() => onNavigate(tab.name)}
                  className={
                    'relative px-3 py-2 rounded-md text-sm font-medium transition-colors ' +
                    (activeTab === tab.name
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'text-gray-600 hover:bg-gray-100')
                  }
                >
                  {t(tab.labelKey)}
                  {tab.name === 'settings' && pendingCount > 0 && (
                    <span className="absolute -top-1 -right-1 inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-bold leading-none text-white bg-red-600 rounded-full">
                      {pendingCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => toggleLang()}
              className="px-2 py-1 text-sm font-medium text-gray-600 hover:text-gray-900 border border-gray-300 rounded-md"
            >
              {otherLang}
            </button>
            {user && <span className="hidden sm:inline text-sm text-gray-700">{user.username}</span>}
            <button
              type="button"
              onClick={() => {
                void fetch('/api/logout', { method: 'POST' }).then(() => {
                  window.location.href = '/login'
                })
              }}
              className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900"
            >
              {t('nav.logout')}
            </button>
          </div>
        </div>
        <div className="md:hidden flex items-center gap-1 overflow-x-auto pb-2">
          {TABS.filter((tab) => !tab.elevatedOnly || elevated).map((tab) => (
            <button
              key={tab.name}
              type="button"
              onClick={() => onNavigate(tab.name)}
              className={
                'relative whitespace-nowrap px-3 py-2 rounded-md text-sm font-medium ' +
                (activeTab === tab.name
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-gray-600 hover:bg-gray-100')
              }
            >
              {t(tab.labelKey)}
              {tab.name === 'settings' && pendingCount > 0 && (
                <span className="absolute top-0 right-0 inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-bold leading-none text-white bg-red-600 rounded-full">
                  {pendingCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </nav>
  )
}
