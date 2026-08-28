import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { CrmWorkHours } from '../components/CrmWorkHours'
import type { User, CrmTodayData, CrmAnalytics, CrmDailyPoint, CrmMonthlyUserBonus, CrmEntry, CrmWorker } from '../types'

interface Props {
  user: User
  onLogout: () => void
}

type Tab = 'input' | 'analytics' | 'chart' | 'work-hours' | 'records'
type ChartPeriod = '1d' | '7d' | '30d'
type CrmBonusRow = { user_id: string; user_name: string; orders: number; bonus: number; days_active: number }

// ─── Helpers ──────────────────────────────────────────────────────────────────
function toDateInputValue(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}` // YYYY-MM-DD for <input type="date">
}

function parseDateInputValue(value: string) {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function addDays(d: Date, days: number) {
  const copy = new Date(d)
  copy.setDate(copy.getDate() + days)
  return copy
}

function formatDisplayDate(iso: string) {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y.slice(2)}`
}

function getDateRangeDays(start: string, end: string) {
  const startDate = parseDateInputValue(start)
  const endDate = parseDateInputValue(end)
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate > endDate) return []

  const days: string[] = []
  for (let d = startDate; d <= endDate; d = addDays(d, 1)) {
    days.push(toDateInputValue(d))
  }
  return days
}

function startOfWeek(d: Date) {
  const copy = new Date(d)
  const day = (copy.getDay() + 6) % 7
  copy.setDate(copy.getDate() - day)
  return copy
}

function endOfWeek(d: Date) {
  const copy = startOfWeek(d)
  copy.setDate(copy.getDate() + 6)
  return copy
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0)
}

function getPeriodRange(period: ChartPeriod, date: string) {
  const anchor = parseDateInputValue(date)
  const today = new Date()
  const start = period === '7d'
    ? startOfWeek(anchor)
    : period === '30d'
      ? startOfMonth(anchor)
      : anchor
  const rawEnd = period === '7d'
    ? endOfWeek(anchor)
    : period === '30d'
      ? endOfMonth(anchor)
      : anchor
  const end = rawEnd > today ? today : rawEnd
  return {
    start: toDateInputValue(start),
    end: toDateInputValue(end),
  }
}

function getPeriodLabel(period: ChartPeriod) {
  if (period === '1d') return '1 день'
  if (period === '7d') return 'Тиждень'
  return 'Місяць'
}

function getKpiPeriodLabel(period: ChartPeriod, isToday: boolean, date: string) {
  if (period === '1d') return `ККД за ${isToday ? 'сьогодні' : formatDisplayDate(date)}`
  const { start, end } = getPeriodRange(period, date)
  const label = start === end ? formatDisplayDate(start) : `${formatDisplayDate(start)}–${formatDisplayDate(end)}`
  return period === '7d' ? `ККД за тиждень ${label}` : `ККД за місяць ${label}`
}

function getPeriodRangeLabel(period: ChartPeriod, date: string) {
  const { start, end } = getPeriodRange(period, date)
  return start === end ? formatDisplayDate(start) : `${formatDisplayDate(start)}–${formatDisplayDate(end)}`
}

function shiftAnalyticsDate(date: string, period: ChartPeriod, direction: -1 | 1) {
  const d = parseDateInputValue(date)
  if (period === '30d') {
    d.setMonth(d.getMonth() + direction, 1)
  } else {
    d.setDate(d.getDate() + direction * (period === '7d' ? 7 : 1))
  }
  const next = toDateInputValue(d)
  const today = toDateInputValue(new Date())
  return next > today ? today : next
}

function isCurrentAnalyticsPeriod(days: number, date: string) {
  const today = toDateInputValue(new Date())
  if (days === 1) return date === today
  if (days === 7) return getPeriodRange('7d', date).start === getPeriodRange('7d', today).start
  if (days === 30) return getPeriodRange('30d', date).start === getPeriodRange('30d', today).start
  return date === today
}

function getTabLabel(tab: Tab) {
  if (tab === 'analytics') return 'Аналітика'
  if (tab === 'chart') return 'Графік'
  if (tab === 'work-hours') return 'Перегляд'
  if (tab === 'records') return 'Записи'
  return 'Введення даних'
}

// ─── Bonus calculation ────────────────────────────────────────────────────────
interface BonusSettings { threshold: number; rate_mid: number; rate_high: number }
// threshold=80: ≤80 → 0, 81–100 → (orders−80)×rate_mid, 101+ → (orders−80)×rate_high
// e.g. 81 orders → 6 грн, 101 orders → 168 грн
const DEFAULT_BONUS: BonusSettings = { threshold: 80, rate_mid: 6, rate_high: 8 }

function calcBonus(orders: number, s: BonusSettings = DEFAULT_BONUS): number {
  if (orders <= s.threshold) return 0
  if (orders <= 100) return (orders - s.threshold) * s.rate_mid
  return (orders - s.threshold) * s.rate_high
}

// ─── Mini bar chart ───────────────────────────────────────────────────────────
function MiniBarChart({ data, color, label }: {
  data: CrmDailyPoint[]
  color: 'emerald' | 'blue'
  label: 'orders' | 'units'
}) {
  const values = data.map(d => (label === 'orders' ? d.orders : d.units))
  const max = Math.max(...values, 1)
  const W = 320
  const H = 80
  const barW = Math.floor((W - (data.length - 1) * 2) / data.length)
  const gradId = color === 'emerald' ? 'barGradEmerald' : 'barGradBlue'

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
      <defs>
        {color === 'emerald' ? (
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#86efac" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#14532d" stopOpacity="0.95" />
          </linearGradient>
        ) : (
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#bfdbfe" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#3b0764" stopOpacity="0.95" />
          </linearGradient>
        )}
      </defs>
      {data.map((d, i) => {
        const v = label === 'orders' ? d.orders : d.units
        const bh = Math.max((v / max) * (H - 4), v > 0 ? 4 : 0)
        const x = i * (barW + 2)
        return <rect key={i} x={x} y={H - bh} width={barW} height={bh} rx={2} fill={`url(#${gradId})`} />
      })}
    </svg>
  )
}

// ─── KPI bar ──────────────────────────────────────────────────────────────────
function KpiBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  const gradient = color === '#10b981'
    ? 'linear-gradient(90deg, #86efac 0%, #16a34a 40%, #14532d 100%)'
    : 'linear-gradient(90deg, #bfdbfe 0%, #6d28d9 40%, #3b0764 100%)'
  return (
    <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1">
      <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, background: gradient }} />
    </div>
  )
}

// ─── Smooth orders chart ──────────────────────────────────────────────────────
function SmoothOrdersChart({ data }: { data: CrmDailyPoint[] }) {
  const W = 640
  const H = 240
  const PAD_X = 34
  const PAD_TOP = 28
  const PAD_BOTTOM = 34
  const max = Math.max(...data.map(d => d.orders), 1)
  const plotW = W - PAD_X * 2
  const plotH = H - PAD_TOP - PAD_BOTTOM

  if (data.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-10">Немає даних за вибраний період</p>
  }

  const points = data.map((d, i) => {
    const x = data.length === 1 ? W / 2 : PAD_X + (i / (data.length - 1)) * plotW
    const y = PAD_TOP + plotH * (1 - d.orders / max)
    return { x, y, value: d.orders, date: d.date }
  })

  const linePath = points.reduce((path, p, i) => {
    if (i === 0) return `M ${p.x},${p.y}`
    const prev = points[i - 1]
    const midX = (prev.x + p.x) / 2
    return `${path} C ${midX},${prev.y} ${midX},${p.y} ${p.x},${p.y}`
  }, '')
  const areaPath = `${linePath} L ${points[points.length - 1].x},${H - PAD_BOTTOM} L ${points[0].x},${H - PAD_BOTTOM} Z`
  const grid = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const y = PAD_TOP + plotH * (1 - f)
    return { y, value: Math.round(max * f) }
  })
  const total = data.reduce((s, d) => s + d.orders, 0)
  const average = data.length > 0 ? total / data.length : 0

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl p-4 bg-emerald-50/80 border border-emerald-100">
          <p className="text-xs text-gray-400 mb-1">Всього замовлень</p>
          <p className="text-3xl font-extrabold text-emerald-700">{total}</p>
        </div>
        <div className="rounded-2xl p-4 bg-blue-50/80 border border-blue-100">
          <p className="text-xs text-gray-400 mb-1">Середнє за день</p>
          <p className="text-3xl font-extrabold text-blue-700">{average.toFixed(1)}</p>
        </div>
      </div>

      <div className="rounded-3xl p-4 shadow-md backdrop-blur-sm border border-white/80 bg-gradient-to-br from-white/90 via-emerald-50/70 to-sky-50/80">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="ordersLineGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#10b981" />
              <stop offset="55%" stopColor="#0ea5e9" />
              <stop offset="100%" stopColor="#2563eb" />
            </linearGradient>
            <linearGradient id="ordersAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {grid.map((g, i) => (
            <g key={i}>
              <line x1={PAD_X} x2={W - PAD_X} y1={g.y} y2={g.y} stroke="#dbeafe" strokeWidth="1" strokeDasharray="4 5" />
              <text x={PAD_X - 8} y={g.y + 4} textAnchor="end" className="fill-gray-400" fontSize="11">{g.value}</text>
            </g>
          ))}

          <path d={areaPath} fill="url(#ordersAreaGrad)" />
          <path d={linePath} fill="none" stroke="url(#ordersLineGrad)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />

          {points.map((p, i) => (
            <g key={p.date}>
              {(data.length <= 14 || i === 0 || i === data.length - 1 || i % Math.ceil(data.length / 6) === 0) && (
                <text x={p.x} y={H - 11} textAnchor="middle" className="fill-gray-400" fontSize="11">
                  {p.date.slice(5)}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>

    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
export function CrmWarehouse({ user, onLogout }: Props) {
  const navigate = useNavigate()
  const isAdmin = user.role === 'admin' || user.role === 'super_admin' || user.role === 'ceo' || user.role === 'crm_admin'

  const isCrm = user.role === 'crm'
  const isCeo = user.role === 'ceo'
  const isSuperAdmin = user.role === 'super_admin'
  const canManageCrm = (isSuperAdmin || user.role === 'admin') && user.pin === '1505'
  const canViewCrmHours = canManageCrm || user.role === 'crm_admin'
  const canViewCrmRecords = isSuperAdmin || user.role === 'crm_admin'
  const isAdminWithCrmAccess = isSuperAdmin ||
    (user.role === 'admin' && (user.pin === '1505' || user.pin === '7985'))
  // ceo бачить аналітику але без бонусів і налаштувань
  const showBonusAsAdmin = user.role === 'crm_admin' || isAdminWithCrmAccess
  // super_admin/admin/crm_admin/ceo: default analytics; crm: input only
  const [tab, setTab] = useState<Tab>(isCrm ? 'input' : 'analytics')
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>('30d')

  const [crmWorkers, setCrmWorkers] = useState<CrmWorker[]>([])
  const [selectedCrmUserId, setSelectedCrmUserId] = useState('')
  const [loadingWorkers, setLoadingWorkers] = useState(false)
  const [workersError, setWorkersError] = useState('')

  // Input form
  const [orders, setOrders] = useState('')
  const [units, setUnits] = useState('')
  const [selectedDate, setSelectedDate] = useState(toDateInputValue(new Date()))
  const [submitting, setSubmitting] = useState(false)
  const [submitSuccess, setSubmitSuccess] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [editingEntry, setEditingEntry] = useState<CrmEntry | null>(null)
  const [editOrders, setEditOrders] = useState('')
  const [editUnits, setEditUnits] = useState('')
  const [savingEntry, setSavingEntry] = useState(false)

  // Analytics date picker
  const [analyticsDate, setAnalyticsDate] = useState(toDateInputValue(new Date()))
  const todayValue = toDateInputValue(new Date())
  const [graphStartDate, setGraphStartDate] = useState(toDateInputValue(addDays(new Date(), -29)))
  const [graphEndDate, setGraphEndDate] = useState(todayValue)
  const isAnalyticsToday = analyticsDate === todayValue
  const isAnalyticsCurrentPeriod = useMemo(() => {
    if (chartPeriod === '1d') return isAnalyticsToday
    return getPeriodRange(chartPeriod, analyticsDate).start === getPeriodRange(chartPeriod, todayValue).start
  }, [analyticsDate, chartPeriod, isAnalyticsToday, todayValue])

  // Data
  const [dayData, setDayData] = useState<CrmTodayData | null>(null)
  const [analyticsDayData, setAnalyticsDayData] = useState<CrmTodayData | null>(null)
  const [analytics, setAnalytics] = useState<CrmAnalytics | null>(null)
  const [recentEntries, setRecentEntries] = useState<CrmEntry[]>([])
  const [monthlyBonus, setMonthlyBonus] = useState<CrmMonthlyUserBonus[]>([])
  const [bonusSettings, setBonusSettings] = useState<BonusSettings>(DEFAULT_BONUS)
  const [editRateMid, setEditRateMid] = useState('')
  const [editRateHigh, setEditRateHigh] = useState('')
  const [savingRates, setSavingRates] = useState(false)
  const [showBonusSettings, setShowBonusSettings] = useState(false)
  const [showMonthlyBonus, setShowMonthlyBonus] = useState(false)
  const [loadingDay, setLoadingDay] = useState(true)
  const [loadingAnalytics, setLoadingAnalytics] = useState(false)
  const [analyticsError, setAnalyticsError] = useState('')
  const [analyticsBonusRows, setAnalyticsBonusRows] = useState<CrmBonusRow[]>([])
  const [loadingAnalyticsBonus, setLoadingAnalyticsBonus] = useState(false)
  const [graphData, setGraphData] = useState<CrmDailyPoint[]>([])
  const [loadingGraph, setLoadingGraph] = useState(false)
  const [graphError, setGraphError] = useState('')

  const isToday = selectedDate === toDateInputValue(new Date())

  // ── Fetch entries for selected date ─────────────────────────────────────────
  const fetchDay = useCallback(async (date: string) => {
    setLoadingDay(true)
    try {
      const { data } = await supabase.rpc('get_crm_today', {
        p_user_id: user.id,
        p_is_admin: isAdmin,
        p_date: date,
      })
      if (data) setDayData(data as CrmTodayData)
    } catch {/* ignore */} finally {
      setLoadingDay(false)
    }
  }, [user.id, isAdmin])

  const fetchAnalyticsDay = useCallback(async (date: string) => {
    try {
      const { data, error } = await supabase.rpc('get_crm_today', {
        p_user_id: user.id,
        p_is_admin: isAdmin,
        p_date: date,
      })
      if (error) throw error
      if (data) setAnalyticsDayData(data as CrmTodayData)
    } catch {
      setAnalyticsDayData(null)
    }
  }, [user.id, isAdmin])

  // ── Fetch analytics ─────────────────────────────────────────────────────────
  const fetchAnalytics = useCallback(async (days: number, date: string) => {
    setLoadingAnalytics(true)
    setAnalyticsError('')
    try {
      const { data, error } = await supabase.rpc('get_crm_analytics', {
        p_user_id: user.id,
        p_is_admin: isAdmin,
        p_days: days,
        p_date: date,
      })
      if (error) throw error
      if (data) setAnalytics(data as CrmAnalytics)
    } catch {
      const currentPeriod = isCurrentAnalyticsPeriod(days, date)
      try {
        const { data, error } = await supabase.rpc('get_crm_analytics', {
          p_user_id: user.id,
          p_is_admin: isAdmin,
          p_days: days,
        })
        if (error) throw error
        if (data) setAnalytics(data as CrmAnalytics)
        if (!currentPeriod) {
          setAnalyticsError('Для перегляду попередніх тижнів і місяців потрібно застосувати міграцію 022 у Supabase.')
        }
      } catch {
        setAnalytics(null)
        setAnalyticsError('Не вдалося завантажити аналітику. Перевірте, чи застосовані CRM SQL-міграції.')
      }
    } finally {
      setLoadingAnalytics(false)
    }
  }, [user.id, isAdmin])

  const fetchGraphData = useCallback(async (start: string, end: string) => {
    setLoadingGraph(true)
    setGraphError('')
    try {
      const days = getDateRangeDays(start, end)
      if (days.length === 0) {
        setGraphData([])
        setGraphError('Оберіть коректний проміжок дат')
        return
      }
      if (days.length > 210) {
        setGraphData([])
        setGraphError('Максимальний проміжок для графіка — 210 днів')
        return
      }

      const results = await Promise.all(days.map(async date => {
        const { data, error } = await supabase.rpc('get_crm_today', {
          p_user_id: user.id,
          p_is_admin: isAdmin,
          p_date: date,
        })
        if (error) throw error
        const row = (data ?? { total_orders: 0, total_units: 0 }) as CrmTodayData
        return {
          date,
          orders: row.total_orders ?? 0,
          units: row.total_units ?? 0,
        } as CrmDailyPoint
      }))
      setGraphData(results)
    } catch {
      setGraphData([])
      setGraphError('Не вдалося завантажити графік за вибраний період')
    } finally {
      setLoadingGraph(false)
    }
  }, [user.id, isAdmin])

  const fetchAnalyticsBonusRows = useCallback(async (period: ChartPeriod, date: string) => {
    if (!showBonusAsAdmin) {
      setAnalyticsBonusRows([])
      return
    }

    setLoadingAnalyticsBonus(true)
    try {
      const { start, end } = getPeriodRange(period, date)
      const days = getDateRangeDays(start, end)
      const byUser: Record<string, CrmBonusRow> = {}

      await Promise.all(days.map(async day => {
        const { data, error } = await supabase.rpc('get_crm_today', {
          p_user_id: user.id,
          p_is_admin: isAdmin,
          p_date: day,
        })
        if (error) throw error
        const row = data as CrmTodayData | null
        const dayByUser: Record<string, { user_id: string; user_name: string; orders: number }> = {}
        row?.entries?.forEach(entry => {
          if (!dayByUser[entry.user_id]) {
            dayByUser[entry.user_id] = {
              user_id: entry.user_id,
              user_name: entry.user_name,
              orders: 0,
            }
          }
          dayByUser[entry.user_id].orders += entry.orders_count
        })
        Object.values(dayByUser).forEach(dayRow => {
          if (!byUser[dayRow.user_id]) {
            byUser[dayRow.user_id] = {
              user_id: dayRow.user_id,
              user_name: dayRow.user_name,
              orders: 0,
              bonus: 0,
              days_active: 0,
            }
          }
          byUser[dayRow.user_id].orders += dayRow.orders
          byUser[dayRow.user_id].bonus += calcBonus(dayRow.orders, bonusSettings)
          byUser[dayRow.user_id].days_active += 1
        })
      }))

      setAnalyticsBonusRows(Object.values(byUser).sort((a, b) => b.bonus - a.bonus))
    } catch {
      setAnalyticsBonusRows([])
    } finally {
      setLoadingAnalyticsBonus(false)
    }
  }, [user.id, isAdmin, showBonusAsAdmin, bonusSettings])

  const fetchMonthlyBonus = useCallback(async () => {
    try {
      const { data } = await supabase.rpc('get_crm_monthly_bonus', {
        p_user_id: user.id,
        p_is_admin: isAdmin,
      })
      if (data) setMonthlyBonus(data as CrmMonthlyUserBonus[])
    } catch {/* ignore */}
  }, [user.id, isAdmin])

  const fetchRecent = useCallback(async () => {
    try {
      const { data } = await supabase.rpc('get_crm_recent', {
        p_user_id: user.id,
        p_is_admin: isAdmin,
        p_limit: 250,
      })
      if (data) setRecentEntries(data as CrmEntry[])
    } catch {/* ignore */}
  }, [user.id, isAdmin])

  const fetchBonusSettings = useCallback(async () => {
    try {
      const { data } = await supabase.rpc('get_crm_bonus_settings')
      if (data) {
        setBonusSettings(data as BonusSettings)
        setEditRateMid(String((data as BonusSettings).rate_mid))
        setEditRateHigh(String((data as BonusSettings).rate_high))
      }
    } catch {/* ignore */}
  }, [])

  const fetchCrmWorkers = useCallback(async () => {
    setLoadingWorkers(true)
    setWorkersError('')
    try {
      const { data, error } = await supabase.rpc('get_crm_workers', {
        p_admin_id: user.id,
        p_admin_pin: user.pin,
      })
      if (error) throw error
      const workers = (data ?? []) as CrmWorker[]
      setCrmWorkers(workers)
      setSelectedCrmUserId(current => current || workers[0]?.id || '')
    } catch {
      setWorkersError('Не вдалося завантажити працівників CRM')
    } finally {
      setLoadingWorkers(false)
    }
  }, [user.id, user.pin])

  useEffect(() => { fetchDay(selectedDate) }, [fetchDay, selectedDate])

  useEffect(() => { fetchRecent() }, [fetchRecent])
  useEffect(() => { fetchMonthlyBonus() }, [fetchMonthlyBonus])
  useEffect(() => { fetchBonusSettings() }, [fetchBonusSettings])
  useEffect(() => {
    if (tab === 'input' && canManageCrm) fetchCrmWorkers()
  }, [tab, canManageCrm, fetchCrmWorkers])

  useEffect(() => {
    if (tab === 'analytics') {
      fetchAnalytics(chartPeriod === '1d' ? 1 : chartPeriod === '7d' ? 7 : 30, analyticsDate)
      fetchAnalyticsDay(analyticsDate)
      fetchAnalyticsBonusRows(chartPeriod, analyticsDate)
    }
  }, [tab, chartPeriod, fetchAnalytics, fetchAnalyticsDay, fetchAnalyticsBonusRows, analyticsDate])

  useEffect(() => {
    if (tab === 'chart') {
      fetchGraphData(graphStartDate, graphEndDate)
    }
  }, [tab, graphStartDate, graphEndDate, fetchGraphData])

  // ── Submit entry ────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!orders && !units) return true
    const o = parseInt(orders, 10)
    const u = parseInt(units, 10)
    if (isNaN(o) || isNaN(u) || o < 0 || u < 0) {
      setSubmitError('Введіть коректні числа')
      return false
    }
    setSubmitting(true)
    setSubmitError('')
    try {
      if (canManageCrm && !selectedCrmUserId) {
        setSubmitError('Оберіть працівника CRM')
        return false
      }
      // For today — use real current time; for past dates — use noon Kyiv (10:00 UTC) to anchor to that date
      const todayStr = toDateInputValue(new Date())
      const ts = selectedDate === todayStr
        ? new Date().toISOString()
        : `${selectedDate}T10:00:00Z`
      const { error } = canManageCrm
        ? await supabase.rpc('submit_crm_entry_as_super_admin', {
            p_admin_id: user.id,
            p_admin_pin: user.pin,
            p_user_id: selectedCrmUserId,
            p_orders: o,
            p_units: u,
            p_created_at: ts,
          })
        : await supabase.rpc('submit_crm_entry', {
            p_user_id: user.id,
            p_orders: o,
            p_units: u,
            p_created_at: ts,
          })
      if (error) throw error
      setOrders('')
      setUnits('')
      setSubmitSuccess(true)
      setTimeout(() => setSubmitSuccess(false), 2500)
      fetchDay(selectedDate)
      fetchRecent()
      fetchMonthlyBonus()
      return true
    } catch {
      setSubmitError('Помилка збереження. Спробуйте ще раз.')
      return false
    } finally {
      setSubmitting(false)
    }
  }

  // ── Delete entry ─────────────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    if (!window.confirm('Видалити цей запис?')) return
    setDeleting(id)
    try {
      const { error } = canManageCrm
        ? await supabase.rpc('delete_crm_entry_as_super_admin', {
            p_admin_id: user.id,
            p_admin_pin: user.pin,
            p_entry_id: id,
          })
        : await supabase.rpc('delete_crm_entry', { p_id: id })
      if (error) throw error
      fetchDay(selectedDate)
      fetchRecent()
      fetchMonthlyBonus()
    } catch {/* ignore */} finally {
      setDeleting(null)
    }
  }

  const beginEditEntry = (entry: CrmEntry) => {
    setEditingEntry(entry)
    setEditOrders(String(entry.orders_count))
    setEditUnits(String(entry.units_count))
    setSubmitError('')
  }

  const handleUpdateEntry = async () => {
    if (!editingEntry || !canManageCrm) return
    const nextOrders = parseInt(editOrders, 10)
    const nextUnits = parseInt(editUnits, 10)
    if (Number.isNaN(nextOrders) || Number.isNaN(nextUnits) || nextOrders < 0 || nextUnits < 0) {
      setSubmitError('Введіть коректні значення для редагування')
      return
    }
    setSavingEntry(true)
    setSubmitError('')
    try {
      const { error } = await supabase.rpc('update_crm_entry_as_super_admin', {
        p_admin_id: user.id,
        p_admin_pin: user.pin,
        p_entry_id: editingEntry.id,
        p_orders: nextOrders,
        p_units: nextUnits,
      })
      if (error) throw error
      setEditingEntry(null)
      await Promise.all([fetchDay(selectedDate), fetchRecent(), fetchMonthlyBonus()])
    } catch {
      setSubmitError('Не вдалося оновити запис')
    } finally {
      setSavingEntry(false)
    }
  }

  // ── Derived ──────────────────────────────────────────────────────────────────
  const chartData = useMemo(() => {
    if (!analytics?.daily) return []
    return analytics.daily
  }, [analytics])

  const entries = useMemo(() => {
    if (!dayData?.entries) return []
    if (canManageCrm && selectedCrmUserId) {
      return dayData.entries.filter(e => e.user_id === selectedCrmUserId)
    }
    if (isAdmin) return dayData.entries
    return dayData.entries.filter(e => e.user_id === user.id)
  }, [dayData, canManageCrm, selectedCrmUserId, isAdmin, user.id])

  const visibleRecentEntries = useMemo(() => {
    if (canManageCrm && selectedCrmUserId) {
      return recentEntries.filter(entry => entry.user_id === selectedCrmUserId)
    }
    return recentEntries
  }, [canManageCrm, recentEntries, selectedCrmUserId])

  const recentEntryGroups = useMemo(() => {
    const dateKeyFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit',
    })
    const dateLabelFormatter = new Intl.DateTimeFormat('uk-UA', {
      timeZone: 'Europe/Kyiv', weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    })
    const weekendFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Kyiv', weekday: 'short',
    })
    const groups = new Map<string, { label: string; isWeekend: boolean; entries: CrmEntry[] }>()

    visibleRecentEntries.forEach(entry => {
      const entryDate = new Date(entry.created_at)
      const key = dateKeyFormatter.format(entryDate)
      const weekday = weekendFormatter.format(entryDate)
      const group = groups.get(key)

      if (group) {
        group.entries.push(entry)
        return
      }

      const label = dateLabelFormatter.format(entryDate)
      groups.set(key, {
        label: label.charAt(0).toUpperCase() + label.slice(1),
        isWeekend: weekday === 'Sat' || weekday === 'Sun',
        entries: [entry],
      })
    })

    return Array.from(groups.entries()).map(([key, group]) => ({ key, ...group }))
  }, [visibleRecentEntries])

  const displayedInputEntries = canManageCrm ? entries : visibleRecentEntries

  const totalOrders = entries.reduce((s, e) => s + e.orders_count, 0)
  const totalUnits  = entries.reduce((s, e) => s + e.units_count, 0)
  const navigationTabs: Tab[] = isCrm
    ? ['input', 'work-hours']
    : canManageCrm
      ? isSuperAdmin
        ? ['analytics', 'chart', 'input', 'work-hours', 'records']
        : ['analytics', 'chart', 'input', 'work-hours']
      : user.role === 'crm_admin'
        ? ['analytics', 'chart', 'work-hours', 'records']
        : ['analytics', 'chart']

  return (
    <>
    <div className="min-h-screen pb-8" style={{background:'linear-gradient(135deg,#e8f4f8 0%,#f0f9ff 40%,#e8f0fe 100%)'}}>
      <div className="max-w-screen-sm mx-auto px-3 pt-3 space-y-3">

        {/* Header */}
        <div className="rounded-3xl px-4 py-3 shadow-md backdrop-blur-sm border border-white/80 bg-white/75 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isAdmin && (
              <button onClick={() => navigate('/')} className="text-gray-400 hover:text-gray-600 mr-1">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <div className="w-8 h-8 bg-emerald-100 rounded-xl flex items-center justify-center">
              <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-bold text-gray-800">Склад CRM</p>
              <p className="text-xs text-gray-400">{user.name}</p>
            </div>
          </div>
          <button
            onClick={onLogout}
            className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors"
          >
            Вийти
          </button>
        </div>

        {/* CRM працівник бачить введення своїх даних і власні робочі години. */}
        {
          <div className={`grid gap-2 ${navigationTabs.length > 4 ? 'grid-cols-2 sm:grid-cols-5' : navigationTabs.length > 2 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2'}`}>
            {navigationTabs.map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-3.5 rounded-2xl text-sm font-bold transition-all duration-200 active:scale-[0.98]
                  backdrop-blur-md shadow-sm
                  ${tab === t
                    ? 'bg-gradient-to-br from-blue-50 to-white border-2 border-blue-400 text-blue-700 shadow-md'
                    : 'bg-gradient-to-br from-gray-50/80 to-white/60 border border-gray-200/80 text-gray-400 hover:border-blue-200 hover:text-gray-600'
                  }`}
              >
                {getTabLabel(t)}
              </button>
            ))}
          </div>
        }

        {/* ── INPUT TAB ──────────────────────────────────────────────────────── */}
        {tab === 'input' && (
          <>
            {canManageCrm && (
              <div className="rounded-3xl p-4 shadow-md backdrop-blur-sm border border-blue-100 bg-gradient-to-br from-blue-50/90 to-white/80">
                <label className="text-xs font-semibold uppercase tracking-wide text-blue-500 block mb-2">Працівник CRM</label>
                <select
                  value={selectedCrmUserId}
                  disabled={loadingWorkers || crmWorkers.length === 0}
                  onChange={e => {
                    setSelectedCrmUserId(e.target.value)
                    setEditingEntry(null)
                  }}
                  className="w-full rounded-xl border border-blue-200 bg-white px-3 py-3 text-sm font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-300"
                >
                  {loadingWorkers && <option>Завантаження…</option>}
                  {!loadingWorkers && crmWorkers.length === 0 && <option>Працівників не знайдено</option>}
                  {crmWorkers.map(worker => <option key={worker.id} value={worker.id}>{worker.name}</option>)}
                </select>
                <p className={`text-xs mt-2 ${workersError ? 'text-red-500' : 'text-gray-400'}`}>
                  {workersError || 'Нові записи та зміни будуть зараховані обраному працівнику.'}
                </p>
              </div>
            )}

            {/* Date picker */}
            <div className="rounded-3xl px-4 py-3 shadow-md backdrop-blur-sm border border-white/80 bg-white/75 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="text-sm font-semibold text-gray-700">
                  {isToday ? `Сьогодні · ${formatDisplayDate(selectedDate)}` : formatDisplayDate(selectedDate)}
                </span>
                {!isToday && (
                  <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                    минуле
                  </span>
                )}
              </div>
              <input
                type="date"
                value={selectedDate}
                max={toDateInputValue(new Date())}
                onChange={e => setSelectedDate(e.target.value)}
                className="text-xs text-gray-500 border border-gray-200 rounded-lg px-2 py-1
                           focus:outline-none focus:ring-2 focus:ring-emerald-300"
              />
            </div>

            {/* Input form */}
            <div className="rounded-3xl p-4 shadow-md backdrop-blur-sm border border-white/80 bg-white/75 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 font-medium block mb-1">Кількість замовлень</label>
                  <input
                    type="text" inputMode="numeric" pattern="[0-9]*" value={orders}
                    onChange={e => setOrders(e.target.value.replace(/\D/g, ''))} placeholder="0"
                    className="h-12 w-full border border-gray-200 rounded-xl px-3 py-2.5
                               focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-400
                               text-gray-800 placeholder-gray-300 text-base"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium block mb-1">Кількість одиниць товару</label>
                  <input
                    type="text" inputMode="numeric" pattern="[0-9]*" value={units}
                    onChange={e => setUnits(e.target.value.replace(/\D/g, ''))} placeholder="0"
                    className="h-12 w-full border border-gray-200 rounded-xl px-3 py-2.5
                               focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-400
                               text-gray-800 placeholder-gray-300 text-base"
                  />
                </div>
              </div>

              {submitError && (
                <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{submitError}</p>
              )}
              {submitSuccess && (
                <p className="text-xs text-emerald-600 bg-emerald-50 rounded-lg px-3 py-2">Збережено успішно</p>
              )}

            </div>

            <CrmWorkHours
              userId={user.id}
              userPin={user.pin}
              canManage={canManageCrm}
              showDashboard={false}
              selectedDate={selectedDate}
              onSelectedDateChange={setSelectedDate}
              targetUserId={canManageCrm ? selectedCrmUserId : user.id}
              compact
              onSaveOrder={handleSubmit}
            />

          </>
        )}

        {/* ── MONTHLY REVIEW ───────────────────────────────────────────────── */}
        {tab === 'work-hours' && (canViewCrmHours || isCrm) && (
          <>
            <CrmWorkHours userId={user.id} userPin={user.pin} canManage={canManageCrm} canViewAll={canViewCrmHours} readOnly />

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-3xl p-4 shadow-md backdrop-blur-sm border border-white/80 bg-gradient-to-br from-emerald-50/80 via-white/80 to-teal-50/60">
                <p className="text-xs text-gray-400 mb-1">Замовлень сьогодні</p>
                <p className="text-2xl font-bold text-gray-800">{loadingDay ? '—' : totalOrders}</p>
              </div>
              <div className="rounded-3xl p-4 shadow-md backdrop-blur-sm border border-white/80 bg-gradient-to-br from-blue-50/80 via-white/80 to-indigo-50/60">
                <p className="text-xs text-gray-400 mb-1">Одиниць товару</p>
                <p className="text-2xl font-bold text-gray-800">{loadingDay ? '—' : totalUnits}</p>
              </div>
            </div>

            {isCrm && !loadingDay && (() => {
              const dayBonus = calcBonus(totalOrders, bonusSettings)
              const monthBonus = monthlyBonus[0]?.total_bonus ?? 0
              return (
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-yellow-200 bg-gradient-to-br from-yellow-50 to-amber-50 p-4 shadow-sm">
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Бонус за день</p>
                    <p className="mt-2 text-3xl font-extrabold text-amber-600">{dayBonus || '—'}</p>
                    <p className="text-sm font-semibold text-amber-500">{dayBonus ? 'грн' : 'від 80 замовл.'}</p>
                  </div>
                  <div className="rounded-2xl border border-yellow-200 bg-gradient-to-br from-yellow-50 to-amber-50 p-4 shadow-sm">
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-400">За місяць</p>
                    <p className="mt-2 text-3xl font-extrabold text-amber-600">{monthBonus || '—'}</p>
                    <p className="text-sm font-semibold text-amber-500">{monthBonus ? 'грн' : 'немає бонусів'}</p>
                  </div>
                </div>
              )
            })()}

          </>
        )}

        {/* ── RECORDS ─────────────────────────────────────────────────────── */}
        {tab === 'records' && canViewCrmRecords && visibleRecentEntries.length > 0 && (
              <div className="rounded-3xl border border-white/80 bg-white/75 p-4 shadow-md">
                <p className="mb-3 text-sm font-semibold text-gray-700">Останні записи</p>
                <div className="space-y-3">
                  {recentEntryGroups.map(group => (
                    <section
                      key={group.key}
                      className={`rounded-2xl border p-2 ${group.isWeekend ? 'border-amber-400' : 'border-slate-400/90'}`}
                    >
                      <p className={`mb-1 rounded-lg px-2 py-1 text-xs font-semibold ${group.isWeekend ? 'bg-amber-200 text-amber-800' : 'bg-slate-200 text-gray-600'}`}>
                        {group.label}
                      </p>
                      <div className="space-y-1.5">
                        {group.entries.map(entry => {
                          const bonus = calcBonus(entry.orders_count, bonusSettings)
                          const date = new Date(entry.created_at).toLocaleString('uk-UA', {
                            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv',
                          })
                          return (
                            <div
                              key={entry.id}
                              className={`flex items-center gap-2 rounded-2xl border px-3 py-2.5 ${group.isWeekend ? 'border-amber-100 bg-amber-50/70' : 'border-white bg-white/60'}`}
                            >
                              <div className="flex-1 min-w-0">
                                {canViewCrmHours && <p className="truncate text-xs font-semibold text-emerald-700">{entry.user_name}</p>}
                                <p className="text-xs text-gray-400">{date}</p>
                              </div>
                              {bonus > 0 && <span className="text-sm font-bold text-amber-500">{bonus} грн</span>}
                              <div className="text-right"><span className="text-sm font-bold text-gray-800">{entry.orders_count}</span><span className="ml-1 text-xs text-gray-400">зам.</span></div>
                              <div className="text-right"><span className="text-sm font-bold text-gray-800">{entry.units_count}</span><span className="ml-1 text-xs text-gray-400">од.</span></div>
                              <div className="text-right whitespace-nowrap"><span className="text-sm font-bold text-blue-700">{Number(entry.weighted_hours ?? 0).toLocaleString('uk-UA', { maximumFractionDigits: 2 })}</span><span className="ml-1 text-xs text-gray-400">год</span></div>
                            </div>
                          )
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
        )}

        {/* ── GRAPH TAB ──────────────────────────────────────────────────────── */}
        {tab === 'chart' && (
          <>
            <div className="rounded-3xl p-4 shadow-md backdrop-blur-sm border border-white/80 bg-white/75 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-gray-700">Графік замовлень</p>
                  <p className="text-xs text-gray-400 mt-0.5">Кількість замовлень за вибраний проміжок</p>
                </div>
                <span className="text-xs text-gray-400 whitespace-nowrap">{formatDisplayDate(graphStartDate)}–{formatDisplayDate(graphEndDate)}</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs text-gray-400 mb-1 block">Від</span>
                  <input
                    type="date"
                    value={graphStartDate}
                    max={graphEndDate}
                    onChange={e => { if (e.target.value) setGraphStartDate(e.target.value) }}
                    className="w-full text-sm text-gray-600 border border-gray-200 rounded-xl px-3 py-2.5
                               focus:outline-none focus:ring-2 focus:ring-emerald-300"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-gray-400 mb-1 block">До</span>
                  <input
                    type="date"
                    value={graphEndDate}
                    min={graphStartDate}
                    max={todayValue}
                    onChange={e => { if (e.target.value) setGraphEndDate(e.target.value) }}
                    className="w-full text-sm text-gray-600 border border-gray-200 rounded-xl px-3 py-2.5
                               focus:outline-none focus:ring-2 focus:ring-emerald-300"
                  />
                </label>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => {
                    setGraphStartDate(toDateInputValue(addDays(new Date(), -29)))
                    setGraphEndDate(todayValue)
                  }}
                  className="py-2 rounded-xl text-xs font-semibold text-gray-500 bg-gray-50 border border-gray-200 hover:border-blue-200 hover:text-blue-600 transition-colors"
                >
                  1 місяць
                </button>
                <button
                  onClick={() => {
                    setGraphStartDate(toDateInputValue(addDays(new Date(), -89)))
                    setGraphEndDate(todayValue)
                  }}
                  className="py-2 rounded-xl text-xs font-semibold text-gray-500 bg-gray-50 border border-gray-200 hover:border-blue-200 hover:text-blue-600 transition-colors"
                >
                  3 місяці
                </button>
                <button
                  onClick={() => {
                    setGraphStartDate(toDateInputValue(addDays(new Date(), -179)))
                    setGraphEndDate(todayValue)
                  }}
                  className="py-2 rounded-xl text-xs font-semibold text-gray-500 bg-gray-50 border border-gray-200 hover:border-blue-200 hover:text-blue-600 transition-colors"
                >
                  6 місяців
                </button>
              </div>
            </div>

            {loadingGraph && (
              <div className="flex justify-center py-8">
                <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {graphError && !loadingGraph && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                {graphError}
              </div>
            )}

            {!loadingGraph && !graphError && (
              <SmoothOrdersChart data={graphData} />
            )}
          </>
        )}

        {/* ── ANALYTICS TAB ──────────────────────────────────────────────────── */}
        {tab === 'analytics' && (
          <>
            <div className="flex gap-2">
              {(['1d', '7d', '30d'] as ChartPeriod[]).map(p => (
                <button
                  key={p}
                  onClick={() => setChartPeriod(p)}
                  className={`flex-1 py-3 rounded-2xl text-sm font-bold transition-all duration-200 active:scale-[0.98]
                    backdrop-blur-md border shadow-sm
                    ${chartPeriod === p
                      ? 'bg-gradient-to-br from-sky-100/80 via-cyan-50/60 to-white/50 border-2 border-blue-400 text-blue-700 shadow-md'
                      : 'bg-gradient-to-br from-gray-50/80 to-white/60 border border-gray-200/80 text-gray-400 hover:border-blue-200 hover:text-gray-600'
                    }`}
                >
                  {getPeriodLabel(p)}
                </button>
              ))}
            </div>

            {loadingAnalytics && (
              <div className="flex justify-center py-8">
                <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {analyticsError && !loadingAnalytics && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                {analyticsError}
              </div>
            )}

            {analytics && !loadingAnalytics && (
              <>
                {/* KPI block — switches by chartPeriod */}
                <div className="rounded-3xl p-4 shadow-md backdrop-blur-sm border border-white/80 bg-white/75">
                  {/* Header */}
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <p className="text-sm font-semibold text-gray-700">
                      {getKpiPeriodLabel(chartPeriod, isAnalyticsToday, analyticsDate)}
                    </p>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setAnalyticsDate(prev => shiftAnalyticsDate(prev, chartPeriod, -1))}
                        className="w-6 h-6 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                      >‹</button>
                      <input
                        type="date"
                        value={analyticsDate}
                        max={todayValue}
                        onChange={e => { if (e.target.value) setAnalyticsDate(e.target.value) }}
                        className="text-xs text-gray-500 border border-gray-200 rounded-lg px-2 py-1
                                   focus:outline-none focus:ring-2 focus:ring-emerald-300"
                      />
                      <button
                        onClick={() => setAnalyticsDate(prev => shiftAnalyticsDate(prev, chartPeriod, 1))}
                        disabled={isAnalyticsCurrentPeriod}
                        className="w-6 h-6 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      >›</button>
                    </div>
                    {!isAnalyticsCurrentPeriod && (
                      <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">минуле</span>
                    )}
                  </div>

                  {/* === 1 ДЕНЬ === */}
                  {chartPeriod === '1d' && analyticsDayData && (() => {
                    const byUser: Record<string, { user_id: string; user_name: string; orders: number; units: number }> = {}
                    analyticsDayData.entries?.forEach(e => {
                      if (!byUser[e.user_id]) byUser[e.user_id] = { user_id: e.user_id, user_name: e.user_name, orders: 0, units: 0 }
                      byUser[e.user_id].orders += e.orders_count
                      byUser[e.user_id].units += e.units_count
                    })
                    const rows = Object.values(byUser)
                    const maxO = Math.max(...rows.map(u => u.orders), 1)
                    const maxU = Math.max(...rows.map(u => u.units), 1)
                    return (
                      <>
                        <div className="grid grid-cols-2 gap-3 mb-4">
                          <div className="rounded-2xl p-4 bg-gradient-to-br from-emerald-50 to-teal-50/60 border-2 border-emerald-200/70 shadow-[inset_0_2px_10px_rgba(16,185,129,0.08)]">
                            <p className="text-xs text-gray-400 mb-1">Замовлень/год</p>
                            <p className="text-3xl font-extrabold text-emerald-700">{(analyticsDayData.total_orders / 8).toFixed(1)}</p>
                            <p className="text-sm text-gray-400 mt-1">Всього: {analyticsDayData.total_orders}</p>
                          </div>
                          <div className="rounded-2xl p-4 bg-gradient-to-br from-blue-50 to-indigo-50/60 border-2 border-blue-200/70 shadow-[inset_0_2px_10px_rgba(99,102,241,0.08)]">
                            <p className="text-xs text-gray-400 mb-1">Одиниць/год</p>
                            <p className="text-3xl font-extrabold text-blue-700">{(analyticsDayData.total_units / 8).toFixed(1)}</p>
                            <p className="text-sm text-gray-400 mt-1">Всього: {analyticsDayData.total_units}</p>
                          </div>
                        </div>
                        {rows.length > 0 && (
                          <div className="space-y-3">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">По співробітниках</p>
                            {rows.map(u => (
                              <div key={u.user_id} className="rounded-2xl p-3 bg-white/60 backdrop-blur-sm border border-white/80">
                                <div className="flex items-center justify-between mb-2">
                                  <p className="text-sm font-semibold text-gray-700">{u.user_name}</p>
                                  <span className="text-xs text-gray-400">{u.orders} замовл. · {u.units} од.</span>
                                </div>
                                <div className="space-y-1.5">
                                  <div>
                                    <div className="flex justify-between text-xs text-gray-400">
                                      <span>Замовлень/год</span>
                                      <span className="font-semibold text-emerald-600">{(u.orders / 8).toFixed(1)}</span>
                                    </div>
                                    <KpiBar value={u.orders} max={maxO} color="#10b981" />
                                  </div>
                                  <div>
                                    <div className="flex justify-between text-xs text-gray-400">
                                      <span>Одиниць/год</span>
                                      <span className="font-semibold text-blue-600">{(u.units / 8).toFixed(1)}</span>
                                    </div>
                                    <KpiBar value={u.units} max={maxU} color="#3b82f6" />
                                  </div>
                                </div>
                              </div>
                            ))}
                            <div className="mt-2 flex items-center justify-between rounded-2xl px-4 py-3 bg-white/60 backdrop-blur-sm border border-white/80">
                              <span className="text-base font-bold text-gray-600">Всього</span>
                              <div className="flex items-center gap-4">
                                <span><span className="text-2xl font-bold text-emerald-700">{rows.reduce((s, u) => s + u.orders, 0)}</span><span className="text-sm text-gray-400 ml-1">замовл.</span></span>
                                <span><span className="text-2xl font-bold text-blue-700">{rows.reduce((s, u) => s + u.units, 0)}</span><span className="text-sm text-gray-400 ml-1">од.</span></span>
                              </div>
                            </div>
                          </div>
                        )}
                      </>
                    )
                  })()}

                  {/* === 7 ДНІВ / 1 МІСЯЦЬ === */}
                  {chartPeriod !== '1d' && analytics.by_user_today && (() => {
                    const rows = analytics.by_user_today
                    if (rows.length === 0) return <p className="text-sm text-gray-400 text-center py-4">Немає даних</p>
                    const totalO = rows.reduce((s, u) => s + u.total_orders, 0)
                    const totalU = rows.reduce((s, u) => s + u.total_units, 0)
                    const days = Math.max(chartData.length, 1)
                    const maxO = Math.max(...rows.map(u => u.total_orders), 1)
                    const maxU = Math.max(...rows.map(u => u.total_units), 1)
                    return (
                      <>
                        <div className="grid grid-cols-2 gap-3 mb-4">
                          <div className="rounded-2xl p-4 bg-gradient-to-br from-emerald-50 to-teal-50/60 border-2 border-emerald-200/70 shadow-[inset_0_2px_10px_rgba(16,185,129,0.08)]">
                            <p className="text-xs text-gray-400 mb-1">Замовлень/год</p>
                            <p className="text-3xl font-extrabold text-emerald-700">{(totalO / (days * 8)).toFixed(1)}</p>
                            <p className="text-sm text-gray-400 mt-1">Всього: {totalO}</p>
                          </div>
                          <div className="rounded-2xl p-4 bg-gradient-to-br from-blue-50 to-indigo-50/60 border-2 border-blue-200/70 shadow-[inset_0_2px_10px_rgba(99,102,241,0.08)]">
                            <p className="text-xs text-gray-400 mb-1">Одиниць/год</p>
                            <p className="text-3xl font-extrabold text-blue-700">{(totalU / (days * 8)).toFixed(1)}</p>
                            <p className="text-sm text-gray-400 mt-1">Всього: {totalU}</p>
                          </div>
                        </div>
                        <div className="space-y-3">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">По співробітниках</p>
                          {rows.map(u => (
                            <div key={u.user_id} className="rounded-2xl p-3 bg-white/60 backdrop-blur-sm border border-white/80">
                              <div className="flex items-center justify-between mb-2">
                                <p className="text-sm font-semibold text-gray-700">{u.user_name}</p>
                                <span className="text-xs text-gray-400">{u.total_orders} замовл. · {u.total_units} од.</span>
                              </div>
                              <div className="space-y-1.5">
                                <div>
                                  <div className="flex justify-between text-xs text-gray-400">
                                    <span>Замовлень/год</span>
                                    <span className="font-semibold text-emerald-600">{u.orders_per_hour.toFixed(1)}</span>
                                  </div>
                                  <KpiBar value={u.total_orders} max={maxO} color="#10b981" />
                                </div>
                                <div>
                                  <div className="flex justify-between text-xs text-gray-400">
                                    <span>Одиниць/год</span>
                                    <span className="font-semibold text-blue-600">{u.units_per_hour.toFixed(1)}</span>
                                  </div>
                                  <KpiBar value={u.total_units} max={maxU} color="#3b82f6" />
                                </div>
                              </div>
                            </div>
                          ))}
                          <div className="mt-2 flex items-center justify-between rounded-2xl px-4 py-3 bg-white/60 backdrop-blur-sm border border-white/80">
                            <span className="text-base font-bold text-gray-600">Всього</span>
                            <div className="flex items-center gap-4">
                              <span><span className="text-2xl font-bold text-emerald-700">{totalO}</span><span className="text-sm text-gray-400 ml-1">замовл.</span></span>
                              <span><span className="text-2xl font-bold text-blue-700">{totalU}</span><span className="text-sm text-gray-400 ml-1">од.</span></span>
                            </div>
                          </div>
                        </div>
                      </>
                    )
                  })()}
                </div>

                {/* Monthly totals */}
                {analytics.monthly && chartPeriod === '30d' && (
                  <div className="rounded-3xl p-4 shadow-md backdrop-blur-sm border border-white/80 bg-white/75">
                    <p className="text-sm font-semibold text-gray-700 mb-3">За місяць {getPeriodRangeLabel(chartPeriod, analyticsDate)}</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-2xl p-4 flex flex-col items-center justify-center bg-gradient-to-br from-emerald-50 to-teal-50/60 border-2 border-emerald-200/70 shadow-[inset_0_2px_10px_rgba(16,185,129,0.08)]">
                        <p className="text-2xl font-bold text-emerald-700">{analytics.monthly.total_orders}</p>
                        <p className="text-xs text-gray-400 mt-0.5">замовлень</p>
                      </div>
                      <div className="rounded-2xl p-4 flex flex-col items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-50/60 border-2 border-blue-200/70 shadow-[inset_0_2px_10px_rgba(99,102,241,0.08)]">
                        <p className="text-2xl font-bold text-blue-700">{analytics.monthly.total_units}</p>
                        <p className="text-xs text-gray-400 mt-0.5">одиниць товару</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Chart: orders */}
                {chartPeriod !== '1d' && <div className="rounded-3xl p-4 shadow-md backdrop-blur-sm border border-white/80 bg-gradient-to-br from-emerald-50/90 via-white/80 to-teal-50/70">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold text-gray-700">Замовлення</p>
                    <span className="text-xs text-gray-400">{getPeriodRangeLabel(chartPeriod, analyticsDate)}</span>
                  </div>
                  {chartData.length > 0 ? (
                    <>
                      <MiniBarChart data={chartData} color="emerald" label="orders" />
                      <div className="flex justify-between text-xs text-gray-400 mt-1">
                        <span>{chartData[0]?.date?.slice(5) ?? ''}</span>
                        <span>{chartData[chartData.length - 1]?.date?.slice(5) ?? 'сьогодні'}</span>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-gray-400 text-center py-4">Немає даних</p>
                  )}
                </div>}

                {/* Chart: units */}
                {chartPeriod !== '1d' && <div className="rounded-3xl p-4 shadow-md backdrop-blur-sm border border-white/80 bg-gradient-to-br from-violet-50/90 via-white/80 to-indigo-50/70">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold text-gray-700">Одиниці товару</p>
                    <span className="text-xs text-gray-400">{getPeriodRangeLabel(chartPeriod, analyticsDate)}</span>
                  </div>
                  {chartData.length > 0 ? (
                    <>
                      <MiniBarChart data={chartData} color="blue" label="units" />
                      <div className="flex justify-between text-xs text-gray-400 mt-1">
                        <span>{chartData[0]?.date?.slice(5) ?? ''}</span>
                        <span>{chartData[chartData.length - 1]?.date?.slice(5) ?? 'сьогодні'}</span>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-gray-400 text-center py-4">Немає даних</p>
                  )}
                </div>}

                {/* Bonus table — crm_admin / admin 1505/7985, calculated for selected analytics period */}
                {showBonusAsAdmin && (() => {
                  const rows = analyticsBonusRows
                  if (loadingAnalyticsBonus) return (
                    <div className="rounded-3xl p-5 shadow-md bg-gradient-to-br from-cyan-50 via-white to-blue-50 border border-white/60 backdrop-blur-sm">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-amber-500">🎁</span>
                          <div>
                            <p className="text-sm font-semibold text-gray-700">Бонуси співробітників</p>
                            <p className="text-xs text-gray-400">{getPeriodRangeLabel(chartPeriod, analyticsDate)}</p>
                          </div>
                        </div>
                        <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                      </div>
                    </div>
                  )
                  if (rows.length === 0) return null
                  const bonusRows = rows.filter(u => u.bonus > 0)
                  if (bonusRows.length === 0) return (
                    <div className="rounded-3xl p-5 shadow-md bg-gradient-to-br from-cyan-50 via-white to-blue-50 border border-white/60 backdrop-blur-sm">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-amber-500">🎁</span>
                        <p className="text-sm font-semibold text-gray-700">Бонуси співробітників</p>
                      </div>
                      <p className="text-xs text-gray-400 mb-1">{getPeriodRangeLabel(chartPeriod, analyticsDate)}</p>
                      <p className="text-sm text-gray-400">Поки ніхто не досяг 80 замовлень за період</p>
                    </div>
                  )
                  const totalBonus = rows.reduce((s, u) => s + u.bonus, 0)
                  return (
                    <div className="rounded-3xl p-5 shadow-md bg-gradient-to-br from-cyan-50 via-white to-blue-50 border border-white/60 backdrop-blur-sm">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-amber-500">🎁</span>
                          <div>
                            <p className="text-sm font-semibold text-gray-700">Бонуси співробітників</p>
                            <p className="text-xs text-gray-400">{getPeriodRangeLabel(chartPeriod, analyticsDate)}</p>
                          </div>
                        </div>
                        <span className="text-sm font-extrabold text-amber-600">Всього: {totalBonus} грн</span>
                      </div>
                      <div className="space-y-2">
                        {rows.map(u => {
                          return (
                            <div key={u.user_id} className="flex items-center justify-between bg-white/70 backdrop-blur-sm rounded-2xl px-4 py-3 border border-white shadow-sm">
                              <div>
                                <p className="text-base font-semibold text-gray-800">{u.user_name}</p>
                                <p className="text-sm text-gray-400">
                                  {u.orders} замовл. · {u.days_active} {u.days_active === 1 ? 'день' : 'дні'}
                                </p>
                              </div>
                              <div className="text-right">
                                {u.bonus > 0
                                  ? <p className="text-2xl font-extrabold text-amber-600">{u.bonus} <span className="text-base font-semibold text-amber-400">грн</span></p>
                                  : <p className="text-lg text-gray-300">—</p>
                                }
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })()}

                {/* Monthly bonus — crm_admin sees all users, crm sees own, ceo hidden */}
                {monthlyBonus.length > 0 && !isCeo && isAnalyticsCurrentPeriod && (
                  <div className="rounded-3xl shadow-md bg-gradient-to-br from-cyan-50 via-white to-blue-50 border border-white/60 backdrop-blur-sm overflow-hidden">
                    <button
                      onClick={() => setShowMonthlyBonus(v => !v)}
                      className="w-full flex items-center justify-between px-5 py-3.5 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-amber-500">📅</span>
                        <p className="text-sm font-semibold text-gray-700">Бонуси за місяць</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {showBonusAsAdmin && (
                          <span className="text-sm font-extrabold text-amber-600">
                            {monthlyBonus.reduce((s, u) => s + u.total_bonus, 0)} грн
                          </span>
                        )}
                        <svg
                          className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${showMonthlyBonus ? 'rotate-180' : ''}`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </button>
                    {showMonthlyBonus && (
                      <div className="px-5 pb-5 space-y-2 border-t border-white/60">
                        <div className="pt-3 space-y-2">
                          {monthlyBonus.map(u => (
                            <div key={u.user_id} className="flex items-center justify-between bg-white/70 backdrop-blur-sm rounded-2xl px-4 py-3 border border-white shadow-sm">
                              <div>
                                {showBonusAsAdmin && <p className="text-base font-semibold text-gray-800">{u.user_name}</p>}
                                <p className="text-sm text-gray-400">
                                  {u.total_orders} замовл. · {u.days_active} {u.days_active === 1 ? 'день' : 'дні'}
                                </p>
                              </div>
                              <div className="text-right">
                                {u.total_bonus > 0
                                  ? <p className="text-2xl font-extrabold text-amber-600">{u.total_bonus} <span className="text-base font-semibold text-amber-400">грн</span></p>
                                  : <p className="text-lg text-gray-300">0 грн</p>
                                }
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Bonus rate settings — admin 1505 / crm_admin */}
            {showBonusAsAdmin && (
              <div className="rounded-3xl shadow-md backdrop-blur-sm border border-white/80 bg-white/75 overflow-hidden">
                <button
                  onClick={() => setShowBonusSettings(v => !v)}
                  className="w-full flex items-center justify-between px-4 py-3.5 text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500">⚙️</span>
                    <p className="text-sm font-semibold text-gray-700">Налаштування ставок бонусу</p>
                  </div>
                  <svg
                    className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${showBonusSettings ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showBonusSettings && (
                  <div className="px-4 pb-4 space-y-3 border-t border-gray-100/80">
                    <div className="pt-3">
                      <label className="text-xs text-gray-400 mb-1 block">
                        Ставка за 1 замовлення (80–100)
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={editRateMid}
                          onChange={e => setEditRateMid(e.target.value.replace(/\D/g, ''))}
                          className="w-24 border border-gray-200 rounded-xl px-3 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-emerald-400"
                        />
                        <span className="text-sm text-gray-400">грн</span>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">
                        Ставка за 1 замовлення (101+)
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={editRateHigh}
                          onChange={e => setEditRateHigh(e.target.value.replace(/\D/g, ''))}
                          className="w-24 border border-gray-200 rounded-xl px-3 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-emerald-400"
                        />
                        <span className="text-sm text-gray-400">грн</span>
                      </div>
                    </div>
                    <button
                      disabled={savingRates}
                      onClick={async () => {
                        const mid = parseInt(editRateMid, 10)
                        const high = parseInt(editRateHigh, 10)
                        if (isNaN(mid) || isNaN(high) || mid < 0 || high < 0) return
                        setSavingRates(true)
                        try {
                          await supabase.rpc('set_crm_bonus_settings', { p_rate_mid: mid, p_rate_high: high })
                          await fetchBonusSettings()
                          await fetchMonthlyBonus()
                        } catch {/* ignore */} finally {
                          setSavingRates(false)
                        }
                      }}
                      className="w-full py-2.5 bg-emerald-500 text-white rounded-xl text-sm font-medium disabled:opacity-50"
                    >
                      {savingRates ? 'Збереження…' : 'Зберегти ставки'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>

    {editingEntry && (
      <div className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl border border-white">
          <h2 className="text-xl font-extrabold text-gray-900">Редагувати запис</h2>
          <p className="mt-1 text-sm text-gray-500">{editingEntry.user_name} · {new Date(editingEntry.created_at).toLocaleDateString('uk-UA')}</p>
          <div className="mt-4 space-y-3">
            <label className="text-xs font-medium text-gray-500 block">Кількість замовлень
              <input value={editOrders} onChange={e => setEditOrders(e.target.value.replace(/\D/g, ''))} inputMode="numeric" className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-3 text-lg focus:outline-none focus:ring-2 focus:ring-blue-300" />
            </label>
            <label className="text-xs font-medium text-gray-500 block">Кількість одиниць товару
              <input value={editUnits} onChange={e => setEditUnits(e.target.value.replace(/\D/g, ''))} inputMode="numeric" className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-3 text-lg focus:outline-none focus:ring-2 focus:ring-blue-300" />
            </label>
          </div>
          {submitError && <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">{submitError}</p>}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => { setEditingEntry(null); setSubmitError('') }} className="rounded-xl border border-gray-200 py-3 text-sm font-semibold text-gray-500">Скасувати</button>
            <button onClick={handleUpdateEntry} disabled={savingEntry || !editOrders || !editUnits} className="rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white disabled:opacity-40">{savingEntry ? 'Збереження…' : 'Зберегти зміни'}</button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
