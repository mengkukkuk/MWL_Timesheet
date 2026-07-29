// Storage usage card (ported from static/app/files.js loadFileStats): file /
// folder counts, cap meter, and low-space warnings.

import { fmtBytes } from './helpers'
import type { FileStats } from './types'

interface UsageCardProps {
  stats: FileStats | undefined
}

export function UsageCard({ stats }: UsageCardProps) {
  const capPct =
    stats && stats.cap_bytes > 0 ? Math.min(100, (stats.used_bytes / stats.cap_bytes) * 100) : 0

  let barColor = 'bg-indigo-500'
  if (capPct >= 95) barColor = 'bg-red-500'
  else if (capPct >= 80) barColor = 'bg-amber-500'

  const warnings: string[] = []
  if (stats) {
    if (stats.cap_bytes && stats.used_bytes >= stats.cap_bytes) {
      warnings.push('Storage cap reached — uploads blocked until files are deleted.')
    } else if (capPct >= 90) {
      warnings.push(`Storage ${capPct.toFixed(0)}% full — consider deleting old files.`)
    }
    if (stats.free_disk_bytes > 0 && stats.free_disk_bytes < stats.min_free_bytes) {
      warnings.push(`Server disk low: only ${fmtBytes(stats.free_disk_bytes)} free.`)
    }
  }

  return (
    <div id="file-usage-card" className="card bg-white mb-3 p-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="text-xs text-gray-500" id="file-stats-bar">
          {stats && (
            <>
              <span className="inline-flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 17v-2a4 4 0 014-4h4m-9-6h10M5 11h2m-2-6h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z"
                  />
                </svg>
                {stats.file_count} file{stats.file_count === 1 ? '' : 's'}
              </span>
              <span className="mx-1">·</span>
              <span>
                {stats.folder_count} folder{stats.folder_count === 1 ? '' : 's'}
              </span>
            </>
          )}
        </div>
        <div className="text-xs text-gray-500 text-right" id="file-usage-meta">
          {stats && (
            <span>
              {fmtBytes(stats.used_bytes)} <span className="text-gray-400">of</span>{' '}
              {fmtBytes(stats.cap_bytes)} cap
            </span>
          )}
        </div>
      </div>
      <div className="mt-2 h-2 bg-gray-100 rounded overflow-hidden">
        <div
          id="file-usage-bar"
          className={`h-full transition-all ${barColor}`}
          style={{ width: capPct.toFixed(1) + '%' }}
        />
      </div>
      {warnings.length > 0 && (
        <p id="file-usage-warning" className="text-xs text-red-600 mt-1.5">
          {warnings.join(' ')}
        </p>
      )}
    </div>
  )
}
