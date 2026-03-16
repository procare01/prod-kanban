import { useState, useEffect, useCallback } from 'react'
import type { CSSProperties } from 'react'
import type { Line, TaskStatus, User } from '../types'
import { StatusChangeModal } from './StatusChangeModal'
import { useLineHistory } from '../hooks/useBoard'

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000)
  if (diff < 60) return 'щойно'
  if (diff < 3600) return `${Math.floor(diff / 60)} хв тому`
  if (diff < 86400) return `${Math.floor(diff / 3600)} год тому`
  return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })
}

function formatDuration(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null
  if (seconds < 60) return `${seconds} сек`

  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (days > 0) {
    return hours > 0 ? `${days} дн ${hours} год` : `${days} дн`
  }

  if (hours > 0) {
    return minutes > 0 ? `${hours} год ${minutes} хв` : `${hours} год`
  }

  return `${minutes} хв`
}

function getHistoryDiffSeconds(createdAt: string, previousCreatedAt?: string, storedSeconds?: number | null): number | null {
  if (storedSeconds !== null && storedSeconds !== undefined) return storedSeconds
  if (!previousCreatedAt) return null
  const currentDate = new Date(createdAt)
  const previousDate = new Date(previousCreatedAt)
  if (currentDate.toDateString() !== previousDate.toDateString()) return null
  const current = currentDate.getTime()
  const previous = previousDate.getTime()
  if (Number.isNaN(current) || Number.isNaN(previous) || current <= previous) return null
  return Math.floor((current - previous) / 1000)
}

interface Props {
  line: Line
  statuses: TaskStatus[]
  user: User
  onChangeStatus: (lineId: string, newStatusId: string, userId: string, comment?: string) => Promise<boolean>
}

export function LineCard({ line, statuses, user, onChangeStatus }: Props) {
  const [pendingStatus, setPendingStatus] = useState<TaskStatus | null>(null)
  const [changing, setChanging] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [flash, setFlash] = useState(false)

  const { history, loading: histLoading, fetch: fetchHistory, deleteEntry, clearHistory } = useLineHistory(line.id)

  const canChange = user.role === 'brigadir' || user.role === 'controller' || user.role === 'admin'
  const isAdmin = user.role === 'admin'

  const handleStatusClick = useCallback((status: TaskStatus) => {
    if (status.id === line.status?.id) return
    if (!canChange) return
    setPendingStatus(status)
  }, [line.status, canChange])

  const handleConfirm = useCallback(async (comment?: string) => {
    if (!pendingStatus) return
    setChanging(true)
    const ok = await onChangeStatus(line.id, pendingStatus.id, user.id, comment)
    setChanging(false)
    setPendingStatus(null)
    if (ok) {
      setFlash(true)
      setTimeout(() => setFlash(false), 800)
    }
  }, [pendingStatus, line.id, user.id, onChangeStatus])

  useEffect(() => {
    if (historyOpen) fetchHistory()
  }, [historyOpen, fetchHistory])

  const canClickStatus = (s: TaskStatus) => {
    if (s.id === line.status?.id) return false
    if (canChange) return true
    return false
  }

  const getStatusButtonStyle = (status: TaskStatus, isActive: boolean, clickable: boolean): CSSProperties | undefined => {
    if (isActive) {
      return { ['--status-color' as string]: status.color }
    }

    if (clickable) {
      return { borderColor: status.color + '60', color: status.color }
    }

    return undefined
  }

  return (
    <>
      <div
        className={`rounded-2xl border transition-all duration-300 overflow-hidden
          ${line.status ? 'status-glow-card' : 'bg-white'}
          ${flash ? 'border-blue-400 shadow-md shadow-blue-100' : 'border-gray-100 shadow-sm'}`}
        style={
          line.status
            ? {
                ['--status-color' as string]: line.status.color,
                backgroundColor: `${line.status.color}14`,
              }
            : undefined
        }
      >
        {/* Line header */}
        <div className="p-3 sm:p-4 sm:pb-3">
          <div className="flex items-start justify-between gap-2 mb-3">
            <h3 className="font-bold text-gray-900 text-base">{line.name}</h3>
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

          {/* Meta */}
          {(line.updated_by_name || line.updated_at) && (
            <p className="text-xs text-gray-400 mb-3">
              {line.updated_by_name ? `${line.updated_by_name} · ` : ''}
              {formatTime(line.updated_at)}
            </p>
          )}

          {/* Status buttons */}
          <div className="grid grid-cols-2 gap-2">
            {statuses.map(s => {
              const isActive = s.id === line.status?.id
              const clickable = canClickStatus(s)
              return (
                <button
                  key={s.id}
                  onClick={() => handleStatusClick(s)}
                  disabled={!clickable}
                  className={`
                    w-full min-h-[52px] flex items-center justify-center text-center text-sm font-semibold rounded-xl transition-all duration-150
                    ${isActive
                      ? 'status-glow-button'
                      : clickable
                        ? 'border px-4 py-2.5 bg-white hover:opacity-80 active:scale-95 cursor-pointer'
                        : 'bg-gray-50 border-gray-100 text-gray-300 cursor-not-allowed'
                    }
                  `}
                  style={getStatusButtonStyle(s, isActive, clickable)}
                  title={!clickable ? 'Недостатньо прав' : `Встановити: ${s.name}`}
                >
                  <span className={isActive ? 'status-glow-button__inner' : ''}>
                    {s.name}
                    {isActive && (
                      <span className="ml-1 opacity-80">✓</span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* History toggle */}
        <div className="border-t border-gray-50">
          <button
            onClick={() => setHistoryOpen(o => !o)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-gray-400
                       hover:bg-gray-50 transition-colors"
          >
            <span className="font-medium">Історія</span>
            <span
              className="text-base sm:text-lg font-semibold transition-transform duration-200"
              style={{ transform: historyOpen ? 'rotate(180deg)' : 'none' }}
            >
              ▾
            </span>
          </button>

          {historyOpen && (
            <div className="px-4 pb-4">
              {/* Admin: clear all */}
              {isAdmin && history.length > 0 && (
                <button
                  onClick={() => clearHistory()}
                  className="text-xs text-red-400 hover:text-red-600 mb-2 transition-colors"
                >
                  Очистити всю історію
                </button>
              )}

              {histLoading && (
                <p className="text-xs text-gray-400 py-2">Завантаження...</p>
              )}

              {!histLoading && history.length === 0 && (
                <p className="text-xs text-gray-400 py-2">Змін ще не було</p>
              )}

              <div className="space-y-2 max-h-48 overflow-y-auto">
                {history.map((h, index) => {
                  const diffSeconds = getHistoryDiffSeconds(
                    h.created_at,
                    history[index + 1]?.created_at,
                    h.seconds_since_previous_change
                  )

                  return (
                  <div key={h.id} className="flex items-center gap-2 group">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {h.old_status_name && (
                          <span
                            className="text-xs px-1.5 py-0.5 rounded"
                            style={{ backgroundColor: (h.old_status_color || '#6B7280') + '20', color: h.old_status_color || '#6B7280' }}
                          >
                            {h.old_status_name}
                          </span>
                        )}
                        <span className="text-gray-300 text-xs">→</span>
                        {h.new_status_name && (
                          <span
                            className="text-xs px-1.5 py-0.5 rounded font-medium"
                            style={{ backgroundColor: (h.new_status_color || '#6B7280') + '20', color: h.new_status_color || '#6B7280' }}
                          >
                            {h.new_status_name}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {h.user_name} · {formatTime(h.created_at)}
                      </p>
                      {diffSeconds !== null && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          Різниця між змінами: {formatDuration(diffSeconds)}
                        </p>
                      )}
                    </div>
                    {isAdmin && (
                      <button
                        onClick={() => deleteEntry(h.id)}
                        className="opacity-0 group-hover:opacity-100 text-red-300 hover:text-red-500
                                   transition-all text-xs flex-shrink-0 w-5 h-5 flex items-center justify-center"
                        title="Видалити запис"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      {pendingStatus && (
        <StatusChangeModal
          lineName={line.name}
          currentStatus={line.status}
          newStatus={pendingStatus}
          onConfirm={handleConfirm}
          onCancel={() => setPendingStatus(null)}
          loading={changing}
        />
      )}
    </>
  )
}
