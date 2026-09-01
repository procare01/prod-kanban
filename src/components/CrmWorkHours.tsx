import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { CrmDailyWorkHoursRow, CrmEntry, CrmMonthDashboardRow } from '../types'

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
  canEditSelectedDate?: boolean
  collapseOvertimeControls?: boolean
  recentEntries?: CrmEntry[]
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

function monthValue(value: string) { return `${value.slice(0, 7)}-01` }

function addMonths(value: string, amount: number) {
  const [year, month] = value.slice(0, 7).split('-').map(Number)
  return toDateValue(new Date(year, month - 1 + amount, 1))
}

function monthLabel(value: string) {
  const [year, month] = value.split('-').map(Number)
  const label = new Date(year, month - 1, 1).toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function weekdaysInMonth(value: string) {
  const [year, month] = value.split('-').map(Number)
  const daysInMonth = new Date(year, month, 0).getDate()
  let weekdays = 0

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dayOfWeek = new Date(year, month - 1, day).getDay()
    if (dayOfWeek >= 1 && dayOfWeek <= 5) weekdays += 1
  }

  return weekdays
}

function datesInMonth(value: string) {
  const [year, month] = value.split('-').map(Number)
  const daysInMonth = new Date(year, month, 0).getDate()
  return Array.from({ length: daysInMonth }, (_, index) => toDateValue(new Date(year, month - 1, index + 1)))
}

function isWeekendDate(value: string) {
  const day = new Date(`${value}T12:00:00`).getDay()
  return day === 0 || day === 6
}

function kyivDateValue(value: string) {
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

function numberValue(value: string) {
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function formatHours(value: number) {
  return Number(value).toLocaleString('uk-UA', { maximumFractionDigits: 2 })
}

function formatDays(value: number) {
  const count = Number(value) || 0
  const lastTwoDigits = Math.abs(count) % 100
  const lastDigit = Math.abs(count) % 10
  const label = lastTwoDigits >= 11 && lastTwoDigits <= 14
    ? 'днів'
    : lastDigit === 1
      ? 'день'
      : lastDigit >= 2 && lastDigit <= 4
        ? 'дні'
        : 'днів'

  return `${count} ${label}`
}

export function CrmWorkHours({
  userId, userPin, canManage, canViewAll = canManage, readOnly = false, showDashboard = true,
  selectedDate: controlledDate, onSelectedDateChange, targetUserId, compact = false, onSaveOrder, canEditSelectedDate = true,
  collapseOvertimeControls = false, recentEntries = [],
}: Props) {
  const today = toDateValue(new Date())
  const [internalDate] = useState(today)
  const selectedDate = controlledDate ?? internalDate
  const selectedMonth = monthValue(selectedDate)
  const currentMonth = monthValue(today)
  const canGoToNextMonth = selectedMonth < currentMonth
  const isDayEditable = canManage || canEditSelectedDate
  const [monthRows, setMonthRows] = useState<CrmMonthDashboardRow[]>([])
  const [dayRows, setDayRows] = useState<CrmDailyWorkHoursRow[]>([])
  const [drafts, setDrafts] = useState<Record<string, HourDraft>>({})
  const [loading, setLoading] = useState(true)
  const [savingUserId, setSavingUserId] = useState<string | null>(null)
  const [savedUserId, setSavedUserId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [showOvertimeControls, setShowOvertimeControls] = useState(false)

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
  const isDimaKulyk = !canViewAll && monthRows[0]?.user_name === 'Діма Кулик'

  const updateDraft = (userId: string, field: keyof HourDraft, value: string) => {
    if (!isDayEditable) return
    const sanitized = field === 'overtime_coefficient' ? value : value.replace(/[^\d.,]/g, '')
    setDrafts(current => ({ ...current, [userId]: { ...current[userId], [field]: sanitized } }))
  }

  const saveHours = async (targetUserId: string) => {
    if (!isDayEditable) return
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
  const shouldShowOvertimeControls = !collapseOvertimeControls || showOvertimeControls
  const monthWeekdays = weekdaysInMonth(selectedMonth)
  const monthDates = datesInMonth(selectedMonth)
  const renderMonthScale = (row: CrmMonthDashboardRow) => {
    const recentWorkDays = new Set(recentEntries
      .filter(entry => entry.user_name === row.user_name)
      .map(entry => kyivDateValue(entry.work_date ?? entry.created_at))
      .filter(date => date.startsWith(selectedMonth.slice(0, 7))))

    return (
      <div className="crm-hours-month-scale-wrap">
        <ol className="crm-hours-month-scale" aria-label={`Відпрацьовані дні за ${monthLabel(selectedMonth).toLowerCase()}`}>
          {monthDates.map(date => {
            const worked = recentWorkDays.has(date)
            const weekend = isWeekendDate(date)
            const state = worked ? (weekend ? 'weekend' : 'weekday') : (weekend ? 'empty-weekend' : 'empty')
            const day = Number(date.slice(-2))
            const title = worked
              ? `${day} — ${weekend ? 'відпрацьований вихідний' : 'відпрацьований будень'}`
              : `${day} — немає даних`
            return <li key={date} className={`crm-hours-month-scale-day crm-hours-month-scale-day--${state}`} title={title} aria-label={title} />
          })}
        </ol>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {readOnly && onSelectedDateChange && <div className="flex items-center justify-between rounded-2xl border border-white/80 bg-white/75 px-3 py-2 shadow-sm">
        <button
          type="button"
          onClick={() => onSelectedDateChange(addMonths(selectedMonth, -1))}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
          aria-label="Попередній календарний місяць"
          title="Попередній календарний місяць"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <p className="text-sm font-bold text-gray-700">{monthLabel(selectedMonth)}</p>
        <button
          type="button"
          disabled={!canGoToNextMonth}
          onClick={() => onSelectedDateChange(addMonths(selectedMonth, 1))}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-35"
          aria-label="Наступний календарний місяць"
          title="Наступний календарний місяць"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </div>}
      {showDashboard && <div className="crm-hours-dashboard rounded-3xl p-4 shadow-md bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-950 text-white">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-extrabold">Підсумок за {monthLabel(monthValue(selectedDate)).toLowerCase()}</h2>
          </div>
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-blue-100">{canViewAll ? `${monthRows.length} працівн.` : 'Мої дані'}</span>
        </div>
        <div className={`crm-hours-dashboard-metrics ${isDimaKulyk ? 'crm-hours-dashboard-metrics--personal' : ''} grid gap-2 ${isDimaKulyk ? 'grid-cols-1' : 'grid-cols-2'}`}>
          {!isDimaKulyk && <div className="rounded-2xl bg-white/10 p-3"><p className="text-xs text-blue-200">Замовлення</p><p className="text-2xl font-extrabold">{totals.orders}</p></div>}
          {!isDimaKulyk && <div className="rounded-2xl bg-white/10 p-3"><p className="text-xs text-blue-200">Одиниці</p><p className="text-2xl font-extrabold">{totals.units}</p></div>}
          {!isDimaKulyk && <div className="rounded-2xl bg-amber-400/15 p-3"><p className="text-xs text-amber-200">Бонуси</p><p className="text-2xl font-extrabold text-amber-300">{totals.bonus} грн</p></div>}
          <div className="rounded-2xl bg-emerald-400/15 p-3"><p className="text-xs text-emerald-200">Оплачувані години</p><p className="text-2xl font-extrabold text-emerald-300">{formatHours(totals.hours)}</p></div>
        </div>
      </div>}

      {error && <p className="rounded-2xl px-4 py-3 bg-red-50 border border-red-100 text-sm text-red-600">{error}</p>}

      {loading ? (
        <div className="rounded-3xl bg-white/75 border border-white p-8 flex justify-center"><div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : readOnly ? (
        <div className="crm-hours-month-list space-y-3 lg:space-y-0">
          {monthRows.map(row => (
            <article key={row.user_id} className="crm-hours-month-card rounded-3xl border border-white/80 bg-white/80 p-2.5 shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-bold text-gray-800">{row.user_name}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-extrabold text-blue-700">{formatHours(row.weighted_hours)} год</p>
                </div>
              </div>
              <div className="crm-hours-month-scale-desktop">{renderMonthScale(row)}</div>
              <div className="crm-hours-month-summary mt-4 border-t border-slate-100 pt-3 text-xs">
                <section className="crm-hours-month-section crm-hours-month-section--days" aria-labelledby={`days-${row.user_id}`}>
                  <h3 id={`days-${row.user_id}`} className="crm-hours-month-section-title">Дні</h3>
                  <dl className="crm-hours-month-section-metrics">
                    <div className="border-l-2 border-indigo-300 pl-2"><dt className="text-gray-400">Будні: факт / план</dt><dd className="mt-0.5 font-bold text-indigo-700">{Math.max(0, row.days_active - row.saturdays_worked)} / {monthWeekdays} дн.</dd></div>
                    <div className="border-l-2 border-slate-300 pl-2"><dt className="text-gray-400">Всього днів</dt><dd className="mt-0.5 font-bold text-gray-800">{formatDays(row.days_active)}</dd></div>
                    <div className="border-l-2 border-amber-300 pl-2"><dt className="text-gray-400">Робочі суботи</dt><dd className="mt-0.5 font-bold text-amber-700">{formatDays(row.saturdays_worked)}</dd></div>
                  </dl>
                  <div className="crm-hours-month-scale-mobile">{renderMonthScale(row)}</div>
                </section>
                <section className="crm-hours-month-section crm-hours-month-section--hours" aria-labelledby={`hours-${row.user_id}`}>
                  <h3 id={`hours-${row.user_id}`} className="crm-hours-month-section-title">Години</h3>
                  <dl className="crm-hours-month-section-metrics">
                    <div className="border-l-2 border-emerald-300 pl-2"><dt className="text-gray-400">Звичайні</dt><dd className="mt-0.5 font-bold text-emerald-700">{formatHours(row.regular_hours)} год</dd></div>
                    <div className="border-l-2 border-blue-300 pl-2"><dt className="text-gray-400">З переробками</dt><dd className="mt-0.5 font-bold text-blue-700">{formatHours(row.weighted_hours)} год</dd></div>
                  </dl>
                </section>
                <section
                  className={`crm-hours-month-section crm-hours-month-section--results ${Number(row.total_units) === 0 && Number(row.total_orders) === 0 && Number(row.total_bonus) === 0 ? 'crm-hours-month-section--empty-results' : ''}`}
                  aria-labelledby={`results-${row.user_id}`}
                >
                  <h3 id={`results-${row.user_id}`} className="crm-hours-month-section-title">Результат і бонус</h3>
                  <dl className="crm-hours-month-section-metrics">
                    <div className="border-l-2 border-cyan-300 pl-2"><dt className="text-gray-400">Одиниці</dt><dd className="mt-0.5 font-bold text-cyan-700">{row.total_units}</dd></div>
                    <div className="border-l-2 border-violet-300 pl-2"><dt className="text-gray-400">Замовлення</dt><dd className="mt-0.5 font-bold text-violet-700">{row.total_orders}</dd></div>
                    <div className="border-l-2 border-amber-400 pl-2"><dt className="text-gray-400">Бонус</dt><dd className="mt-0.5 font-bold text-amber-700">{row.total_bonus} грн</dd></div>
                  </dl>
                </section>
              </div>
            </article>
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

                <div className={`grid items-end gap-2 ${shouldShowOvertimeControls ? 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)_88px]' : 'grid-cols-1'}`}>
                  <div className="min-w-0">
                    <div className="mb-1">
                      <p className={`text-xs ${selectedIsWeekend ? 'text-amber-700' : 'text-gray-500'}`}>{selectedIsWeekend ? 'Суботні години' : 'Звичайні години'}</p>
                    </div>
                    <div className="relative">
                      {selectedIsWeekend ? (
                        <input value={draft?.saturday_hours ?? ''} disabled={!isDayEditable} onChange={e => updateDraft(row.user_id, 'saturday_hours', e.target.value)} inputMode="decimal" placeholder="0" className={`h-12 w-full rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-base font-semibold text-gray-800 placeholder:text-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-300 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 ${collapseOvertimeControls ? 'pr-12' : ''}`} />
                      ) : (
                        <input value={draft?.regular_hours ?? ''} disabled={!isDayEditable} onChange={e => updateDraft(row.user_id, 'regular_hours', e.target.value)} inputMode="decimal" placeholder="0" className={`h-12 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-base text-gray-800 placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 ${collapseOvertimeControls ? 'pr-12' : ''}`} />
                      )}
                      {collapseOvertimeControls && (
                        <button
                          type="button"
                          onClick={() => setShowOvertimeControls(value => !value)}
                          className={`absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg transition-colors ${showOvertimeControls ? 'bg-blue-700 text-white hover:bg-blue-800' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'}`}
                          aria-label={showOvertimeControls ? 'Сховати години переробки' : 'Показати години переробки'}
                          title={showOvertimeControls ? 'Сховати години переробки' : 'Показати години переробки'}
                        >
                          <svg className={`h-4 w-4 transition-transform ${showOvertimeControls ? 'rotate-45' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                  {shouldShowOvertimeControls && <label className="text-xs text-gray-500">Години переробки
                    <input value={draft?.overtime_hours ?? ''} disabled={!isDayEditable} onChange={e => updateDraft(row.user_id, 'overtime_hours', e.target.value)} inputMode="decimal" placeholder="0" className="mt-1 h-12 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-base text-gray-800 placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500" />
                  </label>}
                  {shouldShowOvertimeControls && <label className="text-[11px] text-gray-500">Коеф.
                    <select value={draft?.overtime_coefficient ?? '2'} disabled={!isDayEditable} onChange={e => updateDraft(row.user_id, 'overtime_coefficient', e.target.value)} className="mt-1 h-12 w-full rounded-xl border border-gray-200 bg-white px-2 py-2.5 text-base font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500">
                      <option value="1">×1,0</option><option value="1.2">×1,2</option><option value="1.5">×1,5</option><option value="2">×2,0</option>
                    </select>
                  </label>}
                </div>

                <div className={`mt-3 rounded-2xl bg-slate-50 border border-slate-100 px-3 py-2.5 flex items-center ${compact ? 'justify-start' : 'justify-between'}`}>
                  <div><p className="text-xs text-gray-400">До оплати за день</p><p className="text-xl font-extrabold text-blue-700">{formatHours(calculatedHours)} год</p></div>
                  {!compact && <div className="text-right"><p className="text-xs text-gray-400">Бонус за місяць</p><p className="text-sm font-bold text-amber-600">{monthRow?.total_bonus ?? 0} грн</p></div>}
                </div>

                {isDayEditable && <button onClick={() => saveHours(row.user_id)} disabled={savingUserId === row.user_id} className="mt-3 w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                  {savingUserId === row.user_id ? 'Збереження…' : savedUserId === row.user_id ? 'Збережено ✓' : onSaveOrder ? 'Зберегти дані за день' : 'Зберегти години за день'}
                </button>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
