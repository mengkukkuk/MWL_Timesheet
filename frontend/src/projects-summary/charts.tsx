// Bar + donut charts for the Projects Summary tab. Ports _psRenderBarChart /
// _psRenderDonutChart from static/app/projects-summary.js verbatim (same colors,
// options, animations) so the migrated tab is a zero-visual-diff change.
//
// Chart.js is NOT bundled — it's the CDN UMD global (window.Chart) lazily loaded
// by loadChartJs() (frontend/src/lib/loadChartJs.ts), so charts stay off the
// critical path and we don't add ~70 KB to the island bundle.
import { useEffect, useRef } from 'react'
import { PS_COLORS, type ProjectSummaryRow } from './types'
import { loadChartJs } from '../lib/loadChartJs'

interface ChartInstance {
  destroy(): void
}
type ChartCtor = new (canvas: HTMLCanvasElement, config: unknown) => ChartInstance

interface TooltipCtx {
  dataIndex: number
  raw: number
}

function useChart(
  build: (Chart: ChartCtor, canvas: HTMLCanvasElement) => ChartInstance,
  deps: unknown[],
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    let chart: ChartInstance | null = null
    let cancelled = false
    const canvas = canvasRef.current
    if (!canvas) return
    loadChartJs().then(() => {
      if (cancelled || !window.Chart || !canvasRef.current) return
      chart = build(window.Chart, canvasRef.current)
    })
    return () => {
      cancelled = true
      if (chart) chart.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return canvasRef
}

export function BarChart({ projects }: { projects: ProjectSummaryRow[] }) {
  const chartH = Math.min(Math.max(180, projects.length * 44 + 60), 480)
  const canvasRef = useChart(
    (Chart, canvas) => {
      const labels = projects.map((p) => p.project_department)
      const values = projects.map((p) => p.total_hours)
      const colors = projects.map((_, i) => PS_COLORS[i % PS_COLORS.length])
      return new Chart(canvas, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              data: values,
              backgroundColor: colors.map((c) => c + '28'),
              borderColor: colors,
              borderWidth: 2,
              borderRadius: 6,
              borderSkipped: false,
            },
          ],
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 600, easing: 'easeOutQuart' },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#1e293b',
              titleColor: '#94a3b8',
              bodyColor: '#f1f5f9',
              padding: 10,
              cornerRadius: 8,
              callbacks: {
                title: (ctx: TooltipCtx[]) => {
                  const proj = projects[ctx[0].dataIndex]
                  return proj.project_description || proj.project_department
                },
                label: (ctx: TooltipCtx) => `  ${ctx.raw.toFixed(1)} hours`,
              },
            },
          },
          scales: {
            x: {
              beginAtZero: true,
              grid: { color: '#f1f5f9', drawBorder: false },
              border: { display: false },
              ticks: { font: { size: 11 }, color: '#94a3b8', callback: (v: number) => v + 'h' },
            },
            y: {
              grid: { display: false, drawBorder: false },
              border: { display: false },
              ticks: {
                font: { size: 12, weight: '500' },
                color: '#374151',
                maxRotation: 0,
                callback: function (this: { getLabelForValue(v: number): string }, val: number) {
                  const lbl = this.getLabelForValue(val)
                  return lbl.length > 24 ? lbl.slice(0, 22) + '…' : lbl
                },
              },
            },
          },
        },
      })
    },
    [projects],
  )

  return (
    <div id="ps-bar-wrap" style={{ position: 'relative', height: `${chartH}px` }}>
      <canvas ref={canvasRef} id="ps-bar-canvas" />
    </div>
  )
}

interface DonutItem {
  project_department: string
  project_description?: string
  total_hours: number
}

function donutItems(projects: ProjectSummaryRow[]): DonutItem[] {
  const TOP_N = 8
  if (projects.length <= TOP_N) return projects
  const othersH = projects.slice(TOP_N).reduce((s, p) => s + p.total_hours, 0)
  return [...projects.slice(0, TOP_N), { project_department: 'Others', total_hours: othersH }]
}

export function DonutChart({ projects, totalHours }: { projects: ProjectSummaryRow[]; totalHours: number }) {
  const items = donutItems(projects)
  const colors = items.map((_, i) => PS_COLORS[i % PS_COLORS.length])

  const canvasRef = useChart(
    (Chart, canvas) => {
      return new Chart(canvas, {
        type: 'doughnut',
        data: {
          labels: items.map((p) => p.project_department),
          datasets: [
            {
              data: items.map((p) => p.total_hours),
              backgroundColor: colors,
              borderColor: '#fff',
              borderWidth: 3,
              hoverBorderWidth: 2,
              hoverOffset: 8,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '70%',
          animation: { duration: 700, easing: 'easeOutQuart' },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#1e293b',
              titleColor: '#94a3b8',
              bodyColor: '#f1f5f9',
              padding: 10,
              cornerRadius: 8,
              callbacks: {
                title: (ctx: TooltipCtx[]) => {
                  const item = items[ctx[0].dataIndex]
                  return item.project_description || item.project_department
                },
                label: (ctx: TooltipCtx) => {
                  const pct = totalHours > 0 ? ((ctx.raw / totalHours) * 100).toFixed(1) : '0.0'
                  return `  ${ctx.raw.toFixed(1)}h  (${pct}%)`
                },
              },
            },
          },
        },
      })
    },
    [projects, totalHours],
  )

  return (
    <>
      <div style={{ position: 'relative', height: '210px' }}>
        <canvas ref={canvasRef} id="ps-donut-canvas" />
      </div>
      <div id="ps-legend" className="ps-legend mt-4" style={{ maxHeight: '160px', overflowY: 'auto' }}>
        {items.map((p, i) => {
          const pct = totalHours > 0 ? ((p.total_hours / totalHours) * 100).toFixed(1) : '0.0'
          return (
            <div className="ps-legend-item" key={p.project_department + i} title={p.project_description || ''}>
              <span className="ps-legend-swatch" style={{ background: colors[i] }} />
              <span className="ps-legend-name">{p.project_department}</span>
              <span className="ps-legend-pct">{pct}%</span>
            </div>
          )
        })}
      </div>
    </>
  )
}
