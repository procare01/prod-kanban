export type Role = 'brigadir' | 'controller' | 'admin' | 'crm'

export interface User {
  id: string
  display_id: number
  name: string
  role: Role
  pin: string
  created_at: string
}

export interface TaskStatus {
  id: string
  name: string
  color: string
  order_index: number
  is_terminal: boolean
}

export interface Subdivision {
  id: string
  name: string
  order_index: number
  lines: Line[]
}

export interface Line {
  id: string
  name: string
  order_index: number
  is_active: boolean
  updated_at: string
  updated_by_name: string | null
  status: TaskStatus | null
}

export interface LineHistoryEntry {
  id: string
  created_at: string
  user_name: string | null
  old_status_name: string | null
  old_status_color: string | null
  new_status_name: string | null
  new_status_color: string | null
  seconds_since_previous_change: number | null
}

export interface Event {
  id: string
  description: string
  comment: string | null
  created_at: string
  line_name: string | null
  user_name: string | null
}

export interface BoardData {
  subdivisions: Subdivision[]
  statuses: TaskStatus[]
}

export interface TodayHistoryEntry {
  line_id: string
  line_name: string
  old_status_name: string | null
  old_status_color: string | null
  old_status_is_terminal: boolean
  new_status_name: string | null
  new_status_color: string | null
  new_status_is_terminal: boolean
  created_at: string
  seconds_since_previous_change: number | null
}

export interface EventWithWebhook extends Event {
  webhook_status: 'sent' | 'failed' | 'pending' | null
  webhook_error: string | null
  webhook_sent_at: string | null
}

export interface CrmEntry {
  id: string
  user_id: string
  user_name: string
  orders_count: number
  units_count: number
  created_at: string
}

export interface CrmTodayData {
  total_orders: number
  total_units: number
  entries: CrmEntry[]
}

export interface CrmUserKpi {
  user_id: string
  user_name: string
  total_orders: number
  total_units: number
  orders_per_hour: number
  units_per_hour: number
}

export interface CrmDailyPoint {
  date: string
  orders: number
  units: number
}

export interface CrmAnalytics {
  daily: CrmDailyPoint[]
  by_user_today: CrmUserKpi[]
  monthly: { total_orders: number; total_units: number }
}

export interface WorkSettings {
  work_start: string   // "HH:MM"
  work_end: string     // "HH:MM"
  webhook_url: string
}
