import type { BoardData, User, Event, LineHistoryEntry } from '../types'

export const DEMO_USERS: User[] = [
  { id: 'demo-admin', display_id: 1, name: 'Іван Адміністратор', role: 'admin', pin: '0000', created_at: '' },
  { id: 'demo-brig1', display_id: 2, name: 'Олег Бригадир', role: 'brigadir', pin: '1111', created_at: '' },
  { id: 'demo-brig2', display_id: 3, name: 'Марія Бригадир', role: 'brigadir', pin: '2222', created_at: '' },
  { id: 'demo-ctrl', display_id: 4, name: 'Петро Контролер', role: 'controller', pin: '3333', created_at: '' },
]

const S = {
  start:  { id: 's1', name: 'Початок',   color: '#6B7280', order_index: 0, is_terminal: false },
  pack:   { id: 's2', name: 'Фасування', color: '#F59E0B', order_index: 1, is_terminal: false },
  stop:   { id: 's3', name: 'Зупинка',   color: '#EF4444', order_index: 2, is_terminal: false },
  done:   { id: 's4', name: 'Завершено', color: '#10B981', order_index: 3, is_terminal: true  },
}

export const DEMO_BOARD: BoardData = {
  statuses: Object.values(S),
  subdivisions: [
    {
      id: 'sub1', name: 'Лінія', order_index: 0,
      lines: [
        { id: 'l1', name: 'Лінія-1', order_index: 0, is_active: true, updated_at: new Date().toISOString(), updated_by_name: null, status: S.start },
        { id: 'l2', name: 'Лінія-2', order_index: 1, is_active: true, updated_at: new Date().toISOString(), updated_by_name: 'Олег Бригадир', status: S.pack },
        { id: 'l3', name: 'Лінія-3', order_index: 2, is_active: true, updated_at: new Date().toISOString(), updated_by_name: null, status: S.stop },
        { id: 'l4', name: 'Лінія-4', order_index: 3, is_active: true, updated_at: new Date().toISOString(), updated_by_name: null, status: S.start },
        { id: 'l5', name: 'Лінія-5', order_index: 4, is_active: true, updated_at: new Date().toISOString(), updated_by_name: 'Марія Бригадир', status: S.done },
        { id: 'l6', name: 'Лінія-6', order_index: 5, is_active: true, updated_at: new Date().toISOString(), updated_by_name: null, status: S.start },
      ],
    },
    {
      id: 'sub2', name: 'Тубна', order_index: 1,
      lines: [
        { id: 't1', name: 'Тубна-1', order_index: 0, is_active: true, updated_at: new Date().toISOString(), updated_by_name: 'Олег Бригадир', status: S.pack },
        { id: 't2', name: 'Тубна-2', order_index: 1, is_active: true, updated_at: new Date().toISOString(), updated_by_name: null, status: S.start },
        { id: 't3', name: 'Тубна-3', order_index: 2, is_active: true, updated_at: new Date().toISOString(), updated_by_name: null, status: S.stop },
        { id: 't4', name: 'Тубна-4', order_index: 3, is_active: true, updated_at: new Date().toISOString(), updated_by_name: null, status: S.start },
      ],
    },
    {
      id: 'sub3', name: 'Сашетна', order_index: 2,
      lines: [
        { id: 'sa1', name: 'Сашетна-1', order_index: 0, is_active: true, updated_at: new Date().toISOString(), updated_by_name: null, status: S.start },
        { id: 'sa2', name: 'Сашетна-2', order_index: 1, is_active: true, updated_at: new Date().toISOString(), updated_by_name: 'Марія Бригадир', status: S.pack },
        { id: 'sa3', name: 'Сашетна-3', order_index: 2, is_active: true, updated_at: new Date().toISOString(), updated_by_name: null, status: S.start },
        { id: 'sa4', name: 'Сашетна-4', order_index: 3, is_active: true, updated_at: new Date().toISOString(), updated_by_name: null, status: S.done },
        { id: 'sa5', name: 'Сашетна-5', order_index: 4, is_active: true, updated_at: new Date().toISOString(), updated_by_name: null, status: S.start },
      ],
    },
  ],
}

export const DEMO_EVENTS: Event[] = [
  { id: 'e1', description: 'Олег Бригадир змінив Лінія-2: Початок → Фасування', comment: null, created_at: new Date(Date.now() - 600000).toISOString(), line_name: 'Лінія-2', user_name: 'Олег Бригадир' },
  { id: 'e2', description: 'Марія Бригадир змінив Лінія-5: Фасування → Завершено', comment: null, created_at: new Date(Date.now() - 1200000).toISOString(), line_name: 'Лінія-5', user_name: 'Марія Бригадир' },
  { id: 'e3', description: 'Олег Бригадир змінив Тубна-1: Початок → Фасування', comment: null, created_at: new Date(Date.now() - 3600000).toISOString(), line_name: 'Тубна-1', user_name: 'Олег Бригадир' },
]

export const DEMO_HISTORY: LineHistoryEntry[] = [
  { id: 'h1', created_at: new Date(Date.now() - 600000).toISOString(), user_name: 'Олег Бригадир', old_status_name: 'Початок', old_status_color: '#6B7280', new_status_name: 'Фасування', new_status_color: '#F59E0B', seconds_since_previous_change: 600 },
  { id: 'h2', created_at: new Date(Date.now() - 7200000).toISOString(), user_name: 'Марія Бригадир', old_status_name: null, old_status_color: null, new_status_name: 'Початок', new_status_color: '#6B7280', seconds_since_previous_change: null },
]

export const isDemoMode = !import.meta.env.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL === 'https://placeholder.supabase.co'
