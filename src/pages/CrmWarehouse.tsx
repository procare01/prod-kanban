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
// 0–80 orders  → 0 UAH
// 81–100       → (orders − 80) × 6 UAH
// 101+         → (orders − 80) × 8 UAH
function calcBonus(orders: number): number {
  if (orders <= 80) return 0
  if (orders <= 100) return (orders - 80) * 6
  return (orders - 80) * 8
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
  const isAdmin = user.role === 'admin' || user.role === 'crm_admin'

  const isCrmAdmin = user.role === 'crm_admin'
  const isCrm = user.role === 'crm'
  const [tab, setTab] = useState<Tab>(isCrmAdmin ? 'analytics' : 'input')
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>('7d')

  // Input form
  const [orders, setOrders] = useState('')
  const [units, setUnits] = useState('')
  const [selectedDate, setSelectedDate] = useState(toDateInputValue(new Date()))
  const [submitting, setSubmitting] = useState(false)
  const [submitSuccess, setSubmitSuccess] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)

  // Data
  const [dayData, setDayData] = useState<CrmTodayData | null>(null)
  const [analytics, setAnalytics] = useState<CrmAnalytics | null>(null)
  const [recentEntries, setRecentEntries] = useState<import('../types').CrmEntry[]>([])
  const [monthlyBonus, setMonthlyBonus] = useState<CrmMonthlyUserBonus[]>([])
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

  useEffect(() => { fetchDay(selectedDate) }, [fetchDay, selectedDate])

  useEffect(() => { fetchRecent() }, [fetchRecent])
  useEffect(() => { fetchMonthlyBonus() }, [fetchMonthlyBonus])

  useEffect(() => {
    if (tab === 'analytics') fetchAnalytics(chartPeriod === '7d' ? 7 : 30)
  }, [tab, chartPeriod, fetchAnalytics])

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
      // Build timestamp at noon on selected date so timezone shifts don't flip the day
      const ts = `${selectedDate}T12:00:00Z`
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

        {/* Tabs: crm sees only input, crm_admin sees only analytics, admin sees both */}
        {!isCrm && !isCrmAdmin && (
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

            {/* Bonus card — shown only if orders > 80 */}
            {!loadingDay && (() => {
              // For crm role show own bonus; for admin/crm_admin show per-user breakdown
              if (!isAdmin) {
                const bonus = calcBonus(totalOrders)
                if (bonus === 0 && totalOrders <= 80) return null
                return (
                  <div className={`rounded-2xl p-4 shadow-sm border ${bonus > 0 ? 'bg-yellow-50 border-yellow-200' : 'bg-white border-gray-100'}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-gray-500 mb-0.5">Бонус за день</p>
                        <p className={`text-2xl font-bold ${bonus > 0 ? 'text-yellow-700' : 'text-gray-400'}`}>
                          {bonus > 0 ? `${bonus} грн` : '0 грн'}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {totalOrders <= 80
                            ? 'Потрібно більше 80 замовлень'
                            : totalOrders <= 100
                              ? `(${totalOrders} − 80) × 6 грн`
                              : `(${totalOrders} − 80) × 8 грн`}
                        </p>
                      </div>
                      <span className="text-3xl">🏆</span>
                    </div>
                  </div>
                )
              }
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
                      const bonus = calcBonus(u.orders)
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
                    className="w-full border border-gray-200 rounded-xl px-4 py-4 text-sm
                               focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-400
                               text-gray-800 placeholder-gray-300 text-lg"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium block mb-1">Кількість одиниць товару</label>
                  <input
                    type="text" inputMode="numeric" pattern="[0-9]*" value={units}
                    onChange={e => setUnits(e.target.value.replace(/\D/g, ''))} placeholder="0"
                    className="w-full border border-gray-200 rounded-xl px-4 py-4 text-sm
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

            {/* Monthly bonus for crm user (own) */}
            {isCrm && monthlyBonus.length > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4 shadow-sm">
                <p className="text-sm font-semibold text-gray-700 mb-3">Мій бонус за місяць</p>
                {monthlyBonus.map(u => (
                  <div key={u.user_id} className="flex items-center justify-between">
                    <p className="text-xs text-gray-400">
                      {u.total_orders} замовл. · {u.days_active} {u.days_active === 1 ? 'день' : 'дні'}
                    </p>
                    <p className={`text-2xl font-bold ${u.total_bonus > 0 ? 'text-yellow-700' : 'text-gray-400'}`}>
                      {u.total_bonus} грн
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Last 40 entries */}
            {recentEntries.length > 0 && (
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                <p className="text-sm font-semibold text-gray-700 mb-3">
                  Останні записи
                </p>
                <div className="space-y-2">
                  {recentEntries.map(e => (
                    <div
                      key={e.id}
                      className="flex items-center justify-between text-sm py-1.5 border-b border-gray-50 last:border-0"
                    >
                      <div className="flex items-center gap-2">
                        {isAdmin && (
                          <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                            {e.user_name}
                          </span>
                        )}
                        <span className="text-gray-400 text-xs">
                          {new Date(e.created_at).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-600">
                        <span>
                          <span className="font-semibold text-gray-800">{e.orders_count}</span>
                          <span className="text-gray-400 ml-1">замовл.</span>
                        </span>
                        <span>
                          <span className="font-semibold text-gray-800">{e.units_count}</span>
                          <span className="text-gray-400 ml-1">од.</span>
                        </span>
                        <button
                          onClick={() => handleDelete(e.id)}
                          disabled={deleting === e.id}
                          className="text-gray-300 hover:text-red-400 transition-colors disabled:opacity-40 ml-1"
                        >
                          {deleting === e.id
                            ? <span className="w-3 h-3 border border-gray-300 border-t-transparent rounded-full animate-spin inline-block" />
                            : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                          }
                        </button>
                      </div>
                    </div>
                  ))}
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
                {/* KPI today */}
                <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                  <p className="text-sm font-semibold text-gray-700 mb-3">ККД за сьогодні</p>
                  {dayData && (
                    <>
                      <div className="grid grid-cols-2 gap-3 mb-4">
                        <div className="bg-emerald-50 rounded-xl p-3">
                          <p className="text-xs text-gray-400 mb-0.5">Замовлень/год</p>
                          <p className="text-lg font-bold text-emerald-700">{(dayData.total_orders / 8).toFixed(1)}</p>
                          <p className="text-xs text-gray-400">Всього: {dayData.total_orders}</p>
                        </div>
                        <div className="bg-blue-50 rounded-xl p-3">
                          <p className="text-xs text-gray-400 mb-0.5">Одиниць/год</p>
                          <p className="text-lg font-bold text-blue-700">{(dayData.total_units / 8).toFixed(1)}</p>
                          <p className="text-xs text-gray-400">Всього: {dayData.total_units}</p>
                        </div>
                      </div>
                      {analytics.by_user_today && analytics.by_user_today.length > 0 && (
                        <div className="space-y-3">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">По співробітниках</p>
                          {analytics.by_user_today.map(u => {
                            const maxO = Math.max(...analytics.by_user_today.map(x => x.orders_per_hour), 1)
                            const maxU = Math.max(...analytics.by_user_today.map(x => x.units_per_hour), 1)
                            return (
                              <div key={u.user_id} className="border border-gray-100 rounded-xl p-3">
                                <div className="flex items-center justify-between mb-2">
                                  <p className="text-sm font-semibold text-gray-700">{u.user_name}</p>
                                  <div className="flex items-center gap-2">
                                    {calcBonus(u.total_orders) > 0 && (
                                      <span className="text-xs font-bold text-yellow-700 bg-yellow-50 px-2 py-0.5 rounded-full">
                                        {calcBonus(u.total_orders)} грн
                                      </span>
                                    )}
                                    <span className="text-xs text-gray-400">{u.total_orders} замовл. · {u.total_units} од.</span>
                                  </div>
                                </div>
                                <div className="space-y-1.5">
                                  <div>
                                    <div className="flex justify-between text-xs text-gray-400">
                                      <span>Замовлень/год</span>
                                      <span className="font-semibold text-emerald-600">{u.orders_per_hour}</span>
                                    </div>
                                    <KpiBar value={u.orders_per_hour} max={maxO} color="#10b981" />
                                  </div>
                                  <div>
                                    <div className="flex justify-between text-xs text-gray-400">
                                      <span>Одиниць/год</span>
                                      <span className="font-semibold text-blue-600">{u.units_per_hour}</span>
                                    </div>
                                    <KpiBar value={u.units_per_hour} max={maxU} color="#3b82f6" />
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Bonus table — crm_admin only, users with > 80 orders */}
                {isCrmAdmin && analytics.by_user_today && analytics.by_user_today.length > 0 && (() => {
                  const bonusRows = analytics.by_user_today.filter(u => u.total_orders > 80)
                  if (bonusRows.length === 0) return (
                    <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                      <p className="text-sm font-semibold text-gray-700 mb-1">Бонуси співробітників</p>
                      <p className="text-sm text-gray-400">Поки ніхто не перевищив 80 замовлень</p>
                    </div>
                  )
                  const totalBonus = bonusRows.reduce((s, u) => s + calcBonus(u.total_orders), 0)
                  return (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4 shadow-sm">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-sm font-semibold text-gray-700">Бонуси співробітників</p>
                        <span className="text-sm font-bold text-yellow-700">Всього: {totalBonus} грн</span>
                      </div>
                      <div className="space-y-2">
                        {analytics.by_user_today.map(u => {
                          const bonus = calcBonus(u.total_orders)
                          return (
                            <div key={u.user_id} className="flex items-center justify-between bg-white rounded-xl px-3 py-2.5">
                              <div>
                                <p className="text-sm font-semibold text-gray-700">{u.user_name}</p>
                                <p className="text-xs text-gray-400">{u.total_orders} замовлень</p>
                              </div>
                              <div className="text-right">
                                {bonus > 0 ? (
                                  <>
                                    <p className="text-base font-bold text-yellow-700">{bonus} грн</p>
                                    <p className="text-xs text-gray-400">
                                      {u.total_orders <= 100
                                        ? `(${u.total_orders}−80)×6`
                                        : `(${u.total_orders}−80)×8`}
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

                {/* Monthly bonus — crm_admin sees all users, crm sees own */}
                {monthlyBonus.length > 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-semibold text-gray-700">Бонуси за місяць</p>
                      {isCrmAdmin && (
                        <span className="text-sm font-bold text-yellow-700">
                          Всього: {monthlyBonus.reduce((s, u) => s + u.total_bonus, 0)} грн
                        </span>
                      )}
                    </div>
                    <div className="space-y-2">
                      {monthlyBonus.map(u => (
                        <div key={u.user_id} className="flex items-center justify-between bg-white rounded-xl px-3 py-2.5">
                          <div>
                            {isCrmAdmin && <p className="text-sm font-semibold text-gray-700">{u.user_name}</p>}
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
          </>
        )}
      </div>
    </div>
  )
}
