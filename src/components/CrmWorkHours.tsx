import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { CrmMonthDashboardRow } from '../types'

interface Props {
  adminId: string
  adminPin: string
}

type HourDraft = {
  regular_hours: string
  overtime_hours: string
  overtime_coefficient: string
  saturday_hours: string
  saturdays_worked: string
}

function toMonthValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`
}

function shiftMonth(value: string, direction: -1 | 1) {
  const [year, month] = value.split('-').map(Number)
  return toMonthValue(new Date(year, month - 1 + direction, 1))
}

function monthLabel(value: string) {
  const [year, month] = value.split('-').map(Number)
  const label = new Date(year, month - 1, 1).toLocaleDateString('uk-UA', {
    month: 'long',
    year: 'numeric',
  })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function numberValue(value: string) {
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function formatHours(value: number) {
  return Number(value).toLocaleString('uk-UA', { maximumFractionDigits: 2 })
}

export function CrmWorkHours({ adminId, adminPin }: Props) {
  const currentMonth = toMonthValue(new Date())
  const [month, setMonth] = useState(currentMonth)
  const [rows, setRows] = useState<CrmMonthDashboardRow[]>([])
  const [drafts, setDrafts] = useState<Record<string, HourDraft>>({})
  const [loading, setLoading] = useState(true)
  const [savingUserId, setSavingUserId] = useState<string | null>(null)
  const [savedUserId, setSavedUserId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: rpcError } = await supabase.rpc('get_crm_month_dashboard', {
        p_admin_id: adminId,
        p_admin_pin: adminPin,
        p_month: month,
      })
      if (rpcError) throw rpcError
      const nextRows = (data ?? []) as CrmMonthDashboardRow[]
      setRows(nextRows)
      setDrafts(Object.fromEntries(nextRows.map(row => [row.user_id, {
        regular_hours: String(row.regular_hours ?? 0),
        overtime_hours: String(row.overtime_hours ?? 0),
        overtime_coefficient: String(row.overtime_coefficient ?? 1.5),
        saturday_hours: String(row.saturday_hours ?? 0),
        saturdays_worked: String(row.saturdays_worked ?? 0),
      }])))
    } catch {
      setRows([])
      setError('Не вдалося завантажити помісячний дашборд. Застосуйте міграції 023–024 у Supabase.')
    } finally {
      setLoading(false)
    }
  }, [adminId, adminPin, month])

  useEffect(() => { loadDashboard() }, [loadDashboard])

  const totals = useMemo(() => rows.reduce((acc, row) => ({
    orders: acc.orders + Number(row.total_orders || 0),
    units: acc.units + Number(row.total_units || 0),
    bonus: acc.bonus + Number(row.total_bonus || 0),
    hours: acc.hours + Number(row.weighted_hours || 0),
  }), { orders: 0, units: 0, bonus: 0, hours: 0 }), [rows])

  const updateDraft = (userId: string, field: keyof HourDraft, value: string) => {
    const sanitized = field === 'saturdays_worked'
      ? value.replace(/\D/g, '')
      : value.replace(/[^\d.,]/g, '')
    setDrafts(current => ({
      ...current,
      [userId]: { ...current[userId], [field]: sanitized },
    }))
  }

  const saveHours = async (userId: string) => {
    const draft = drafts[userId]
    if (!draft) return
    setSavingUserId(userId)
    setSavedUserId(null)
    setError('')
    try {
      const { error: rpcError } = await supabase.rpc('set_crm_work_hours', {
        p_admin_id: adminId,
        p_admin_pin: adminPin,
        p_user_id: userId,
        p_month: month,
        p_regular_hours: numberValue(draft.regular_hours),
        p_overtime_hours: numberValue(draft.overtime_hours),
        p_overtime_coefficient: numberValue(draft.overtime_coefficient),
        p_saturday_hours: numberValue(draft.saturday_hours),
        p_saturdays_worked: Math.floor(numberValue(draft.saturdays_worked)),
      })
      if (rpcError) throw rpcError
      setSavedUserId(userId)
      await loadDashboard()
      window.setTimeout(() => setSavedUserId(null), 2000)
    } catch {
      setError('Не вдалося зберегти години. Перевірте дані та повторіть спробу.')
    } finally {
      setSavingUserId(null)
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-3xl px-4 py-3 shadow-md backdrop-blur-sm border border-white/80 bg-white/75 flex items-center justify-between">
        <button
          onClick={() => setMonth(value => shiftMonth(value, -1))}
          className="w-10 h-10 rounded-xl border border-gray-200 bg-white text-gray-500 hover:text-blue-600"
          aria-label="Попередній місяць"
        >
          ‹
        </button>
        <div className="text-center">
          <p className="text-xs uppercase tracking-wide text-gray-400">Календарний місяць</p>
          <p className="text-base font-bold text-gray-800">{monthLabel(month)}</p>
        </div>
        <button
          onClick={() => setMonth(value => shiftMonth(value, 1))}
          disabled={month === currentMonth}
          className="w-10 h-10 rounded-xl border border-gray-200 bg-white text-gray-500 hover:text-blue-600 disabled:opacity-30"
          aria-label="Наступний місяць"
        >
          ›
        </button>
      </div>

      <div className="rounded-3xl p-4 shadow-md bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-950 text-white">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <p className="text-xs text-blue-200 uppercase tracking-wide">Загальний дашборд</p>
            <h2 className="text-lg font-extrabold">Підсумок за {monthLabel(month).toLowerCase()}</h2>
          </div>
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-blue-100">{rows.length} працівн.</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl bg-white/10 p-3"><p className="text-xs text-blue-200">Замовлення</p><p className="text-2xl font-extrabold">{totals.orders}</p></div>
          <div className="rounded-2xl bg-white/10 p-3"><p className="text-xs text-blue-200">Одиниці</p><p className="text-2xl font-extrabold">{totals.units}</p></div>
          <div className="rounded-2xl bg-amber-400/15 p-3"><p className="text-xs text-amber-200">Бонуси</p><p className="text-2xl font-extrabold text-amber-300">{totals.bonus} грн</p></div>
          <div className="rounded-2xl bg-emerald-400/15 p-3"><p className="text-xs text-emerald-200">Оплачувані години</p><p className="text-2xl font-extrabold text-emerald-300">{formatHours(totals.hours)}</p></div>
        </div>
      </div>

      <div className="rounded-2xl px-4 py-3 bg-amber-50 border border-amber-200 text-xs text-amber-800">
        Звичайні години ×1 · переробка за вибраним коефіцієнтом ×1 / ×1,2 / ×1,5 / ×2 · суботні години ×1,2 для 1–2 субот або ×1,5 для 3 і більше.
      </div>

      {error && <p className="rounded-2xl px-4 py-3 bg-red-50 border border-red-100 text-sm text-red-600">{error}</p>}

      {loading ? (
        <div className="rounded-3xl bg-white/75 border border-white p-8 flex justify-center">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-3xl bg-white/75 border border-white p-8 text-center text-sm text-gray-400">Немає працівників CRM</div>
      ) : (
        <div className="space-y-3">
          {rows.map(row => {
            const draft = drafts[row.user_id]
            const saturdays = Math.floor(numberValue(draft?.saturdays_worked ?? '0'))
            const saturdayRate = saturdays >= 3 ? 1.5 : saturdays >= 1 ? 1.2 : 1
            const overtimeRate = numberValue(draft?.overtime_coefficient ?? '1.5')
            const calculatedHours = numberValue(draft?.regular_hours ?? '0')
              + numberValue(draft?.overtime_hours ?? '0') * overtimeRate
              + numberValue(draft?.saturday_hours ?? '0') * saturdayRate
            const productivity = calculatedHours > 0 ? row.total_orders / calculatedHours : 0

            return (
              <div key={row.user_id} className="rounded-3xl p-4 shadow-md backdrop-blur-sm border border-white/80 bg-white/80">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <p className="font-bold text-gray-800">{row.user_name}</p>
                    <p className="text-xs text-gray-400">{row.total_orders} замовл. · {row.total_units} од. · {row.days_active} днів</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-extrabold text-amber-600">{row.total_bonus} грн</p>
                    <p className="text-xs text-gray-400">бонус</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs text-gray-500">
                    Звичайні години
                    <input value={draft?.regular_hours ?? ''} onChange={e => updateDraft(row.user_id, 'regular_hours', e.target.value)} inputMode="decimal" className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-base text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-300" />
                  </label>
                  <label className="text-xs text-gray-500">
                    Години переробки
                    <input value={draft?.overtime_hours ?? ''} onChange={e => updateDraft(row.user_id, 'overtime_hours', e.target.value)} inputMode="decimal" className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-base text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-300" />
                  </label>
                  <label className="text-xs text-gray-500">
                    Коефіцієнт переробки
                    <select value={draft?.overtime_coefficient ?? '1.5'} onChange={e => updateDraft(row.user_id, 'overtime_coefficient', e.target.value)} className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-base font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-300">
                      <option value="1">×1,0</option>
                      <option value="1.2">×1,2</option>
                      <option value="1.5">×1,5</option>
                      <option value="2">×2,0</option>
                    </select>
                  </label>
                  <label className="text-xs text-gray-500">
                    Суботні години
                    <input value={draft?.saturday_hours ?? ''} onChange={e => updateDraft(row.user_id, 'saturday_hours', e.target.value)} inputMode="decimal" className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-base text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-300" />
                  </label>
                  <label className="text-xs text-gray-500">
                    Кількість субот
                    <input value={draft?.saturdays_worked ?? ''} onChange={e => updateDraft(row.user_id, 'saturdays_worked', e.target.value)} inputMode="numeric" className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-base text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-300" />
                  </label>
                </div>

                <div className="mt-3 rounded-2xl bg-slate-50 border border-slate-100 px-3 py-2.5 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-400">До оплати в годинах</p>
                    <p className="text-xl font-extrabold text-blue-700">{formatHours(calculatedHours)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400">Продуктивність</p>
                    <p className="text-sm font-bold text-emerald-700">{productivity.toFixed(1)} замовл./год</p>
                  </div>
                </div>

                <button onClick={() => saveHours(row.user_id)} disabled={savingUserId === row.user_id} className="mt-3 w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                  {savingUserId === row.user_id ? 'Збереження…' : savedUserId === row.user_id ? 'Збережено ✓' : 'Зберегти години'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
