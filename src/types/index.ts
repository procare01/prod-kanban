export type Role = 'brigadir' | 'controller' | 'admin'

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
