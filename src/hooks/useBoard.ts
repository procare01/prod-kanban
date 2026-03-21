import { useState, useCallback } from 'react'
import type { BoardData, LineHistoryEntry, Event, TaskStatus, Line } from '../types'
import { supabase } from '../lib/supabase'
import { DEMO_BOARD, DEMO_EVENTS, DEMO_HISTORY, isDemoMode } from '../lib/demoData'

export function useBoard() {
  const [board, setBoard] = useState<BoardData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchBoard = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (isDemoMode) {
        setBoard(DEMO_BOARD)
        return
      }
      const { error: resetError } = await supabase.rpc('reset_lines_for_new_day')
      if (resetError) {
        console.warn('Daily reset skipped:', resetError.message)
      }
      const { data, error: err } = await supabase.rpc('get_board')
      if (err) throw err
      setBoard(data as BoardData)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Помилка завантаження')
      setBoard(null)
    } finally {
      setLoading(false)
    }
  }, [])

  // Apply realtime update for a single line
  const applyLineUpdate = useCallback((updatedLine: Line) => {
    setBoard(prev => {
      if (!prev) return prev
      return {
        ...prev,
        subdivisions: prev.subdivisions.map(sub => ({
          ...sub,
          lines: sub.lines.map(l => l.id === updatedLine.id ? { ...l, ...updatedLine } : l),
        })),
      }
    })
  }, [])

  const changeStatus = useCallback(async (
    lineId: string,
    newStatusId: string,
    userId: string,
    comment?: string
  ): Promise<boolean> => {
    if (isDemoMode) {
      // Local state update for demo
      const newStatus = DEMO_BOARD.statuses.find(s => s.id === newStatusId) as TaskStatus
      setBoard(prev => {
        if (!prev) return prev
        return {
          ...prev,
          subdivisions: prev.subdivisions.map(sub => ({
            ...sub,
            lines: sub.lines.map(l =>
              l.id === lineId
                ? { ...l, status: newStatus, updated_at: new Date().toISOString(), updated_by_name: 'Ви' }
                : l
            ),
          })),
        }
      })
      return true
    }

    try {
      const { error: err } = await supabase.rpc('change_line_status', {
        p_line_id: lineId,
        p_new_status_id: newStatusId,
        p_user_id: userId,
        p_comment: comment ?? null,
      })
      if (err) throw err

      // Fire webhook asynchronously (don't block UI)
      fireWebhookForLatestEvent(lineId).catch(() => {/* silent */})

      return true
    } catch {
      return false
    }
  }, [])

  return { board, loading, error, fetchBoard, changeStatus, applyLineUpdate }
}

// ── Webhook helper ───────────────────────────────────────────

async function fireWebhookForLatestEvent(lineId: string) {
  const webhookUrl = localStorage.getItem('prod_kanban_webhook_url')
  if (!webhookUrl) return

  // Fetch the most recent event for this line
  const { data: events } = await supabase
    .from('events')
    .select('id, description, comment, created_at, line_id, user_id')
    .eq('line_id', lineId)
    .order('created_at', { ascending: false })
    .limit(1)

  if (!events || events.length === 0) return
  const ev = events[0]

  const payload = {
    event: 'status_changed',
    line_id: lineId,
    description: ev.description,
    comment: ev.comment ?? null,
    timestamp: ev.created_at,
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(6000),
    })
    const status = res.ok ? 'sent' : 'failed'
    const errMsg = res.ok ? null : `HTTP ${res.status}`
    await supabase.rpc('update_event_webhook_status', { p_id: ev.id, p_status: status, p_error: errMsg })
  } catch (err: any) {
    await supabase.rpc('update_event_webhook_status', {
      p_id: ev.id,
      p_status: 'failed',
      p_error: err?.message ?? 'network error',
    })
  }
}

// ── Events ──────────────────────────────────────────────────

export function useEvents() {
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(false)

  const fetchEvents = useCallback(async () => {
    setLoading(true)
    try {
      if (isDemoMode) { setEvents(DEMO_EVENTS); return }
      const { data } = await supabase.rpc('get_events', { p_limit: 50 })
      setEvents((data as Event[]) ?? [])
    } catch {
      setEvents([])
    } finally {
      setLoading(false)
    }
  }, [])

  const prependEvent = useCallback((ev: Event) => {
    setEvents(prev => [ev, ...prev].slice(0, 50))
  }, [])

  const deleteEvent = useCallback(async (id: string) => {
    if (isDemoMode) { setEvents(prev => prev.filter(e => e.id !== id)); return }
    const { error } = await supabase.rpc('admin_delete_event', { p_id: id })
    if (error) return
    setEvents(prev => prev.filter(e => e.id !== id))
  }, [])

  const clearAllEvents = useCallback(async () => {
    if (isDemoMode) { setEvents([]); return }
    const { error } = await supabase.from('events').delete().not('id', 'is', null)
    if (error) return
    setEvents([])
  }, [])

  return { events, loading, fetchEvents, prependEvent, deleteEvent, clearAllEvents }
}

// ── Line history ─────────────────────────────────────────────

export function useLineHistory(lineId: string | null) {
  const [history, setHistory] = useState<LineHistoryEntry[]>([])
  const [loading, setLoading] = useState(false)

  const fetch = useCallback(async () => {
    if (!lineId) return
    setLoading(true)
    try {
      if (isDemoMode) { setHistory(DEMO_HISTORY); return }
      const { data } = await supabase.rpc('get_line_history', { p_line_id: lineId })
      setHistory((data as LineHistoryEntry[]) ?? [])
    } catch {
      setHistory([])
    } finally {
      setLoading(false)
    }
  }, [lineId])

  const deleteEntry = useCallback(async (id: string) => {
    if (isDemoMode) { setHistory(prev => prev.filter(h => h.id !== id)); return }
    await supabase.rpc('admin_delete_history_entry', { p_id: id })
    setHistory(prev => prev.filter(h => h.id !== id))
  }, [])

  const clearHistory = useCallback(async () => {
    if (!lineId) return
    if (isDemoMode) { setHistory([]); return }
    await supabase.rpc('admin_clear_line_history', { p_line_id: lineId })
    setHistory([])
  }, [lineId])

  return { history, loading, fetch, deleteEntry, clearHistory }
}
