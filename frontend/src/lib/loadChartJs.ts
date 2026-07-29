// Lazy-loads Chart.js (~70 KB gz) from the CDN only when a chart-using view
// is opened, so it stays off the critical path. Ported verbatim from
// static/app/core.js's loadChartJs() (deleted in the full-teardown PR) —
// same UMD CDN URL, same cached-promise behavior.
declare global {
  interface Window {
    Chart?: new (canvas: HTMLCanvasElement, config: unknown) => { destroy(): void }
  }
}

let chartJsPromise: Promise<void> | null = null

export function loadChartJs(): Promise<void> {
  if (chartJsPromise) return chartJsPromise
  if (typeof window.Chart !== 'undefined') {
    chartJsPromise = Promise.resolve()
    return chartJsPromise
  }
  chartJsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js'
    s.async = false
    s.onload = () => resolve()
    s.onerror = () => {
      chartJsPromise = null
      reject(new Error('Failed to load Chart.js'))
    }
    document.head.appendChild(s)
  })
  return chartJsPromise
}
