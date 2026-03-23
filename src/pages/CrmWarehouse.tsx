import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { User, CrmTodayData, CrmAnalytics, CrmDailyPoint, CrmMonthlyUserBonus } from '../types'

interface Props {
  user: User
  onLogout: () => void
}

type Tab = 'input' | 'analytics'
type ChartPeriod = '7d' | '30d'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function toDateInputValue(d: Date) {
  return d.toISOString().slice(0, 10) // YYYY-MM-DD for <input type="date">
}

function formatDisplayDate(iso: string) {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y.slice(2)}`
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
  const fill = color === 'emerald' ? '#10b981' : '#3b82f6'

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
      {data.map((d, i) => {
        const v = label === 'orders' ? d.orders : d.units
        const bh = Math.max((v / max) * (H - 4), v > 0 ? 4 : 0)
        const x = i * (barW + 2)
        return <rect key={i} x={x} y={H - bh} width={barW} height={bh} rx={2} fill={fill} opacity={0.8} />
      })}
    </svg>
  )
}

// ─── KPI bar ──────────────────────────────────────────────────────────────────
function KpiBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1">
      <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
export function CrmWarehouse({ user, onLogout }: Props) {
  const navigate = useNavigate()
  const isAdmin = user.role === 'admin' || user.role === 'super_admin' || user.role === 'ceo' || user.role === 'crm_admin'

  const isCrmAdmin = user.role === 'crm_admin'
  const isCrm = user.role === 'crm'
  const isCeo = user.role === 'ceo'
  const isAdminWithCrmAccess = user.role === 'super_admin' ||
    (user.role === 'admin' && (user.pin === '1505' || user.pin === '7985'))
  // ceo бачить аналітику але без бонусів і налаштувань
  const showBonusAsAdmin = user.role === 'crm_admin' || isAdminWithCrmAccess
  const [tab, setTab] = useState<Tab>((isCrmAdmin || isCeo) ? 'analytics' : 'input')
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>('7d')

  // Input form
  const [orders, setOrders] = useState('')
  const [units, setUnits] = useState('')
  const [selectedDate, setSelectedDate] = useState(toDateInputValue(new Date()))
  const [submitting, setSubmitting] = useState(false)
  const [submitSuccess, setSubmitSuccess] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)

  // Analytics date picker
  const [analyticsDate, setAnalyticsDate] = useState(toDateInputValue(new Date()))
  const isAnalyticsToday = analyticsDate === toDateInputValue(new Date())

  // Data
  const [dayData, setDayData] = useState<CrmTodayData | null>(null)
  const [analyticsDayData, setAnalyticsDayData] = useState<CrmTodayData | null>(null)
  const [analytics, setAnalytics] = useState<CrmAnalytics | null>(null)
  const [recentEntries, setRecentEntries] = useState<import('../types').CrmEntry[]>([])
  const [monthlyBonus, setMonthlyBonus] = useState<CrmMonthlyUserBonus[]>([])
  const [bonusSettings, setBonusSettings] = useState<BonusSettings>(DEFAULT_BONUS)
  const [editRateMid, setEditRateMid] = useState('')
  const [editRateHigh, setEditRateHigh] = useState('')
  const [savingRates, setSavingRates] = useState(false)
  const [loadingDay, setLoadingDay] = useState(true)
  const [loadingAnalytics, setLoadingAnalytics] = useState(false)

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
      const { data } = await supabase.rpc('get_crm_today', {
        p_user_id: user.id,
        p_is_admin: isAdmin,
        p_date: date,
      })
      if (data) setAnalyticsDayData(data as CrmTodayData)
    } catch {/* ignore */}
  }, [user.id, isAdmin])

  // ── Fetch analytics ─────────────────────────────────────────────────────────
  const fetchAnalytics = useCallback(async (days: number) => {
    setLoadingAnalytics(true)
    try {
      const { data } = await supabase.rpc('get_crm_analytics', {
        p_user_id: user.id,
        p_is_admin: isAdmin,
        p_days: days,
      })
      if (data) setAnalytics(data as CrmAnalytics)
    } catch {/* ignore */} finally {
      setLoadingAnalytics(false)
    }
  }, [user.id, isAdmin])

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
        p_limit: 40,
      })
      if (data) setRecentEntries(data as import('../types').CrmEntry[])
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

  useEffect(() => { fetchDay(selectedDate) }, [fetchDay, selectedDate])

  useEffect(() => { fetchRecent() }, [fetchRecent])
  useEffect(() => { fetchMonthlyBonus() }, [fetchMonthlyBonus])
  useEffect(() => { fetchBonusSettings() }, [fetchBonusSettings])

  useEffect(() => {
    if (tab === 'analytics') {
      fetchAnalytics(chartPeriod === '7d' ? 7 : 30)
      fetchAnalyticsDay(analyticsDate)
    }
  }, [tab, chartPeriod, fetchAnalytics, fetchAnalyticsDay, analyticsDate])

  // ── Submit entry ────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    const o = parseInt(orders, 10)
    const u = parseInt(units, 10)
    if (isNaN(o) || isNaN(u) || o < 0 || u < 0) {
      setSubmitError('Введіть коректні числа')
      return
    }
    setSubmitting(true)
    setSubmitError('')
    try {
      // For today — use real current time; for past dates — use noon Kyiv (10:00 UTC) to anchor to that date
      const todayStr = toDateInputValue(new Date())
      const ts = selectedDate === todayStr
        ? new Date().toISOString()
        : `${selectedDate}T10:00:00Z`
      await supabase.rpc('submit_crm_entry', {
        p_user_id: user.id,
        p_orders: o,
        p_units: u,
        p_created_at: ts,
      })
      setOrders('')
      setUnits('')
      setSubmitSuccess(true)
      setTimeout(() => setSubmitSuccess(false), 2500)
      fetchDay(selectedDate)
      fetchRecent()
      fetchMonthlyBonus()
    } catch {
      setSubmitError('Помилка збереження. Спробуйте ще раз.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Delete entry ─────────────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    if (!window.confirm('Видалити цей запис?')) return
    setDeleting(id)
    try {
      await supabase.rpc('delete_crm_entry', { p_id: id })
      fetchDay(selectedDate)
      fetchRecent()
      fetchMonthlyBonus()
    } catch {/* ignore */} finally {
      setDeleting(null)
    }
  }

  // ── Derived ──────────────────────────────────────────────────────────────────
  const chartData = useMemo(() => {
    if (!analytics?.daily) return []
    return analytics.daily.slice(-(chartPeriod === '7d' ? 7 : 30))
  }, [analytics, chartPeriod])

  const entries = useMemo(() => {
    if (!dayData?.entries) return []
    if (isAdmin) return dayData.entries
    return dayData.entries.filter(e => e.user_id === user.id)
  }, [dayData, isAdmin, user.id])

  const totalOrders = entries.reduce((s, e) => s + e.orders_count, 0)
  const totalUnits  = entries.reduce((s, e) => s + e.units_count, 0)

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      <div className="max-w-screen-sm mx-auto px-3 pt-3 space-y-3">

        {/* Header */}
        <div className="bg-white rounded-2xl px-4 py-3 shadow-sm border border-gray-100 flex items-center justify-between">
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

        {/* Tabs: crm sees only input, crm_admin/ceo see only analytics, admin sees both */}
        {!isCrm && !isCrmAdmin && !isCeo && (
          <div className="flex bg-white rounded-2xl p-1 shadow-sm border border-gray-100 gap-1">
            {(['input', 'analytics'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-colors
                  ${tab === t ? 'bg-emerald-500 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
              >
                {t === 'input' ? 'Введення даних' : 'Аналітика'}
              </button>
            ))}
          </div>
        )}

        {/* ── INPUT TAB ──────────────────────────────────────────────────────── */}
        {tab === 'input' && (
          <>
            {/* Date picker */}
            <div className="bg-white rounded-2xl px-4 py-3 shadow-sm border border-gray-100 flex items-center justify-between">
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

            {/* Quick stats */}
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                <p className="text-xs text-gray-400 mb-1">{isToday ? 'Замовлень сьогодні' : 'Замовлень за день'}</p>
                <p className="text-2xl font-bold text-gray-800">{loadingDay ? '—' : totalOrders}</p>
              </div>
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                <p className="text-xs text-gray-400 mb-1">Одиниць товару</p>
                <p className="text-2xl font-bold text-gray-800">{loadingDay ? '—' : totalUnits}</p>
              </div>
            </div>

            {/* Bonus row for crm: day bonus + monthly bonus side by side */}
            {isCrm && !loadingDay && (() => {
              const bonus = calcBonus(totalOrders, bonusSettings)
              const monthBonus = monthlyBonus[0]?.total_bonus ?? 0
              const now = new Date()
              const mm = String(now.getMonth() + 1).padStart(2, '0')
              const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
              return (
                <div className="grid grid-cols-2 gap-3">
                  {/* Day bonus */}
                  <div className={`rounded-2xl p-4 shadow-sm border flex flex-col justify-start min-h-[96px]
                    ${bonus > 0 ? 'bg-gradient-to-br from-yellow-50 to-amber-50 border-yellow-200' : 'bg-white border-gray-100'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Бонус за день</p>
                      <span className="text-lg">🏆</span>
                    </div>
                    <div>
                      <p className={`text-3xl font-extrabold leading-none ${bonus > 0 ? 'text-amber-600' : 'text-gray-300'}`}>
                        {bonus > 0 ? `${bonus}` : '—'}
                      </p>
                      {bonus > 0
                        ? <p className="text-sm font-semibold text-amber-500 mt-0.5">грн</p>
                        : <p className="text-xs text-gray-400 mt-1">від 80 замовл.</p>
                      }
                    </div>
                  </div>
                  {/* Monthly bonus */}
                  <div className={`rounded-2xl p-4 shadow-sm border flex flex-col justify-start min-h-[96px]
                    ${monthBonus > 0 ? 'bg-gradient-to-br from-yellow-50 to-amber-50 border-yellow-200' : 'bg-white border-gray-100'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">За місяць</p>
                      <span className="text-lg">📅</span>
                    </div>
                    <div>
                      <p className={`text-3xl font-extrabold leading-none ${monthBonus > 0 ? 'text-amber-600' : 'text-gray-300'}`}>
                        {monthBonus > 0 ? `${monthBonus}` : '—'}
                      </p>
                      {monthBonus > 0
                        ? <p className="text-sm font-semibold text-amber-500 mt-0.5">грн</p>
                        : <p className="text-xs text-gray-400 mt-1">немає бонусів</p>
                      }
                      <p className="text-xs text-gray-300 mt-1">01.{mm}–{String(last).padStart(2,'0')}.{mm}</p>
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* Bonus card for admin/crm_admin — per-user breakdown */}
            {!isCrm && !loadingDay && (() => {
              // Admin/crm_admin: per-user bonus table
              if (!dayData?.entries || dayData.entries.length === 0) return null
              // Group by user
              const byUser: Record<string, { name: string; orders: number }> = {}
              dayData.entries.forEach(e => {
                if (!byUser[e.user_id]) byUser[e.user_id] = { name: e.user_name, orders: 0 }
                byUser[e.user_id].orders += e.orders_count
              })
              const rows = Object.values(byUser).filter(u => u.orders > 0)
              if (rows.length === 0) return null
              return (
                <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4 shadow-sm">
                  <p className="text-sm font-semibold text-gray-700 mb-3">Бонуси за день</p>
                  <div className="space-y-2">
                    {rows.map(u => {
                      const bonus = calcBonus(u.orders, bonusSettings)
                      return (
                        <div key={u.name} className="flex items-center justify-between text-sm">
                          <div>
                            <span className="font-medium text-gray-700">{u.name}</span>
                            <span className="text-xs text-gray-400 ml-2">{u.orders} замовл.</span>
                          </div>
                          <span className={`font-bold ${bonus > 0 ? 'text-yellow-700' : 'text-gray-400'}`}>
                            {bonus > 0 ? `${bonus} грн` : '—'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}

            {/* Input form */}
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 space-y-4">
              <p className="text-sm font-semibold text-gray-700">Додати запис</p>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500 font-medium block mb-1">Кількість замовлень</label>
                  <input
                    type="text" inputMode="numeric" pattern="[0-9]*" value={orders}
                    onChange={e => setOrders(e.target.value.replace(/\D/g, ''))} placeholder="0"
                    className="w-4/5 block mx-auto border border-gray-200 rounded-xl px-4 py-4
                               focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-400
                               text-gray-800 placeholder-gray-300 text-lg"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium block mb-1">Кількість одиниць товару</label>
                  <input
                    type="text" inputMode="numeric" pattern="[0-9]*" value={units}
                    onChange={e => setUnits(e.target.value.replace(/\D/g, ''))} placeholder="0"
                    className="w-4/5 block mx-auto border border-gray-200 rounded-xl px-4 py-4
                               focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-400
                               text-gray-800 placeholder-gray-300 text-lg"
                  />
                </div>
              </div>

              {submitError && (
                <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{submitError}</p>
              )}
              {submitSuccess && (
                <p className="text-xs text-emerald-600 bg-emerald-50 rounded-lg px-3 py-2">Збережено успішно</p>
              )}

              <button
                onClick={handleSubmit}
                disabled={submitting || !orders || !units}
                className="w-full bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700
                           text-white font-semibold rounded-xl py-3 text-sm
                           disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? 'Збереження...' : `Зберегти за ${formatDisplayDate(selectedDate)}`}
              </button>
            </div>


            {/* Last 40 entries */}
            {recentEntries.length > 0 && (
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                <p className="text-sm font-semibold text-gray-700 mb-3">Останні записи</p>
                <div className="space-y-1.5">
                  {recentEntries.map(e => {
                    const bonus = calcBonus(e.orders_count, bonusSettings)
                    const dateStr = new Date(e.created_at).toLocaleString('uk-UA', {
                      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                      timeZone: 'Europe/Kyiv'
                    })
                    return (
                      <div key={e.id} className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2.5">
                        {/* Left: name + date */}
                        <div className="flex-1 min-w-0">
                          {isAdmin && (
                            <p className="text-xs font-semibold text-emerald-700 truncate">{e.user_name}</p>
                          )}
                          <p className="text-xs text-gray-400">{dateStr}</p>
                        </div>

                        {/* Bonus */}
                        <div className="w-16 text-right">
                          {bonus > 0
                            ? <span className="text-sm font-bold text-amber-500">{bonus} грн</span>
                            : <span className="text-xs text-gray-200">—</span>
                          }
                        </div>

                        {/* Orders */}
                        <div className="w-20 text-right">
                          <span className="text-sm font-bold text-gray-800">{e.orders_count}</span>
                          <span className="text-xs text-gray-400 ml-1">замовл.</span>
                        </div>

                        {/* Units */}
                        <div className="w-20 text-right">
                          <span className="text-sm font-bold text-gray-800">{e.units_count}</span>
                          <span className="text-xs text-gray-400 ml-1">од.</span>
                        </div>

                        {/* Delete — hidden for crm role */}
                        {!isCrm && (
                          <button
                            onClick={() => handleDelete(e.id)}
                            disabled={deleting === e.id}
                            className="text-gray-300 hover:text-red-400 transition-colors disabled:opacity-40 ml-1 flex-shrink-0"
                          >
                            {deleting === e.id
                              ? <span className="w-3 h-3 border border-gray-300 border-t-transparent rounded-full animate-spin inline-block" />
                              : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            }
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── ANALYTICS TAB ──────────────────────────────────────────────────── */}
        {tab === 'analytics' && (
          <>
            <div className="flex bg-white rounded-2xl p-1 shadow-sm border border-gray-100 gap-1">
              {(['7d', '30d'] as ChartPeriod[]).map(p => (
                <button
                  key={p}
                  onClick={() => setChartPeriod(p)}
                  className={`flex-1 py-1.5 rounded-xl text-xs font-semibold transition-colors
                    ${chartPeriod === p ? 'bg-emerald-500 text-white' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  {p === '7d' ? '7 днів' : '1 місяць'}
                </button>
              ))}
            </div>

            {loadingAnalytics && (
              <div className="flex justify-center py-8">
                <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {analytics && !loadingAnalytics && (
              <>
                {/* KPI for selected day */}
                <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-700">
                        ККД за {isAnalyticsToday ? 'сьогодні' : formatDisplayDate(analyticsDate)}
                      </p>
                      {!isAnalyticsToday && (
                        <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">минуле</span>
                      )}
                    </div>
                    <input
                      type="date"
                      value={analyticsDate}
                      max={toDateInputValue(new Date())}
                      onChange={e => { if (e.target.value) setAnalyticsDate(e.target.value) }}
                      className="text-xs text-gray-500 border border-gray-200 rounded-lg px-2 py-1
                                 focus:outline-none focus:ring-2 focus:ring-emerald-300"
                    />
                  </div>
                  {analyticsDayData && (
                    <>
                      <div className="grid grid-cols-2 gap-3 mb-4">
                        <div className="bg-emerald-50 rounded-xl p-3">
                          <p className="text-xs text-gray-400 mb-0.5">Замовлень/год</p>
                          <p className="text-lg font-bold text-emerald-700">{(analyticsDayData.total_orders / 8).toFixed(1)}</p>
                          <p className="text-xs text-gray-400">Всього: {analyticsDayData.total_orders}</p>
                        </div>
                        <div className="bg-blue-50 rounded-xl p-3">
                          <p className="text-xs text-gray-400 mb-0.5">Одиниць/год</p>
                          <p className="text-lg font-bold text-blue-700">{(analyticsDayData.total_units / 8).toFixed(1)}</p>
                          <p className="text-xs text-gray-400">Всього: {analyticsDayData.total_units}</p>
                        </div>
                      </div>
                      {analyticsDayData.entries && analyticsDayData.entries.length > 0 && (() => {
                        // Group entries by user for per-user KPI
                        const byUser: Record<string, { user_id: string; user_name: string; orders: number; units: number }> = {}
                        analyticsDayData.entries.forEach(e => {
                          if (!byUser[e.user_id]) byUser[e.user_id] = { user_id: e.user_id, user_name: e.user_name, orders: 0, units: 0 }
                          byUser[e.user_id].orders += e.orders_count
                          byUser[e.user_id].units += e.units_count
                        })
                        const rows = Object.values(byUser)
                        if (rows.length === 0) return null
                        const maxO = Math.max(...rows.map(u => u.orders), 1)
                        const maxU = Math.max(...rows.map(u => u.units), 1)
                        return (
                          <div className="space-y-3">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">По співробітниках</p>
                            {rows.map(u => (
                              <div key={u.user_id} className="border border-gray-100 rounded-xl p-3">
                                <div className="flex items-center justify-between mb-2">
                                  <p className="text-sm font-semibold text-gray-700">{u.user_name}</p>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs text-gray-400">{u.orders} замовл. · {u.units} од.</span>
                                  </div>
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
                            {/* Total row */}
                            <div className="border-t-2 border-gray-200 mt-2 pt-3 flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
                              <span className="text-base font-bold text-gray-600">Всього</span>
                              <div className="flex items-center gap-4">
                                <span>
                                  <span className="text-2xl font-bold text-emerald-700">
                                    {rows.reduce((s, u) => s + u.orders, 0)}
                                  </span>
                                  <span className="text-sm text-gray-400 ml-1">замовл.</span>
                                </span>
                                <span>
                                  <span className="text-2xl font-bold text-blue-700">
                                    {rows.reduce((s, u) => s + u.units, 0)}
                                  </span>
                                  <span className="text-sm text-gray-400 ml-1">од.</span>
                                </span>
                              </div>
                            </div>
                          </div>
                        )
                      })()}
                    </>
                  )}
                </div>

                {/* Monthly totals */}
                {analytics.monthly && (
                  <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                    <p className="text-sm font-semibold text-gray-700 mb-3">За цей місяць</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-emerald-50 rounded-xl p-3 text-center">
                        <p className="text-2xl font-bold text-emerald-700">{analytics.monthly.total_orders}</p>
                        <p className="text-xs text-gray-400 mt-0.5">замовлень</p>
                      </div>
                      <div className="bg-blue-50 rounded-xl p-3 text-center">
                        <p className="text-2xl font-bold text-blue-700">{analytics.monthly.total_units}</p>
                        <p className="text-xs text-gray-400 mt-0.5">одиниць товару</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Chart: orders */}
                <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold text-gray-700">Замовлення</p>
                    <span className="text-xs text-gray-400">{chartPeriod === '7d' ? '7 днів' : '30 днів'}</span>
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
                </div>

                {/* Chart: units */}
                <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold text-gray-700">Одиниці товару</p>
                    <span className="text-xs text-gray-400">{chartPeriod === '7d' ? '7 днів' : '30 днів'}</span>
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
                </div>

                {/* Bonus table — crm_admin / admin 1505/7985, users with >= 80 orders */}
                {showBonusAsAdmin && analyticsDayData && analyticsDayData.entries && analyticsDayData.entries.length > 0 && (() => {
                  const byUser: Record<string, { user_id: string; user_name: string; orders: number }> = {}
                  analyticsDayData.entries.forEach(e => {
                    if (!byUser[e.user_id]) byUser[e.user_id] = { user_id: e.user_id, user_name: e.user_name, orders: 0 }
                    byUser[e.user_id].orders += e.orders_count
                  })
                  const rows = Object.values(byUser)
                  const bonusRows = rows.filter(u => u.orders >= 80)
                  if (bonusRows.length === 0) return (
                    <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                      <p className="text-sm font-semibold text-gray-700 mb-1">Бонуси співробітників</p>
                      <p className="text-sm text-gray-400">Поки ніхто не досяг 80 замовлень</p>
                    </div>
                  )
                  const totalBonus = rows.reduce((s, u) => s + calcBonus(u.orders, bonusSettings), 0)
                  return (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4 shadow-sm">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-sm font-semibold text-gray-700">Бонуси співробітників</p>
                        <span className="text-sm font-bold text-yellow-700">Всього: {totalBonus} грн</span>
                      </div>
                      <div className="space-y-2">
                        {rows.map(u => {
                          const bonus = calcBonus(u.orders, bonusSettings)
                          return (
                            <div key={u.user_id} className="flex items-center justify-between bg-white rounded-xl px-3 py-2.5">
                              <div>
                                <p className="text-sm font-semibold text-gray-700">{u.user_name}</p>
                                <p className="text-xs text-gray-400">{u.orders} замовлень</p>
                              </div>
                              <div className="text-right">
                                {bonus > 0 ? (
                                  <>
                                    <p className="text-base font-bold text-yellow-700">{bonus} грн</p>
                                    <p className="text-xs text-gray-400">
                                      {u.orders <= 100
                                        ? `(${u.orders}−${bonusSettings.threshold})×${bonusSettings.rate_mid}`
                                        : `(${u.orders}−${bonusSettings.threshold})×${bonusSettings.rate_high}`}
                                    </p>
                                  </>
                                ) : (
                                  <p className="text-sm text-gray-300">— грн</p>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })()}

                {/* Monthly bonus — crm_admin sees all users, crm sees own, ceo hidden */}
                {monthlyBonus.length > 0 && !isCeo && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-semibold text-gray-700">Бонуси за місяць</p>
                      {showBonusAsAdmin && (
                        <span className="text-sm font-bold text-yellow-700">
                          Всього: {monthlyBonus.reduce((s, u) => s + u.total_bonus, 0)} грн
                        </span>
                      )}
                    </div>
                    <div className="space-y-2">
                      {monthlyBonus.map(u => (
                        <div key={u.user_id} className="flex items-center justify-between bg-white rounded-xl px-3 py-2.5">
                          <div>
                            {showBonusAsAdmin && <p className="text-sm font-semibold text-gray-700">{u.user_name}</p>}
                            <p className="text-xs text-gray-400">
                              {u.total_orders} замовл. · {u.days_active} {u.days_active === 1 ? 'день' : 'дні'}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className={`text-base font-bold ${u.total_bonus > 0 ? 'text-yellow-700' : 'text-gray-400'}`}>
                              {u.total_bonus > 0 ? `${u.total_bonus} грн` : '0 грн'}
                            </p>
                            <p className="text-xs text-gray-400">бонус</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Bonus rate settings — admin 1505 / crm_admin */}
            {showBonusAsAdmin && (
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                <p className="text-sm font-semibold text-gray-700 mb-3">Налаштування ставок бонусу</p>
                <div className="space-y-3">
                  <div>
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
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
