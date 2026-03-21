import { useState } from 'react'
import type { TaskStatus } from '../types'

interface Props {
  lineName: string
  currentStatus: TaskStatus | null
  newStatus: TaskStatus
  onConfirm: (comment?: string) => void
  onCancel: () => void
  loading?: boolean
}

export function StatusChangeModal({ lineName, currentStatus, newStatus, onConfirm, onCancel, loading }: Props) {
  const [comment, setComment] = useState('')
  const shouldShowComment = newStatus.name === 'Зупинка'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl animate-slide-up">
        <div className="p-6">
          <h3 className="text-lg font-bold text-gray-900 text-center mb-1">Змінити статус</h3>
          <p className="text-sm text-gray-500 text-center mb-6">{lineName}</p>

          {/* Status transition */}
          <div className="flex items-center justify-center gap-3 mb-8">
            {/* Old */}
            <div className="flex-1 text-center">
              {currentStatus ? (
                <>
                  <div
                    className="w-10 h-10 rounded-full mx-auto mb-2 flex items-center justify-center"
                    style={{ backgroundColor: currentStatus.color + '22', border: `2px solid ${currentStatus.color}` }}
                  >
                    <div className="w-4 h-4 rounded-full" style={{ backgroundColor: currentStatus.color }} />
                  </div>
                  <p className="text-sm font-medium text-gray-700">{currentStatus.name}</p>
                </>
              ) : (
                <p className="text-sm text-gray-400">—</p>
              )}
            </div>

            {/* Arrow */}
            <div className="text-gray-400 text-xl flex-shrink-0">→</div>

            {/* New */}
            <div className="flex-1 text-center">
              <div
                className="w-10 h-10 rounded-full mx-auto mb-2 flex items-center justify-center ring-2 ring-offset-2"
                style={{
                  backgroundColor: newStatus.color + '22',
                  border: `2px solid ${newStatus.color}`,
                  boxShadow: `0 0 0 2px ${newStatus.color}`,
                }}
              >
                <div className="w-4 h-4 rounded-full" style={{ backgroundColor: newStatus.color }} />
              </div>
              <p className="text-sm font-bold" style={{ color: newStatus.color }}>{newStatus.name}</p>
            </div>
          </div>

          {shouldShowComment && (
            <div className="mb-5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <label htmlFor="status-comment" className="text-sm font-medium text-gray-700">
                  Коментар
                </label>
                <span className="text-xs text-gray-400">{comment.length}/25</span>
              </div>
              <input
                id="status-comment"
                type="text"
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, 25))}
                maxLength={25}
                placeholder="Необов'язково"
                className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-700
                           outline-none transition placeholder:text-gray-400
                           focus:border-gray-300 focus:ring-2 focus:ring-gray-100"
              />
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              disabled={loading}
              className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-700 font-medium
                         hover:bg-gray-50 active:bg-gray-100 transition-colors disabled:opacity-50"
            >
              Скасувати
            </button>
            <button
              onClick={() => onConfirm(comment.trim() || undefined)}
              disabled={loading}
              className="flex-1 py-3 rounded-xl text-white font-semibold
                         hover:opacity-90 active:opacity-80 transition-opacity disabled:opacity-50"
              style={{ backgroundColor: newStatus.color }}
            >
              {loading ? '...' : 'Підтвердити'}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slide-up {
          from { transform: translateY(40px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        .animate-slide-up { animation: slide-up 0.2s ease-out; }
      `}</style>
    </div>
  )
}
