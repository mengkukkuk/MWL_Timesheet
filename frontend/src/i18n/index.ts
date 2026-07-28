// React-side i18n runtime backed by dict.ts. Independent of
// static/app/i18n.js's window.t()/toggleLang() globals — this is the new
// source of truth for React components. Consumed tab-by-tab as each tab
// migrates off the vanilla `data-i18n` attribute system (see plan PR10).
import { dict, type Lang, type DictKey } from './dict'

const LANG_STORAGE_KEY = 'appLang'

function readStoredLang(): Lang {
  try {
    const s = localStorage.getItem(LANG_STORAGE_KEY)
    return s === 'th' || s === 'en' ? s : 'en'
  } catch {
    return 'en'
  }
}

let currentLangValue: Lang = readStoredLang()
const listeners = new Set<() => void>()

export function currentLang(): Lang {
  return currentLangValue
}

export function onLangChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function t(key: DictKey, ...args: unknown[]): string {
  const table = dict[currentLangValue] ?? dict.en
  const val = (table as Record<string, unknown>)[key] ?? (dict.en as Record<string, unknown>)[key] ?? key
  return typeof val === 'function' ? (val as (...a: unknown[]) => string)(...args) : String(val)
}

export function setLang(lang: Lang): void {
  currentLangValue = lang
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang)
  } catch {
    /* ignore */
  }
  listeners.forEach((listener) => listener())
}

export function toggleLang(): void {
  setLang(currentLangValue === 'en' ? 'th' : 'en')
}

export type { Lang, DictKey }
