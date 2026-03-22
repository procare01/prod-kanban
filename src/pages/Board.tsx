import { useEffect, useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { User, Line, Event } from '../types'
import { useBoard, useEvents } from '../hooks/useBoard'
import { useRealtime } from '../hooks/useRealtime'
import { UserCard } from '../components/UserCard'
import { SummaryCard } from '../components/SummaryCard'
import { EventsList } from '../components/EventsList'
import { SubdivisionAccordion } from '../components/SubdivisionAccordion'
import { supabase } from '../lib/supabase'
import { isDemoMode } from '../lib/demoData'

interface Props {
  user: User
  onLogout: () => void
}

export function Board({ user, onLogout }: Props) {
  const navigate = useNavigate()
  const { board, loading, error, fetchBoard, changeStatus, applyLineUpdate } = useBoard()
  const { events, loading: eventsLoading, fetchEvents, prependEvent, deleteEvent, clearAllEvents } = useEvents()
  const [workEndBanner, setWorkEndBanner] = useState(false)
  const [completing, setCompleting] = useState(false)

  useEffect(() => {
    fetchBoard()
    fetchEvents()
  }, [fetchBoard, fetchEvents])

  // ── Work day end timer ───────────────────────────────────
  useEffect(() => {
    if (user.role !== 'admin' || isDemoMode) return

    let dismissed = false

    async function checkWorkEnd() {
      if (dismissed) return
      try {
        const { data } = await supabase.rpc('get_settings')
        if (!data) return
        const workEnd: string = (data as any).work_end ?? '18:00'
        const [endH, endM] = workEnd.split(':').map(Number)
        const now = new Date()
        const nowMinutes = now.getHours() * 60 + now.getMinutes()
        const endMinutes = endH * 60 + endM
        // Show banner if within 30 min after work_end
        if (nowMinutes >= endMinutes && nowMinutes <= endMinutes + 30) {
          setWorkEndBanner(true)
        }
      } catch {/* settings table might not exist yet */}
    }

    checkWorkEnd()
    const interval = setInterval(checkWorkEnd, 60 * 1000) // check every minute
    return () => clearInterval(interval)
  }, [user.role])

  const handleCompleteAllLines = useCallback(async () => {
    if (!window.confirm('Завершити всі активні лінії? Статус буде змінено на "Завершено".')) return
    setCompleting(true)
    try {
      await supabase.rpc('complete_all_lines_for_day', { p_user_id: user.id })
      await fetchBoard()
      setWorkEndBanner(false)
    } catch {/* ignore */} finally {
      setCompleting(false)
    }
  }, [user.id, fetchBoard])

  const handleLineUpdate = useCallback((line: Line) => {
    applyLineUpdate(line)
  }, [applyLineUpdate])

  const handleNewEvent = useCallback((ev: Event) => {
    prependEvent(ev)
  }, [prependEvent])

  const handleLogout = useCallback(() => {
    if (!window.confirm('Вийти з акаунта?')) return
    onLogout()
  }, [onLogout])

  useRealtime({ onLineUpdate: handleLineUpdate, onNewEvent: handleNewEvent })

  if (loading && !board) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Завантаження дошки...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      <div className="max-w-screen-xl mx-auto px-2 sm:px-4 pt-2 sm:pt-4 space-y-2 sm:space-y-3">

        {/* User card */}
        <UserCard user={user} />

        {/* Admin link */}
        {user.role === 'admin' && (
          <button
            onClick={() => navigate('/admin')}
            className="w-full flex items-center justify-between bg-purple-50 border border-purple-100
                       rounded-2xl px-4 py-3 hover:bg-purple-100 active:bg-purple-200 transition-colors"
          >
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="text-sm font-semibold text-purple-700">Адмін-панель</span>
            </div>
            <span className="text-purple-400">›</span>
          </button>
        )}

        {/* Analytics link (admin only) */}
        {user.role === 'admin' && (
          <button
            onClick={() => navigate('/analytics')}
            className="w-full flex items-center justify-between bg-indigo-50 border border-indigo-100
                       rounded-2xl px-4 py-3 hover:bg-indigo-100 active:bg-indigo-200 transition-colors"
          >
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <span className="text-sm font-semibold text-indigo-700">Аналітика</span>
            </div>
            <span className="text-indigo-400">›</span>
          </button>
        )}

        {/* Data Analytics dashboard (admin only) */}
        {user.role === 'admin' && (
          <button
            onClick={() => navigate('/data-analytics')}
            className="w-full flex items-center justify-between bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-100
                       rounded-2xl px-4 py-3 hover:from-indigo-100 hover:to-purple-100 active:from-indigo-200 active:to-purple-200 transition-all"
          >
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-md flex items-center justify-center">
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <span className="text-sm font-semibold bg-gradient-to-r from-indigo-700 to-purple-700 bg-clip-text text-transparent">Дашборд</span>
            </div>
            <span className="text-purple-400">›</span>
          </button>
        )}

        {/* CRM Warehouse (crm role OR admin with PIN 1505) */}
        {(user.role === 'crm' || (user.role === 'admin' && user.pin === '1505')) && (
          <button
            onClick={() => navigate('/crm')}
            className="w-full flex items-center justify-between bg-emerald-50 border border-emerald-100
                       rounded-2xl px-4 py-3 hover:bg-emerald-100 active:bg-emerald-200 transition-colors"
          >
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
              <span className="text-sm font-semibold text-emerald-700">Склад CRM</span>
            </div>
            <span className="text-emerald-400">›</span>
          </button>
        )}

        {/* Work day end banner (admin only) */}
        {workEndBanner && user.role === 'admin' && (
          <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xl">🕐</span>
              <div>
                <p className="text-sm font-semibold text-amber-800">Кінець робочого дня</p>
                <p className="text-xs text-amber-600">Завершіть всі незакінчені процеси для аналітики</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setWorkEndBanner(false)}
                className="text-xs text-amber-500 hover:text-amber-700 px-2 py-1"
              >
                Закрити
              </button>
              <button
                onClick={handleCompleteAllLines}
                disabled={completing}
                className="text-xs bg-amber-600 text-white px-3 py-1.5 rounded-lg font-semibold
                           hover:bg-amber-700 transition-colors disabled:opacity-50 flex items-center gap-1"
              >
                {completing
                  ? <><span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" /> Завершення...</>
                  : 'Завершити всі'
                }
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3">
            <p className="text-sm text-amber-700">⚠️ {error}</p>
          </div>
        )}

        {/* Summary cards */}
        {board && (
          <>
            <SummaryCard subdivisions={board.subdivisions} statuses={board.statuses} />
            <EventsList
              user={user}
              events={events}
              loading={eventsLoading}
              onDelete={deleteEvent}
              onClearAll={clearAllEvents}
            />
          </>
        )}

        {/* Subdivisions */}
        {board?.subdivisions.map((sub) => (
          <SubdivisionAccordion
            key={sub.id}
            subdivision={sub}
            statuses={board.statuses}
            user={user}
            onChangeStatus={changeStatus}
            defaultOpen={false}
          />
        ))}

        <div className="mt-8 sm:mt-4 pt-4 border-t border-gray-100">
          <button
            onClick={handleLogout}
            className="w-full py-3 rounded-xl border border-gray-200 bg-white text-gray-600
                       font-medium text-sm hover:bg-gray-50 active:bg-gray-100 transition-colors"
          >
            Вийти
          </button>
        </div>
      </div>
    </div>
  )
}
