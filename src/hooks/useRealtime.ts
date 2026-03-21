import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { isDemoMode } from '../lib/demoData'
import type { Line, Event, TaskStatus } from '../types'

interface RealtimeCallbacks {
  onLineUpdate: (line: Line) => void
  onNewEvent: (event: Event) => void
}

interface LineRealtimeRow {
  id: string
  name: string
  order_index: number
  is_active: boolean
  updated_at: string
  status: TaskStatus | null
  updated_by_user: { name: string }[] | null
}

interface EventRealtimeRow {
  id: string
  description: string
  comment: string | null
  created_at: string
  line: { name: string }[] | null
  user: { name: string }[] | null
}

export function useRealtime({ onLineUpdate, onNewEvent }: RealtimeCallbacks) {
  useEffect(() => {
    if (isDemoMode) return

    const channel = supabase
      .channel('board-realtime')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'lines' },
        async (payload) => {
          // Fetch the full line with joins
          const { data } = await supabase
            .from('lines')
            .select(`
              id, name, order_index, is_active, updated_at,
              status:task_statuses(id, name, color, is_terminal, order_index),
              updated_by_user:users!lines_updated_by_fkey(name)
            `)
            .eq('id', payload.new.id)
            .single()

          if (data) {
            const row = data as unknown as LineRealtimeRow
            const line: Line = {
              id: row.id,
              name: row.name,
              order_index: row.order_index,
              is_active: row.is_active,
              updated_at: row.updated_at,
              updated_by_name: row.updated_by_user?.[0]?.name ?? null,
              status: row.status,
            }
            onLineUpdate(line)
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'events' },
        async (payload) => {
          const { data } = await supabase
            .from('events')
            .select(`
              id, description, comment, created_at,
              line:lines(name),
              user:users(name)
            `)
            .eq('id', payload.new.id)
            .single()

          if (data) {
            const row = data as unknown as EventRealtimeRow
            const ev: Event = {
              id: row.id,
              description: row.description,
              comment: row.comment,
              created_at: row.created_at,
              line_name: row.line?.[0]?.name ?? null,
              user_name: row.user?.[0]?.name ?? null,
            }
            onNewEvent(ev)
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [onLineUpdate, onNewEvent])
}
