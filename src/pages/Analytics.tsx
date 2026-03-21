import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { User, BoardData, Event, Subdivision, Line, TaskStatus } from '../types'
import { supabase } from '../lib/supabase'
import { isDemoMode, DEMO_BOARD, DEMO_EVENTS } from '../lib/demoData'

interface Props { user: User }

// ── helpers ──────────────────────────────────────────────────

function pct(value: number, total: number) {
  return total === 0 ? 0 : Math.round((value / total) * 100)
}

function fmtTime(sec: number) {
  if (sec < 60) return `${sec}с`
  if (sec < 3600) return `${Math.floor(sec / 60)}хв`
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return m ? `${h}г ${m}хв` : `${h}г`
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

// ── Bar chart (horizontal) ───────────────────────────────────

function HBar({ label, value, max, color, suffix = '' }: {
  label: string; value: number; max: number; color: string; suffix?: string
}) {
  const w = max === 0 ? 0 : Math.max(4, (value / max) * 100)
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-28 text-gray-600 truncate text-right">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${w}%`, backgroundColor: color }} />
      </div>
      <span className="w-12 text-gray-700 font-medium text-right">{value}{suffix}</span>
    </div>
  )
}

// ── Donut chart (SVG) ────────────────────────────────────────

function Donut({ segments, size = 140 }: {
  segments: { value: number; color: string; label: string }[]; size?: number
}) {
  const total = segments.reduce((s, seg) => s + seg.value, 0)
  if (total === 0) return <p className="text-gray-400 text-sm text-center py-6">Немає даних</p>
  const r = 50, cx = 60, cy = 60, stroke = 18
  let offset = 0
  const circ = 2 * Math.PI * r
  return (
    <div className="flex flex-col items-center gap-3">
      <svg width={size} height={size} viewBox="0 0 120 120">
        {segments.filter(s => s.value > 0).map((seg, i) => {
          const dash = (seg.value / total) * circ
          const el = (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none"
              stroke={seg.color} strokeWidth={stroke}
              strokeDasharray={`${dash} ${circ - dash}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${cx} ${cy})`}
              className="transition-all duration-700" />
          )
          offset += dash
          return el
        })}
        <text x={cx} y={cy + 4} textAnchor="middle" className="text-lg font-bold fill-gray-700" fontSize="18">
          {total}
        </text>
      </svg>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
        {segments.filter(s => s.value > 0).map((seg, i) => (
          <div key={i} className="flex items-center gap-1 text-xs text-gray-600">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: seg.color }} />
            {seg.label}: {seg.value} ({pct(seg.value, total)}%)
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Smooth area sparkline ────────────────────────────────────

function SmoothSparkline({ data, color = '#6366F1' }: { data: number[]; color?: string }) {
  if (data.length < 2) return (
    <p className="text-xs text-gray-400 text-center py-4">Немає даних</p>
  )
  const W = 300, H = 72, PAD = 6
  const max = Math.max(...data, 1)
  const pts: [number, number][] = data.map((v, i) => [
    PAD + (i / (data.length - 1)) * (W - PAD * 2),
    H - PAD - (v / max) * (H - PAD * 2),
  ])

  // smooth bezier path
  let linePath = `M ${pts[0][0]},${pts[0][1]}`
  for (let i = 1; i < pts.length; i++) {
    const px = pts[i - 1], cx = pts[i]
    const cpx = (px[0] + cx[0]) / 2
    linePath += ` C ${cpx},${px[1]} ${cpx},${cx[1]} ${cx[0]},${cx[1]}`
  }
  // area fill (close to bottom)
  const areaPath = `${linePath} L ${pts[pts.length - 1][0]},${H} L ${pts[0][0]},${H} Z`
  const gradId = 'sparkGrad'

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible" preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* area */}
      <path d={areaPath} fill={`url(#${gradId})`} />
      {/* line */}
      <path d={linePath} fill="none" stroke={color} strokeWidth="2.2"
        strokeLinecap="round" strokeLinejoin="round" />
      {/* dots only on non-zero values */}
      {pts.map(([x, y], i) => data[i] > 0 && (
        <circle key={i} cx={x} cy={y} r="3" fill={color} />
      ))}
    </svg>
  )
}

// ── Main component ───────────────────────────────────────────

export function Analytics({ user }: Props) {
  const navigate = useNavigate()
  const [board, setBoard] = useState<BoardData | null>(null)
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)

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
        supabase.rpc('get_events', { p_limit: 200 }),
      ])
      setBoard((boardRes.data as BoardData) ?? null)
      setEvents((eventsRes.data as Event[]) ?? [])
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

  // status breakdown
  const statusCounts = useMemo(() => {
    const map = new Map<string, { count: number; color: string; name: string }>()
    if (board) {
      for (const st of board.statuses) {
        map.set(st.id, { count: 0, color: st.color, name: st.name })
      }
      map.set('none', { count: 0, color: '#D1D5DB', name: 'Без статусу' })
    }
    for (const l of activeLines) {
      const key = l.status?.id ?? 'none'
      const entry = map.get(key)
      if (entry) entry.count++
    }
    return map
  }, [board, activeLines])

  // per-subdivision stats
  const subdivisionStats = useMemo(() => {
    if (!board) return [] as { sub: Subdivision; total: number; done: number; stopped: number; active: number }[]
    return board.subdivisions.map(sub => {
      const active = sub.lines.filter(l => l.is_active)
      const done = active.filter(l => l.status?.is_terminal).length
      const stopped = active.filter(l => l.status?.name === 'Зупинка').length
      return { sub, total: active.length, done, stopped, active: active.length - done - stopped }
    })
  }, [board])

  // events per hour — working day 07:00 → 22:00
  const eventsPerHour = useMemo(() => {
    const DAY_START = 8, DAY_END = 21
    const buckets = Array.from({ length: DAY_END - DAY_START + 1 }, () => 0)
    const today = new Date().toDateString()
    for (const ev of events) {
      const d = new Date(ev.created_at)
      if (d.toDateString() !== today) continue
      const h = d.getHours()
      if (h >= DAY_START && h <= DAY_END) buckets[h - DAY_START]++
    }
    return buckets
  }, [events])

  const dayStartLabel = '08:00'
  const dayEndLabel = '21:00'

  // top users by events
  const topUsers = useMemo(() => {
    const map = new Map<string, number>()
    for (const ev of events) {
      if (ev.user_name) map.set(ev.user_name, (map.get(ev.user_name) ?? 0) + 1)
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [events])

  // completion rate
  const completionRate = useMemo(() => {
    if (activeLines.length === 0) return 0
    return pct(activeLines.filter(l => l.status?.is_terminal).length, activeLines.length)
  }, [activeLines])

  // lines with longest time since update
  const stalestLines = useMemo(() => {
    return [...activeLines]
      .filter(l => l.updated_at)
      .sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime())
      .slice(0, 5)
  }, [activeLines])

  // ── render ─────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const maxUserEvents = topUsers.length > 0 ? topUsers[0][1] : 0

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      <div className="max-w-screen-xl mx-auto px-2 sm:px-4 pt-2 sm:pt-4 space-y-3">

        {/* Header */}
        <div className="flex items-center gap-3 bg-white rounded-2xl px-4 py-3 shadow-sm border border-gray-100">
          <button onClick={() => navigate('/')}
            className="p-2 -ml-2 rounded-xl hover:bg-gray-100 active:bg-gray-200 transition-colors">
            <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <h1 className="text-lg font-bold text-gray-800">Аналітика</h1>
          </div>
        </div>

        {/* KPI cards row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <KpiCard label="Всього ліній" value={activeLines.length} icon="📊" accent="indigo" />
          <KpiCard label="Завершено" value={`${completionRate}%`} icon="✅" accent="green" />
          <KpiCard label="Зупинки"
            value={activeLines.filter(l => l.status?.name === 'Зупинка').length}
            icon="🔴" accent="red" />
          <KpiCard label="Подій сьогодні" value={events.filter(e => {
            const d = new Date(e.created_at)
            const now = new Date()
            return d.toDateString() === now.toDateString()
          }).length} icon="⚡" accent="amber" />
        </div>

        {/* Donut + Completion by subdivision */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Status distribution donut */}
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Розподіл за статусами</h2>
            <Donut segments={[...statusCounts.values()].map(v => ({
              value: v.count, color: v.color, label: v.name,
            }))} />
          </div>

          {/* Per-subdivision completion */}
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Прогрес по підрозділах</h2>
            <div className="space-y-3">
              {subdivisionStats.map(({ sub, total, done }) => (
                <div key={sub.id}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600 font-medium">{sub.name}</span>
                    <span className="text-gray-500">{done}/{total}</span>
                  </div>
                  <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-indigo-400 to-indigo-600 rounded-full transition-all duration-700"
                      style={{ width: `${pct(done, total)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Events activity + Top users */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Activity sparkline */}
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Активність</h2>
            <SmoothSparkline data={eventsPerHour} color="#6366F1" />
            <div className="flex justify-between text-[10px] text-gray-400 mt-1 px-1">
              <span>{dayStartLabel}</span>
              <span>{dayEndLabel}</span>
            </div>
          </div>

          {/* Top users */}
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Активні користувачі</h2>
            {topUsers.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-4">Немає даних</p>
            ) : (
              <div className="space-y-2">
                {topUsers.map(([name, count], i) => (
                  <HBar key={name} label={name} value={count}
                    max={maxUserEvents}
                    color={['#6366F1', '#8B5CF6', '#A78BFA', '#C4B5FD', '#DDD6FE'][i] ?? '#DDD6FE'} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Subdivision status heatmap */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Статуси ліній по підрозділах</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 pr-4 text-gray-500 font-medium">Підрозділ</th>
                  {board?.statuses.map(st => (
                    <th key={st.id} className="text-center py-2 px-2">
                      <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: st.color }} />
                      <span className="block text-[10px] text-gray-400 mt-0.5">{st.name}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {board?.subdivisions.map(sub => {
                  const active = sub.lines.filter(l => l.is_active)
                  return (
                    <tr key={sub.id} className="border-b border-gray-50">
                      <td className="py-2 pr-4 text-gray-700 font-medium">{sub.name}</td>
                      {board.statuses.map(st => {
                        const count = active.filter(l => l.status?.id === st.id).length
                        return (
                          <td key={st.id} className="text-center py-2 px-2">
                            {count > 0 ? (
                              <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-white text-xs font-bold"
                                style={{ backgroundColor: st.color }}>
                                {count}
                              </span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  )
}

// ── KPI card ─────────────────────────────────────────────────

function KpiCard({ label, value, icon, accent }: {
  label: string; value: string | number; icon: string; accent: string
}) {
  const bg: Record<string, string> = {
    indigo: 'bg-indigo-50 border-indigo-100',
    green: 'bg-green-50 border-green-100',
    red: 'bg-red-50 border-red-100',
    amber: 'bg-amber-50 border-amber-100',
  }
  const text: Record<string, string> = {
    indigo: 'text-indigo-700',
    green: 'text-green-700',
    red: 'text-red-700',
    amber: 'text-amber-700',
  }
  return (
    <div className={`rounded-2xl p-3 border shadow-sm ${bg[accent] ?? 'bg-gray-50 border-gray-100'}`}>
      <div className="text-lg mb-1">{icon}</div>
      <div className={`text-2xl font-bold ${text[accent] ?? 'text-gray-700'}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  )
}
