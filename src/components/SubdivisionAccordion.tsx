import { useState } from 'react'
import type { Subdivision, TaskStatus, User } from '../types'
import { LineCard } from './LineCard'

interface Props {
  subdivision: Subdivision
  statuses: TaskStatus[]
  user: User
  onChangeStatus: (lineId: string, newStatusId: string, userId: string) => Promise<boolean>
  defaultOpen?: boolean
}

export function SubdivisionAccordion({ subdivision, statuses, user, onChangeStatus, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen)

  const activeLines = subdivision.lines.filter(l => l.is_active)

  // Count by status for summary badge
  const nonIdleCount = activeLines.filter(l => {
    const s = l.status
    return s && s.order_index > 0 && !s.is_terminal
  }).length

  const doneCount = activeLines.filter(l => l.status?.is_terminal).length

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Header — tap to toggle */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-3 sm:p-4 hover:bg-gray-50 active:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
            <span className="text-blue-600 font-bold text-sm">
              {subdivision.name[0]}
            </span>
          </div>
          <div className="text-left">
            <p className="font-bold text-gray-900">{subdivision.name}</p>
            <p className="text-xs text-gray-400">{activeLines.length} ліній</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {nonIdleCount > 0 && (
            <span className="text-xs bg-amber-100 text-amber-700 font-semibold px-2 py-0.5 rounded-full">
              {nonIdleCount} активних
            </span>
          )}
          {doneCount > 0 && (
            <span className="text-xs bg-green-100 text-green-700 font-semibold px-2 py-0.5 rounded-full">
              {doneCount} ✓
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

      {/* Lines grid */}
      {open && (
        <div className="border-t border-gray-50 p-2 sm:p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-3">
            {activeLines.map(line => (
              <LineCard
                key={line.id}
                line={line}
                statuses={statuses}
                user={user}
                onChangeStatus={onChangeStatus}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
