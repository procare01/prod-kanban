import { useState } from 'react'
import type { User, Event } from '../types'

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000)
  if (diff < 60) return 'щойно'
  if (diff < 3600) return `${Math.floor(diff / 60)} хв тому`
  if (diff < 86400) return `${Math.floor(diff / 3600)} год тому`
  return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
}

function parseEventDescription(description: string) {
  const match = description.match(/^(.*? змінив .*?:)\s*(.*?)\s*→\s*(.*?)\s*(?:\((через .*?)\))?$/)
  if (!match) return null

  return {
    header: match[1],
    fromStatus: match[2],
    toStatus: match[3],
    diff: match[4] ?? null,
  }
}

function isInvalidSameStatusEvent(event: Event): boolean {
  const parsed = parseEventDescription(event.description)
  if (!parsed) return false

  return parsed.fromStatus.trim() === parsed.toStatus.trim()
}

interface Props {
  user: User
  events: Event[]
  loading: boolean
  onDelete: (id: string) => void
  onClearAll: () => void
}

export function EventsList({ user, events, loading, onDelete, onClearAll }: Props) {
  const [open, setOpen] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const isAdmin = user.role === 'admin'
  const visibleEvents = events.filter(ev => !isInvalidSameStatusEvent(ev))

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-3 sm:p-4 hover:bg-gray-50 active:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center">
            <svg className="w-5 h-5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="text-left">
            <p className="font-bold text-gray-900">Останні події</p>
            {!open && visibleEvents.length > 0 && (
              <p className="text-xs text-gray-400 truncate max-w-[200px]">{visibleEvents[0].description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {visibleEvents.length > 0 && (
            <span className="text-xs bg-indigo-100 text-indigo-600 font-semibold px-2 py-0.5 rounded-full">
              {visibleEvents.length}
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
        <div className="border-t border-gray-50 p-3 sm:p-4">
          {/* Admin controls */}
          {isAdmin && visibleEvents.length > 0 && (
            <div className="flex justify-end mb-3">
              {confirmClear ? (
                <div className="flex items-center gap-3 flex-wrap justify-end">
                  <span className="text-sm text-gray-500">Видалити всі?</span>
                  <button
                    onClick={() => { onClearAll(); setConfirmClear(false) }}
                    className="min-w-14 px-4 py-2 rounded-xl bg-red-50 text-sm text-red-600 font-semibold hover:bg-red-100"
                  >
                    Так
                  </button>
                  <button
                    onClick={() => setConfirmClear(false)}
                    className="min-w-14 px-4 py-2 rounded-xl border border-gray-200 text-sm text-gray-500 font-medium hover:bg-gray-50"
                  >
                    Ні
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmClear(true)}
                  className="px-4 py-2 rounded-xl bg-red-50 text-sm text-red-500 font-semibold hover:bg-red-100 transition-colors"
                >
                  Очистити всі події
                </button>
              )}
            </div>
          )}

          {loading && <p className="text-sm text-gray-400 text-center py-4">Завантаження...</p>}

          {!loading && visibleEvents.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">Подій ще немає</p>
          )}

          <div className="space-y-1 max-h-64 overflow-y-auto">
            {visibleEvents.map(ev => (
              <div key={ev.id} className="flex items-start gap-2 py-1.5 group pr-1">
                <div className="flex-1 min-w-0">
                  {(() => {
                    const parsed = parseEventDescription(ev.description)
                    if (!parsed) {
                      return (
                        <>
                          <p className="text-sm text-gray-700 leading-snug">{ev.description}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{formatTime(ev.created_at)}</p>
                        </>
                      )
                    }

                    return (
                      <>
                        <p className="text-sm text-gray-700 leading-snug">{parsed.header}</p>
                        <p className="text-sm text-gray-700 leading-snug">{parsed.fromStatus} → {parsed.toStatus}</p>
                        {ev.comment && (
                          <p className="mt-1 text-xs text-gray-500">Коментар: {ev.comment}</p>
                        )}
                        <div className="flex items-center justify-between gap-3 mt-1">
                          <p className="text-xs text-gray-400">в {formatClock(ev.created_at)}</p>
                          {parsed.diff && <p className="text-xs text-gray-400">({parsed.diff})</p>}
                        </div>
                      </>
                    )
                  })()}
                </div>
                {isAdmin && (
                  <button
                    onClick={() => onDelete(ev.id)}
                    className="text-red-300 hover:text-red-500 transition-all text-base flex-shrink-0
                               w-6 h-6 flex items-center justify-center mt-0.5 sm:opacity-0 sm:group-hover:opacity-100"
                    title="Видалити подію"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
