import { useState } from 'react'
import type { Subdivision, TaskStatus } from '../types'

interface Props {
  subdivisions: Subdivision[]
  statuses: TaskStatus[]
}

export function SummaryCard({ subdivisions, statuses }: Props) {
  const [open, setOpen] = useState(false)

  const allLines = subdivisions.flatMap(s => s.lines.filter(l => l.is_active))

  const inProgress = allLines.filter(l => {
    const s = l.status
    return s && s.order_index > 0 && !s.is_terminal
  })

  const stopped = allLines.filter(l => {
    const s = l.status
    return s && s.name === 'Зупинка'
  })

  const done = allLines.filter(l => l.status?.is_terminal)

  const getStatusColor = (statusName: string) =>
    statuses.find(s => s.name === statusName)?.color || '#6B7280'

  const statusPriority = (statusName?: string) => {
    switch (statusName) {
      case 'Завершено':
        return 0
      case 'Зупинка':
        return 1
      case 'Фасування':
        return 2
      default:
        return 3
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-50 active:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
            <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <p className="font-bold text-gray-900">В роботі</p>
        </div>

        <div className="flex items-center gap-2">
          {inProgress.length > 0 && (
            <span className="text-xs bg-amber-100 text-amber-700 font-semibold px-2 py-0.5 rounded-full">
              {inProgress.length}
            </span>
          )}
          {stopped.length > 0 && (
            <span className="text-xs bg-red-100 text-red-600 font-semibold px-2 py-0.5 rounded-full">
              ⏸ {stopped.length}
            </span>
          )}
          {done.length > 0 && (
            <span className="text-xs bg-green-100 text-green-700 font-semibold px-2 py-0.5 rounded-full">
              ✓ {done.length}
            </span>
          )}
          <span
            className="text-gray-400 text-lg sm:text-xl font-semibold transition-transform duration-200 ml-1"
            style={{ transform: open ? 'rotate(180deg)' : 'none', display: 'inline-block' }}
          >
            ▾
          </span>
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-50 p-4">
          {allLines.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-2">Ліній немає</p>
          )}

          <div className="space-y-2">
            {allLines
              .filter(l => l.status && l.status.order_index > 0)
              .sort((a, b) => {
                const byStatus = statusPriority(a.status?.name) - statusPriority(b.status?.name)
                if (byStatus !== 0) return byStatus
                return a.name.localeCompare(b.name, 'uk-UA')
              })
              .map(line => (
                <div key={line.id} className="flex items-center justify-between gap-3 py-1">
                  <span className="text-sm text-gray-700 font-medium">{line.name}</span>
                  {line.status && (
                    <span
                      className="text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0"
                      style={{
                        backgroundColor: line.status.color + '20',
                        color: line.status.color,
                      }}
                    >
                      {line.status.name}
                    </span>
                  )}
                </div>
              ))
            }
            {allLines.filter(l => l.status && l.status.order_index > 0).length === 0 && (
              <p className="text-sm text-gray-400 text-center py-2">Всі лінії у початковому статусі</p>
            )}
          </div>

          {/* Quick stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-4 mt-4 pt-4 border-t border-gray-50">
            {statuses.map(s => {
              const count = allLines.filter(l => l.status?.id === s.id).length
              return (
                <div key={s.id} className="text-center min-h-[124px] flex flex-col items-center justify-center">
                  <p className="text-5xl font-bold" style={{ color: s.color }}>{count}</p>
                  <p className="text-2xl text-gray-400 mt-2 leading-tight">{s.name}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
