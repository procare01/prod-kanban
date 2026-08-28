import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { CrmDailyWorkHoursRow, CrmMonthDashboardRow } from '../types'

interface Props {
  userId: string
  userPin: string
  canManage: boolean
  canViewAll?: boolean
  readOnly?: boolean
  showDashboard?: boolean
  selectedDate?: string
  onSelectedDateChange?: (date: string) => void
  targetUserId?: string
  compact?: boolean
  onSaveOrder?: () => Promise<boolean>
}

type HourDraft = {
  regular_hours: string
  overtime_hours: string
  overtime_coefficient: string
  saturday_hours: string
}

const CRM_WORKER_SURNAME_ORDER = ['яблонський', 'кулик', 'самардак', 'поліщук', 'сіренко', 'машталер']

function sortCrmWorkerRows<T extends { user_name: string }>(rows: T[]) {
  const position = (name: string) => {
    const normalizedName = name.toLocaleLowerCase('uk-UA')
    const index = CRM_WORKER_SURNAME_ORDER.findIndex(surname => normalizedName.includes(surname))
    return index === -1 ? CRM_WORKER_SURNAME_ORDER.length : index
  }

  return [...rows].sort((a, b) => {
    const difference = position(a.user_name) - position(b.user_name)
    return difference || a.user_name.localeCompare(b.user_name, 'uk-UA')
  })
}

function toDateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function shiftDay(value: string, direction: -1 | 1) {
  const [year, month, day] = value.split('-').map(Number)
  return toDateValue(new Date(year, month - 1, day + direction))
}

function monthValue(value: string) { return `${value.slice(0, 7)}-01` }

function dateLabel(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('uk-UA', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

function monthLabel(value: string) {
  const [year, month] = value.split('-').map(Number)
  const label = new Date(year, month - 1, 1).toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function numberValue(value: string) {
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function formatHours(value: number) {
  return Number(value).toLocaleString('uk-UA', { maximumFractionDigits: 2 })
}

export function CrmWorkHours({
  userId, userPin, canManage, canViewAll = canManage, readOnly = false, showDashboard = true,
  selectedDate: controlledDate, onSelectedDateChange, targetUserId, compact = false, onSaveOrder,
}: Props) {
  const today = toDateValue(new Date())
  const [internalDate, setInternalDate] = useState(today)
  const selectedDate = controlledDate ?? internalDate
  const setSelectedDate = onSelectedDateChange ?? setInternalDate
  const [monthRows, setMonthRows] = useState<CrmMonthDashboardRow[]>([])
  const [dayRows, setDayRows] = useState<CrmDailyWorkHoursRow[]>([])
  const [drafts, setDrafts] = useState<Record<string, HourDraft>>({})
  const [loading, setLoading] = useState(true)
  const [savingUserId, setSavingUserId] = useState<string | null>(null)
  const [savedUserId, setSavedUserId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [monthResult, dayResult] = await Promise.all(canViewAll
        ? [
            supabase.rpc('get_crm_month_dashboard', { p_admin_id: userId, p_admin_pin: userPin, p_month: monthValue(selectedDate) }),
            supabase.rpc('get_crm_work_hours_day', { p_admin_id: userId, p_admin_pin: userPin, p_date: selectedDate }),
          ]
        : [
            supabase.rpc('get_my_crm_month_dashboard', { p_user_id: userId, p_user_pin: userPin, p_month: monthValue(selectedDate) }),
            supabase.rpc('get_my_crm_work_hours_day', { p_user_id: userId, p_user_pin: userPin, p_date: selectedDate }),
          ])
      if (monthResult.error) throw monthResult.error
      if (dayResult.error) throw dayResult.error
      const nextMonthRows = (monthResult.data ?? []) as CrmMonthDashboardRow[]
      const nextDayRows = (dayResult.data ?? []) as CrmDailyWorkHoursRow[]
      setMonthRows(sortCrmWorkerRows(nextMonthRows))
      setDayRows(sortCrmWorkerRows(nextDayRows))
      const isWeekend = [0, 6].includes(new Date(`${selectedDate}T12:00:00`).getDay())
      setDrafts(Object.fromEntries(nextDayRows.map(row => {
        return [row.user_id, {
          regular_hours: isWeekend ? '' : Number(row.regular_hours) > 0 ? String(row.regular_hours) : '8',
          overtime_hours: Number(row.overtime_hours) > 0 ? String(row.overtime_hours) : '',
          overtime_coefficient: Number(row.overtime_hours) > 0 ? String(row.overtime_coefficient ?? 2) : '2',
          saturday_hours: Number(row.saturday_hours) > 0 ? String(row.saturday_hours) : '',
        }]
      })))
    } catch {
      setMonthRows([])
      setDayRows([])
      setError('Не вдалося завантажити щоденний облік. Застосуйте міграцію 025 у Supabase.')
    } finally {
      setLoading(false)
    }
  }, [userId, userPin, canViewAll, selectedDate])

  useEffect(() => { load() }, [load])

  const totals = useMemo(() => monthRows.reduce((acc, row) => ({
    orders: acc.orders + Number(row.total_orders || 0),
    units: acc.units + Number(row.total_units || 0),
    bonus: acc.bonus + Number(row.total_bonus || 0),
    hours: acc.hours + Number(row.weighted_hours || 0),
  }), { orders: 0, units: 0, bonus: 0, hours: 0 }), [monthRows])

  const updateDraft = (userId: string, field: keyof HourDraft, value: string) => {
    const sanitized = field === 'overtime_coefficient' ? value : value.replace(/[^\d.,]/g, '')
    setDrafts(current => ({ ...current, [userId]: { ...current[userId], [field]: sanitized } }))
  }

  const saveHours = async (targetUserId: string) => {
    const draft = drafts[targetUserId]
    if (!draft) return
    setSavingUserId(targetUserId)
    setSavedUserId(null)
    setError('')
    try {
      if (onSaveOrder && !(await onSaveOrder())) return
      const { error: rpcError } = canManage
        ? await supabase.rpc('set_crm_work_hours', {
            p_admin_id: userId, p_admin_pin: userPin, p_user_id: targetUserId,
            p_date: selectedDate, p_regular_hours: numberValue(draft.regular_hours),
            p_overtime_hours: numberValue(draft.overtime_hours), p_overtime_coefficient: numberValue(draft.overtime_coefficient),
            p_saturday_hours: numberValue(draft.saturday_hours),
          })
        : await supabase.rpc('set_my_crm_work_hours', {
            p_user_id: userId, p_user_pin: userPin, p_date: selectedDate,
            p_regular_hours: numberValue(draft.regular_hours), p_overtime_hours: numberValue(draft.overtime_hours),
            p_overtime_coefficient: numberValue(draft.overtime_coefficient), p_saturday_hours: numberValue(draft.saturday_hours),
          })
      if (rpcError) throw rpcError
      setSavedUserId(targetUserId)
      await load()
      window.setTimeout(() => setSavedUserId(null), 2000)
    } catch {
      setError('Не вдалося зберегти години. Перевірте дані та повторіть спробу.')
    } finally {
      setSavingUserId(null)
    }
  }

  const selectedIsWeekend = [0, 6].includes(new Date(`${selectedDate}T12:00:00`).getDay())
  const visibleDayRows = targetUserId ? dayRows.filter(row => row.user_id === targetUserId) : dayRows

  return (
    <div className="space-y-3">
      {!compact && <div className="rounded-3xl px-3 py-3 shadow-md backdrop-blur-sm border border-white/80 bg-white/75 flex items-center gap-2">
        <button onClick={() => setSelectedDate(shiftDay(selectedDate, -1))} className="w-10 h-10 shrink-0 rounded-xl border border-gray-200 bg-white text-gray-500 hover:text-blue-600" aria-label="Попередній день">‹</button>
        <div className="min-w-0 flex-1 text-center">
          <p className="text-xs uppercase tracking-wide text-gray-400">Облік за день</p>
          <p className="truncate text-sm font-bold text-gray-800 capitalize">{dateLabel(selectedDate)}</p>
        </div>
        <input type="date" value={selectedDate} max={today} onChange={e => setSelectedDate(e.target.value)} className="h-10 w-32 shrink-0 rounded-xl border border-gray-200 bg-white px-2 text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-300" />
        <button onClick={() => setSelectedDate(shiftDay(selectedDate, 1))} disabled={selectedDate === today} className="w-10 h-10 shrink-0 rounded-xl border border-gray-200 bg-white text-gray-500 hover:text-blue-600 disabled:opacity-30" aria-label="Наступний день">›</button>
      </div>}

      {showDashboard && <div className="rounded-3xl p-4 shadow-md bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-950 text-white">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <p className="text-xs text-blue-200 uppercase tracking-wide">{canViewAll ? 'Загальний дашборд' : 'Мій результат'}</p>
            <h2 className="text-lg font-extrabold">Підсумок за {monthLabel(monthValue(selectedDate)).toLowerCase()}</h2>
          </div>
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-blue-100">{canViewAll ? `${monthRows.length} працівн.` : 'Мої дані'}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl bg-white/10 p-3"><p className="text-xs text-blue-200">Замовлення</p><p className="text-2xl font-extrabold">{totals.orders}</p></div>
          <div className="rounded-2xl bg-white/10 p-3"><p className="text-xs text-blue-200">Одиниці</p><p className="text-2xl font-extrabold">{totals.units}</p></div>
          <div className="rounded-2xl bg-amber-400/15 p-3"><p className="text-xs text-amber-200">Бонуси</p><p className="text-2xl font-extrabold text-amber-300">{totals.bonus} грн</p></div>
          <div className="rounded-2xl bg-emerald-400/15 p-3"><p className="text-xs text-emerald-200">Оплачувані години</p><p className="text-2xl font-extrabold text-emerald-300">{formatHours(totals.hours)}</p></div>
        </div>
      </div>}

      {error && <p className="rounded-2xl px-4 py-3 bg-red-50 border border-red-100 text-sm text-red-600">{error}</p>}

      {loading ? (
        <div className="rounded-3xl bg-white/75 border border-white p-8 flex justify-center"><div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : readOnly ? (
        <div className="space-y-3">
          {monthRows.map(row => (
            <div key={row.user_id} className="rounded-3xl border border-white/80 bg-white/80 p-4 shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-bold text-gray-800">{row.user_name}</p>
                  <p className="mt-1 text-xs text-gray-400">{row.total_orders} замовл. · {row.total_units} од. · {row.days_active} роб. днів</p>
                </div>
                <p className="text-lg font-extrabold text-blue-700">{formatHours(row.weighted_hours)} год</p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-xl bg-amber-50 px-3 py-2 text-amber-700">Бонус: <span className="font-bold">{row.total_bonus} грн</span></div>
                <div className="rounded-xl bg-emerald-50 px-3 py-2 text-emerald-700">Звичайні: <span className="font-bold">{formatHours(row.regular_hours)} год</span></div>
              </div>
            </div>
          ))}
        </div>
      ) : visibleDayRows.length === 0 ? (
        <div className="rounded-3xl bg-white/75 border border-white p-8 text-center text-sm text-gray-400">Немає працівників CRM</div>
      ) : (
        <div className="space-y-3">
          {visibleDayRows.map(row => {
            const draft = drafts[row.user_id]
            const overtimeRate = numberValue(draft?.overtime_coefficient ?? '2')
            const saturdayRate = row.saturday_coefficient || 1
            const calculatedHours = numberValue(draft?.regular_hours ?? '0')
              + numberValue(draft?.overtime_hours ?? '0') * overtimeRate
              + numberValue(draft?.saturday_hours ?? '0') * saturdayRate
            const monthRow = monthRows.find(monthItem => monthItem.user_id === row.user_id)

            return (
              <div key={row.user_id} className="rounded-3xl p-4 shadow-md backdrop-blur-sm border border-white/80 bg-white/80">
                {!compact && <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <p className="font-bold text-gray-800">{row.user_name}</p>
                    <p className="text-xs text-gray-400">За місяць: {monthRow?.total_orders ?? 0} замовл. · {formatHours(monthRow?.weighted_hours ?? 0)} год</p>
                  </div>
                  {selectedIsWeekend && <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700">Вихідний {row.saturday_number || 1} · ×{String(saturdayRate).replace('.', ',')}</span>}
                </div>}

                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_88px] items-end gap-2">
                  {selectedIsWeekend ? (
                    <label className="text-xs text-amber-700">Суботні години
                      <input value={draft?.saturday_hours ?? ''} onChange={e => updateDraft(row.user_id, 'saturday_hours', e.target.value)} inputMode="decimal" placeholder="0" className="mt-1 h-12 w-full rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-base font-semibold text-gray-800 placeholder:text-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-300" />
                    </label>
                  ) : (
                    <label className="text-xs text-gray-500">Звичайні години
                      <input value={draft?.regular_hours ?? ''} onChange={e => updateDraft(row.user_id, 'regular_hours', e.target.value)} inputMode="decimal" placeholder="0" className="mt-1 h-12 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-base text-gray-800 placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-300" />
                    </label>
                  )}
                  <label className="text-xs text-gray-500">Години переробки
                    <input value={draft?.overtime_hours ?? ''} onChange={e => updateDraft(row.user_id, 'overtime_hours', e.target.value)} inputMode="decimal" placeholder="0" className="mt-1 h-12 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-base text-gray-800 placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-300" />
                  </label>
                  <label className="text-[11px] text-gray-500">Коеф.
                    <select value={draft?.overtime_coefficient ?? '2'} onChange={e => updateDraft(row.user_id, 'overtime_coefficient', e.target.value)} className="mt-1 h-12 w-full rounded-xl border border-gray-200 bg-white px-2 py-2.5 text-base font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-300">
                      <option value="1">×1,0</option><option value="1.2">×1,2</option><option value="1.5">×1,5</option><option value="2">×2,0</option>
                    </select>
                  </label>
                </div>

                <div className={`mt-3 rounded-2xl bg-slate-50 border border-slate-100 px-3 py-2.5 flex items-center ${compact ? 'justify-start' : 'justify-between'}`}>
                  <div><p className="text-xs text-gray-400">До оплати за день</p><p className="text-xl font-extrabold text-blue-700">{formatHours(calculatedHours)} год</p></div>
                  {!compact && <div className="text-right"><p className="text-xs text-gray-400">Бонус за місяць</p><p className="text-sm font-bold text-amber-600">{monthRow?.total_bonus ?? 0} грн</p></div>}
                </div>

                <button onClick={() => saveHours(row.user_id)} disabled={savingUserId === row.user_id} className="mt-3 w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                  {savingUserId === row.user_id ? 'Збереження…' : savedUserId === row.user_id ? 'Збережено ✓' : onSaveOrder ? 'Зберегти дані за день' : 'Зберегти години за день'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
