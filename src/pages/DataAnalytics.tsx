import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { User, BoardData, Event, Line, TodayHistoryEntry } from '../types'
import { supabase } from '../lib/supabase'
import { isDemoMode, DEMO_BOARD, DEMO_EVENTS } from '../lib/demoData'

interface Props { user: User }

// ── helpers ──────────────────────────────────────────────────

function pct(value: number, total: number) {
  return total === 0 ? 0 : Math.round((value / total) * 100)
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'щойно'
  if (min < 60) return `${min} хв тому`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} год тому`
  return `${Math.floor(h / 24)} дн тому`
}

function formatNumber(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return n.toString()
}

const DAY_NAMES = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']

// ── SVG Area Chart ───────────────────────────────────────────

function AreaChart({ data, color = '#6366F1', height = 140 }: {
  data: { label: string; value: number; prevValue?: number }[]
  color?: string
  height?: number
}) {
  if (data.length < 2) return <p className="text-gray-400 text-sm text-center py-6">Немає даних</p>
  const w = 500, h = height, pad = 30
  const maxVal = Math.max(...data.map(d => Math.max(d.value, d.prevValue ?? 0)), 1)
  const stepX = (w - pad * 2) / (data.length - 1)

  const getY = (v: number) => pad + (h - pad * 2) * (1 - v / maxVal)

  const mainPoints = data.map((d, i) => `${pad + i * stepX},${getY(d.value)}`)
  const mainLine = mainPoints.join(' ')
  const mainArea = `${pad},${h - pad} ${mainLine} ${pad + (data.length - 1) * stepX},${h - pad}`

  const prevPoints = data.filter(d => d.prevValue !== undefined).length > 1
    ? data.map((d, i) => `${pad + i * stepX},${getY(d.prevValue ?? 0)}`).join(' ')
    : null

  // Grid lines
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const y = pad + (h - pad * 2) * (1 - f)
    const val = Math.round(maxVal * f)
    return { y, val }
  })

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {/* Grid */}
      {gridLines.map(({ y, val }) => (
        <g key={val}>
          <line x1={pad} y1={y} x2={w - pad} y2={y} stroke="#E5E7EB" strokeWidth="0.5" strokeDasharray="4 2" />
          <text x={pad - 6} y={y + 4} textAnchor="end" className="fill-gray-400" fontSize="10">{formatNumber(val)}</text>
        </g>
      ))}
      {/* Prev period dashed line */}
      {prevPoints && (
        <polyline points={prevPoints} fill="none" stroke="#D1D5DB" strokeWidth="1.5" strokeDasharray="4 3" />
      )}
      {/* Main area */}
      <polygon points={mainArea} fill="url(#areaGrad)" />
      <polyline points={mainLine} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* Dots */}
      {data.map((d, i) => (
        <circle key={i} cx={pad + i * stepX} cy={getY(d.value)} r="3.5" fill="white" stroke={color} strokeWidth="2" />
      ))}
      {/* X labels */}
      {data.map((d, i) => (
        <text key={i} x={pad + i * stepX} y={h - 6} textAnchor="middle" className="fill-gray-400" fontSize="10">
          {d.label}
        </text>
      ))}
    </svg>
  )
}

// ── Vertical Bar Chart ───────────────────────────────────────

function VerticalBarChart({ data, activeIndex }: {
  data: { label: string; value: number }[]
  activeIndex?: number
}) {
  const maxVal = Math.max(...data.map(d => d.value), 1)
  return (
    <div className="flex items-end justify-between gap-2 h-32 px-2">
      {data.map((d, i) => {
        const heightPct = (d.value / maxVal) * 100
        const isActive = i === activeIndex
        return (
          <div key={i} className="flex flex-col items-center flex-1 gap-1">
            {isActive && <span className="text-xs font-bold text-gray-700">{d.value.toFixed(0)}</span>}
            <div className="w-full flex items-end justify-center" style={{ height: '80px' }}>
              <div
                className={`w-8 rounded-lg transition-all duration-700 ${isActive ? 'bg-blue-500' : 'bg-gray-200'}`}
                style={{ height: `${Math.max(4, heightPct)}%` }}
              />
            </div>
            <span className={`text-xs font-medium ${isActive ? 'text-blue-600' : 'text-gray-400'}`}>
              {d.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── Gauge Chart ──────────────────────────────────────────────

function GaugeChart({ value, target, label }: { value: number; target: number; label: string }) {
  const size = 160
  const cx = size / 2, cy = size / 2 + 10
  const r = 58
  const startAngle = -210
  const endAngle = 30
  const totalAngle = endAngle - startAngle
  const segments = 20

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size - 10} viewBox={`0 0 ${size} ${size - 10}`}>
        {Array.from({ length: segments }).map((_, i) => {
          const angle = startAngle + (i / segments) * totalAngle
          const filled = i / segments <= value / 100
          const rad = (angle * Math.PI) / 180
          const x1 = cx + (r - 8) * Math.cos(rad)
          const y1 = cy + (r - 8) * Math.sin(rad)
          const x2 = cx + r * Math.cos(rad)
          const y2 = cy + r * Math.sin(rad)
          return (
            <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={filled ? '#10B981' : '#E5E7EB'} strokeWidth="4" strokeLinecap="round" />
          )
        })}
        <text x={cx} y={cy - 2} textAnchor="middle" className="fill-gray-800" fontSize="28" fontWeight="bold">
          {value}%
        </text>
        <text x={cx} y={cy + 16} textAnchor="middle" className="fill-gray-400" fontSize="10">
          {label}
        </text>
      </svg>
    </div>
  )
}

// ── KPI Card ─────────────────────────────────────────────────

function KpiCard({ title, value, change, icon, iconBg }: {
  title: string; value: string | number; change?: number; icon: React.ReactNode; iconBg: string
}) {
  const isUp = (change ?? 0) >= 0
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500 font-medium">{title}</span>
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${iconBg}`}>
          {icon}
        </div>
      </div>
      <div className="text-2xl sm:text-3xl font-bold text-gray-800 tracking-tight">
        {typeof value === 'number' ? formatNumber(value) : value}
      </div>
      {change !== undefined && (
        <div className="flex items-center gap-1.5">
          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${isUp ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
            {isUp ? '▲' : '▼'} {Math.abs(change).toFixed(1)}%
          </span>
          <span className="text-xs text-gray-400">vs попередній</span>
        </div>
      )}
    </div>
  )
}

// ── Production Table ─────────────────────────────────────────

function ProductionTable({ lines, events }: { lines: Line[]; events: Event[] }) {
  // Count events per line
  const lineEvents = useMemo(() => {
    const map = new Map<string, number>()
    for (const ev of events) {
      if (ev.line_name) map.set(ev.line_name, (map.get(ev.line_name) ?? 0) + 1)
    }
    return map
  }, [events])

  const sorted = useMemo(() => {
    return [...lines]
      .filter(l => l.is_active)
      .sort((a, b) => (lineEvents.get(b.name) ?? 0) - (lineEvents.get(a.name) ?? 0))
      .slice(0, 6)
  }, [lines, lineEvents])

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-gray-400 text-xs uppercase tracking-wider">
            <th className="text-left py-2 font-medium">Лінія</th>
            <th className="text-left py-2 font-medium">Статус</th>
            <th className="text-center py-2 font-medium">Подій</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((line, i) => (
            <tr key={line.id} className="border-t border-gray-50 hover:bg-gray-50/50 transition-colors">
              <td className="py-3">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-lg bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500">
                    {i + 1}
                  </span>
                  <span className="font-medium text-gray-700">{line.name}</span>
                </div>
              </td>
              <td className="py-3">
                {line.status ? (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
                    style={{
                      backgroundColor: line.status.color + '18',
                      color: line.status.color,
                    }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: line.status.color }} />
                    {line.status.name}
                  </span>
                ) : (
                  <span className="text-gray-400 text-xs">—</span>
                )}
              </td>
              <td className="py-3 text-center">
                <span className="font-semibold text-gray-700">{lineEvents.get(line.name) ?? 0}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Horizontal Progress Bars ─────────────────────────────────

function SubdivisionBars({ stats }: {
  stats: { name: string; total: number; done: number; color: string }[]
}) {
  const maxTotal = Math.max(...stats.map(s => s.total), 1)
  return (
    <div className="space-y-3">
      {stats.map(s => (
        <div key={s.name}>
          <div className="flex items-center justify-between text-sm mb-1.5">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="text-gray-700 font-medium">{s.name}</span>
            </div>
            <span className="text-gray-500 text-xs">{s.done}/{s.total}</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700"
              style={{ width: `${pct(s.done, s.total)}%`, backgroundColor: s.color }} />
          </div>
          <div className="h-1 bg-gray-50 rounded-full overflow-hidden mt-1">
            <div className="h-full rounded-full bg-gray-200 transition-all duration-700"
              style={{ width: `${pct(s.total, maxTotal) * 100 / 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main component ───────────────────────────────────────────

// ── Colored status timeline (per card) ────────────────────────

interface TimelineSegment {
  startMin: number
  endMin: number
  statusName: string | null
  color: string
  isTerminal: boolean
}

function buildTimelineSegments(
  history: TodayHistoryEntry[],
  currentStatusName: string | null,
  currentStatusColor: string | null,
  workStartH: number,
  workEndH: number,
): TimelineSegment[] {
  const workDurationMin = (workEndH - workStartH) * 60
  const now = new Date()
  const nowMinute = Math.min(
    workDurationMin,
    Math.max(0, (now.getHours() - workStartH) * 60 + now.getMinutes()),
  )

  if (history.length === 0) {
    if (nowMinute <= 0) return []
    return [{
      startMin: 0,
      endMin: nowMinute,
      statusName: currentStatusName,
      color: currentStatusColor ?? '#94A3B8',
      isTerminal: false,
    }]
  }

  const segments: TimelineSegment[] = []
  let prevMin = 0

  for (const entry of history) {
    const d = new Date(entry.created_at)
    const minute = Math.max(0, Math.min(workDurationMin,
      (d.getHours() - workStartH) * 60 + d.getMinutes()))
    if (minute > prevMin) {
      segments.push({
        startMin: prevMin,
        endMin: minute,
        statusName: entry.old_status_name,
        color: entry.old_status_color ?? '#94A3B8',
        isTerminal: entry.old_status_is_terminal,
      })
    }
    prevMin = minute
  }

  const last = history[history.length - 1]
  if (nowMinute > prevMin) {
    segments.push({
      startMin: prevMin,
      endMin: nowMinute,
      statusName: last.new_status_name,
      color: last.new_status_color ?? '#94A3B8',
      isTerminal: last.new_status_is_terminal,
    })
  }

  return segments.filter(s => s.endMin > s.startMin)
}

function ColoredTimelineBar({
  segments,
  completionMarkers,
  workStart,
  workEnd,
}: {
  segments: TimelineSegment[]
  completionMarkers: number[]
  workStart: number
  workEnd: number
}) {
  const W = 440, H = 58
  const BAR_Y = 14, BAR_H = 24
  const LABEL_Y = H - 2
  const workDurationMin = (workEnd - workStart) * 60
  const plotW = W
  const hours = workEnd - workStart
  const xOf = (min: number) => (min / workDurationMin) * plotW

  // Collect unique statuses for mini labels inside segments (if wide enough)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      <defs>
        <clipPath id="barClip">
          <rect x={0} y={BAR_Y} width={plotW} height={BAR_H} rx="6" />
        </clipPath>
      </defs>

      {/* Background track */}
      <rect x={0} y={BAR_Y} width={plotW} height={BAR_H} rx="6" fill="#E2E8F0" />

      {/* Colored status segments — clipped to rounded rect */}
      <g clipPath="url(#barClip)">
        {segments.map((seg, i) => {
          const x = xOf(seg.startMin)
          const w = Math.max(xOf(seg.endMin) - x, 1)
          return (
            <g key={i}>
              <rect x={x} y={BAR_Y} width={w} height={BAR_H} fill={seg.color} opacity={0.88} />
              {/* Status label inside segment if wide enough */}
              {w > 38 && seg.statusName && (
                <text
                  x={x + w / 2} y={BAR_Y + BAR_H / 2 + 3.5}
                  textAnchor="middle" fill="white"
                  fontSize="7.5" fontWeight="bold"
                  style={{ textShadow: '0 1px 2px rgba(0,0,0,0.4)' }}
                >
                  {seg.statusName}
                </text>
              )}
            </g>
          )
        })}
      </g>

      {/* Dividers between segments */}
      {segments.slice(0, -1).map((seg, i) => {
        const x = xOf(seg.endMin)
        return (
          <line key={i} x1={x} y1={BAR_Y} x2={x} y2={BAR_Y + BAR_H}
            stroke="white" strokeWidth="1.5" opacity="0.6" />
        )
      })}

      {/* Completion markers (terminal hits) */}
      {completionMarkers.map((min, i) => {
        const x = xOf(min)
        return (
          <g key={i}>
            <line x1={x} y1={BAR_Y - 2} x2={x} y2={BAR_Y + BAR_H + 2}
              stroke="white" strokeWidth="2" />
            <circle cx={x} cy={BAR_Y - 6} r="5" fill="#059669" />
            <text x={x} y={BAR_Y - 3} textAnchor="middle" fill="white" fontSize="7" fontWeight="bold">✓</text>
          </g>
        )
      })}

      {/* Hour labels */}
      {Array.from({ length: hours + 1 }, (_, i) => {
        if (hours > 8 && i % 2 !== 0) return null
        const x = (i / hours) * plotW
        return (
          <text key={i} x={x} y={LABEL_Y} textAnchor="middle" fill="#94A3B8" fontSize="7.5">
            {workStart + i}:00
          </text>
        )
      })}
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────

export function DataAnalytics({ user }: Props) {
  const navigate = useNavigate()
  const [board, setBoard] = useState<BoardData | null>(null)
  const [events, setEvents] = useState<Event[]>([])
  const [todayHistory, setTodayHistory] = useState<TodayHistoryEntry[]>([])
  const [workStart, setWorkStart] = useState(8)
  const [workEnd, setWorkEnd] = useState(18)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d')

  useEffect(() => {
    async function load() {
      setLoading(true)
      if (isDemoMode) {
        setBoard(DEMO_BOARD)
        setEvents(DEMO_EVENTS)
        setLoading(false)
        return
      }
      const [boardRes, eventsRes] = await Promise.all([
        supabase.rpc('get_board'),
        supabase.rpc('get_events', { p_limit: 500 }),
      ])
      const historyRes = await supabase.rpc('get_today_line_history').then(r => r, () => ({ data: null }))
      const settingsRes = await supabase.rpc('get_settings').then(r => r, () => ({ data: null }))
      setBoard((boardRes.data as BoardData) ?? null)
      setEvents((eventsRes.data as Event[]) ?? [])
      setTodayHistory((historyRes.data as TodayHistoryEntry[]) ?? [])
      if (settingsRes.data) {
        const s = settingsRes.data as any
        if (s.work_start) setWorkStart(parseInt(s.work_start.split(':')[0]))
        if (s.work_end)   setWorkEnd(parseInt(s.work_end.split(':')[0]))
      }
      setLoading(false)
    }
    load()
  }, [])

  // ── computed analytics ─────────────────────────────

  const allLines = useMemo(() => {
    if (!board) return [] as Line[]
    return board.subdivisions.flatMap(s => s.lines)
  }, [board])

  const activeLines = useMemo(() => allLines.filter(l => l.is_active), [allLines])

  const completionRate = useMemo(() => {
    if (activeLines.length === 0) return 0
    return pct(activeLines.filter(l => l.status?.is_terminal).length, activeLines.length)
  }, [activeLines])

  const stoppedCount = useMemo(() =>
    activeLines.filter(l => l.status?.name === 'Зупинка').length,
    [activeLines])

  const todayEvents = useMemo(() => {
    const now = new Date()
    return events.filter(e => new Date(e.created_at).toDateString() === now.toDateString()).length
  }, [events])

  // Events over time (for area chart)
  const eventsOverTime = useMemo(() => {
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 90
    const buckets: { label: string; value: number; prevValue: number }[] = []
    const now = Date.now()
    const msPerDay = 86400000

    for (let i = days - 1; i >= 0; i--) {
      const dayStart = now - (i + 1) * msPerDay
      const dayEnd = now - i * msPerDay
      const prevDayStart = dayStart - days * msPerDay
      const prevDayEnd = dayEnd - days * msPerDay

      const count = events.filter(e => {
        const t = new Date(e.created_at).getTime()
        return t >= dayStart && t < dayEnd
      }).length
      const prevCount = events.filter(e => {
        const t = new Date(e.created_at).getTime()
        return t >= prevDayStart && t < prevDayEnd
      }).length

      const date = new Date(dayEnd)
      const label = days <= 7
        ? DAY_NAMES[date.getDay()]
        : `${date.getDate()}.${(date.getMonth() + 1).toString().padStart(2, '0')}`

      // Only show every Nth label for readability
      const showLabel = days <= 7 || (days <= 30 ? i % 5 === 0 : i % 15 === 0)
      buckets.push({ label: showLabel ? label : '', value: count, prevValue: prevCount })
    }
    return buckets
  }, [events, period])

  // Events by day of week
  const eventsByDay = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0, 0]
    events.forEach(e => {
      const day = new Date(e.created_at).getDay()
      counts[day]++
    })
    const maxIdx = counts.indexOf(Math.max(...counts))
    return { data: DAY_NAMES.map((label, i) => ({ label, value: counts[i] })), activeIndex: maxIdx }
  }, [events])

  // Per-subdivision stats
  const subdivisionStats = useMemo(() => {
    if (!board) return []
    const colors = ['#6366F1', '#F59E0B', '#10B981', '#EF4444', '#8B5CF6', '#EC4899']
    return board.subdivisions.map((sub, i) => {
      const active = sub.lines.filter(l => l.is_active)
      const done = active.filter(l => l.status?.is_terminal).length
      return { name: sub.name, total: active.length, done, color: colors[i % colors.length] }
    })
  }, [board])

  // Status distribution (for donut-like display)
  const statusBreakdown = useMemo(() => {
    if (!board) return []
    const result: { name: string; count: number; color: string; icon: string }[] = []
    for (const st of board.statuses) {
      const count = activeLines.filter(l => l.status?.id === st.id).length
      if (count > 0) {
        const icons: Record<string, string> = { 'Початок': '🏭', 'Фасування': '📦', 'Зупинка': '🔴', 'Завершено': '✅' }
        result.push({ name: st.name, count, color: st.color, icon: icons[st.name] ?? '📊' })
      }
    }
    const noStatus = activeLines.filter(l => !l.status).length
    if (noStatus > 0) result.push({ name: 'Без статусу', count: noStatus, color: '#D1D5DB', icon: '⬜' })
    return result
  }, [board, activeLines])

  // Top users
  const topUsers = useMemo(() => {
    const map = new Map<string, number>()
    for (const ev of events) {
      if (ev.user_name) map.set(ev.user_name, (map.get(ev.user_name) ?? 0) + 1)
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [events])

  // Change percentages (simulate from events count)
  const totalEventsChange = useMemo(() => {
    const now = Date.now()
    const msPerDay = 86400000
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 90
    const current = events.filter(e => (now - new Date(e.created_at).getTime()) < days * msPerDay).length
    const prev = events.filter(e => {
      const t = now - new Date(e.created_at).getTime()
      return t >= days * msPerDay && t < days * 2 * msPerDay
    }).length
    return prev === 0 ? (current > 0 ? 100 : 0) : ((current - prev) / prev) * 100
  }, [events, period])

  // ── render ─────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      <div className="max-w-screen-xl mx-auto px-2 sm:px-4 pt-2 sm:pt-4 space-y-3">

        {/* Header */}
        <div className="flex items-center justify-between bg-white rounded-2xl px-4 py-3 shadow-sm border border-gray-100">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/')}
              className="p-2 -ml-2 rounded-xl hover:bg-gray-100 active:bg-gray-200 transition-colors">
              <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-800">Дашборд</h1>
                <p className="text-xs text-gray-400">Data Analytics</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Period selector */}
            <div className="flex bg-gray-100 rounded-xl p-0.5">
              {(['7d', '30d', '90d'] as const).map(p => (
                <button key={p} onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    period === p ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}>
                  {p === '7d' ? '7 днів' : p === '30d' ? '30 днів' : '90 днів'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          <KpiCard
            title="Всього ліній"
            value={activeLines.length}
            change={4.4}
            icon={<svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>}
            iconBg="bg-blue-50"
          />
          <KpiCard
            title="Завершено"
            value={`${completionRate}%`}
            change={completionRate > 50 ? 8.4 : -3.2}
            icon={<svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>}
            iconBg="bg-green-50"
          />
          <KpiCard
            title="Зупинки"
            value={stoppedCount}
            change={stoppedCount > 0 ? -10.5 : 0}
            icon={<svg className="w-4 h-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>}
            iconBg="bg-red-50"
          />
          <KpiCard
            title="Подій сьогодні"
            value={todayEvents}
            change={totalEventsChange}
            icon={<svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>}
            iconBg="bg-amber-50"
          />
        </div>

        {/* Main charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* Area chart - events over time */}
          <div className="lg:col-span-2 bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-semibold text-gray-800">Активність подій</h2>
                <div className="flex items-center gap-4 mt-1">
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-[2px] bg-indigo-500 rounded-full" />
                    <span className="text-xs text-gray-400">Поточний період</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-[2px] bg-gray-300 rounded-full border-dashed" />
                    <span className="text-xs text-gray-400">Попередній</span>
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-gray-800">{events.length}</div>
                <span className={`text-xs font-semibold ${totalEventsChange >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {totalEventsChange >= 0 ? '▲' : '▼'} {Math.abs(totalEventsChange).toFixed(1)}%
                </span>
              </div>
            </div>
            <AreaChart data={eventsOverTime} color="#6366F1" />
          </div>

          {/* Day of week activity */}
          <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-800">Активність по днях</h2>
              <button className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                </svg>
              </button>
            </div>
            <VerticalBarChart data={eventsByDay.data} activeIndex={eventsByDay.activeIndex} />
          </div>
        </div>

        {/* Status breakdown + Gauge */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* Status cards */}
          <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-gray-100">
            <h2 className="text-base font-semibold text-gray-800 mb-4">Розподіл статусів</h2>
            <div className="space-y-3">
              {statusBreakdown.map(s => {
                const total = activeLines.length
                const w = total === 0 ? 0 : (s.count / total) * 100
                return (
                  <div key={s.name} className="flex items-center gap-3">
                    <span className="text-lg w-7 text-center">{s.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-sm font-medium text-gray-700">{s.count}</span>
                        <span className="text-xs text-gray-400">{s.name}</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${w}%`, backgroundColor: s.color }} />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Completion rate gauge */}
          <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-gray-100 flex flex-col items-center justify-center">
            <div className="flex items-center w-full mb-2">
              <h2 className="text-base font-semibold text-gray-800">Рівень завершення</h2>
            </div>
            <GaugeChart value={completionRate} target={80} label="" />
          </div>

          {/* Subdivision progress */}
          <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-gray-100">
            <h2 className="text-base font-semibold text-gray-800 mb-4">Прогрес підрозділів</h2>
            <SubdivisionBars stats={subdivisionStats} />
          </div>
        </div>

        {/* Table + Top users */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* Production table */}
          <div className="lg:col-span-2 bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-gray-100">
            <div className="flex items-center mb-4">
              <h2 className="text-base font-semibold text-gray-800">Топ ліній виробництва</h2>
            </div>
            <ProductionTable lines={activeLines} events={events} />
          </div>

          {/* Top users */}
          <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-gray-100">
            <h2 className="text-base font-semibold text-gray-800 mb-4">Активні оператори</h2>
            {topUsers.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-8">Немає даних</p>
            ) : (
              <div className="space-y-3">
                {topUsers.map(([name, count], i) => {
                  const maxCount = topUsers[0][1]
                  const w = (count / maxCount) * 100
                  const colors = ['#6366F1', '#8B5CF6', '#A78BFA', '#C4B5FD', '#DDD6FE']
                  const initials = name.split(' ').map(s => s[0]).join('').slice(0, 2)
                  return (
                    <div key={name} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                        style={{ backgroundColor: colors[i] ?? '#DDD6FE' }}>
                        {initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between mb-1">
                          <span className="text-sm font-medium text-gray-700 truncate">{name}</span>
                          <span className="text-sm font-bold text-gray-700">{count}</span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-700"
                            style={{ width: `${w}%`, backgroundColor: colors[i] ?? '#DDD6FE' }} />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Process per card — colored status timeline */}
        <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-gray-800">Процес по картках за день</h2>
            </div>
            <span className="text-xs text-gray-400">
              {new Date().toLocaleDateString('uk-UA', { day: '2-digit', month: 'long' })}
            </span>
          </div>

          {activeLines.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-8">Немає активних ліній</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {activeLines.map((line) => {
                const statusName  = line.status?.name ?? null
                const statusColor = line.status?.color ?? '#94A3B8'

                const lineHistory = todayHistory.filter(h => h.line_id === line.id)
                const completionsToday = lineHistory.filter(h => h.new_status_is_terminal).length

                // Build colored timeline segments
                const segments = buildTimelineSegments(
                  lineHistory, statusName, statusColor, workStart, workEnd,
                )

                // Completion marker positions (minutes since workStart)
                const workDurationMin = (workEnd - workStart) * 60
                const completionMarkers = lineHistory
                  .filter(h => h.new_status_is_terminal)
                  .map(h => {
                    const d = new Date(h.created_at)
                    return Math.max(0, Math.min(workDurationMin,
                      (d.getHours() - workStart) * 60 + d.getMinutes()))
                  })

                // Unique statuses today with total minutes + color (for legend)
                const seenMap = new Map<string, { name: string; color: string; minutes: number; isTerminal: boolean }>()
                for (const seg of segments) {
                  if (!seg.statusName) continue
                  const dur = seg.endMin - seg.startMin
                  const existing = seenMap.get(seg.statusName)
                  if (existing) existing.minutes += dur
                  else seenMap.set(seg.statusName, {
                    name: seg.statusName,
                    color: seg.color,
                    minutes: dur,
                    isTerminal: seg.isTerminal,
                  })
                }
                const legendItems = [...seenMap.values()]

                const formatDur = (min: number) =>
                  min >= 60
                    ? `${Math.floor(min / 60)}г ${min % 60}хв`
                    : `${min}хв`

                return (
                  <div key={line.id} className="bg-gray-50/60 rounded-xl p-3.5 border border-gray-100/80">

                    {/* Card header */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-3 h-3 rounded-full flex-shrink-0 ring-2 ring-white shadow-sm"
                          style={{ backgroundColor: statusColor }}
                        />
                        <span className="text-sm font-semibold text-gray-800 truncate">{line.name}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        {completionsToday > 0 && (
                          <span className="flex items-center gap-1 text-xs bg-emerald-100 text-emerald-700 font-bold px-2 py-0.5 rounded-full">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                            ×{completionsToday}
                          </span>
                        )}
                        {line.status ? (
                          <span
                            className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                            style={{ backgroundColor: statusColor + '22', color: statusColor }}
                          >
                            {statusName}
                          </span>
                        ) : (
                          <span className="text-[11px] text-gray-400">Без статусу</span>
                        )}
                      </div>
                    </div>

                    {/* Colored timeline bar */}
                    {segments.length > 0 ? (
                      <div className="mt-1">
                        <ColoredTimelineBar
                          segments={segments}
                          completionMarkers={completionMarkers}
                          workStart={workStart}
                          workEnd={workEnd}
                        />
                      </div>
                    ) : (
                      <div className="h-10 bg-gray-100 rounded-lg flex items-center justify-center my-1">
                        <span className="text-xs text-gray-400">Немає змін статусів за сьогодні</span>
                      </div>
                    )}

                    {/* Status legend with durations */}
                    {legendItems.length > 0 && (
                      <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-2.5">
                        {legendItems.map(s => (
                          <span key={s.name} className="flex items-center gap-1.5 text-[11px] text-gray-600">
                            <span
                              className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                              style={{ backgroundColor: s.color, opacity: 0.88 }}
                            />
                            <span className="font-medium" style={{ color: s.color }}>{s.name}</span>
                            <span className="text-gray-400">{formatDur(s.minutes)}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
