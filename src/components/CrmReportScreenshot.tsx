import { useEffect, useMemo, useRef, useState } from 'react'
import type { CrmTodayData } from '../types'

interface Props {
  date: string
  data: CrmTodayData | null
  loading: boolean
  onDateChange: (date: string) => void
}

type ReportRow = { user_name: string; orders: number; units: number }

const WORKER_SURNAME_ORDER = ['яблонський', 'кулик', 'самардак', 'поліщук', 'сіренко', 'машталер']

function formatDate(date: string) {
  const [year, month, day] = date.split('-')
  return `${day}.${month}.${year.slice(2)}`
}

function reportName(name: string) {
  const words = name.trim().split(/\s+/)
  if (words.length < 2) return [name]
  return [words[words.length - 1] ?? name, words.slice(0, -1).join(' ')]
}

function sortRows(rows: ReportRow[]) {
  const position = (name: string) => {
    const normalized = name.toLocaleLowerCase('uk-UA')
    const index = WORKER_SURNAME_ORDER.findIndex(surname => normalized.includes(surname))
    return index === -1 ? WORKER_SURNAME_ORDER.length : index
  }

  return [...rows].sort((left, right) => position(left.user_name) - position(right.user_name) || left.user_name.localeCompare(right.user_name, 'uk-UA'))
}

export function CrmReportScreenshot({ date, data, loading, onDateChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')

  const rows = useMemo(() => {
    const byUser = new Map<string, ReportRow>()
    data?.entries.forEach(entry => {
      const hiddenFromSeptember = date >= '2026-09-01' && entry.user_name.toLocaleLowerCase('uk-UA').includes('шепет')
      if (hiddenFromSeptember) return
      const current = byUser.get(entry.user_id) ?? { user_name: entry.user_name, orders: 0, units: 0 }
      current.orders += Number(entry.orders_count) || 0
      current.units += Number(entry.units_count) || 0
      byUser.set(entry.user_id, current)
    })
    return sortRows([...byUser.values()].filter(row => row.orders > 0 || row.units > 0))
  }, [data, date])

  const totalOrders = rows.reduce((sum, row) => sum + row.orders, 0)
  const totalUnits = rows.reduce((sum, row) => sum + row.units, 0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const imageScale = 0.65
    const W = 1440
    const H = 1130
    const left = 31
    const right = W - 31
    const top = 35
    const col1 = 485
    const col2 = 894
    const titleBottom = 160
    const headerBottom = 244
    const rowsAreaBottom = 756
    const summaryBottom = 1098
    const displayedRows = Math.max(rows.length, 4)
    const rowHeight = (rowsAreaBottom - headerBottom) / displayedRows
    const rowsBottom = rowsAreaBottom
    const summaryHeight = summaryBottom - rowsBottom
    const firstSummaryHeight = 170
    const summaryDivider = rowsBottom + firstSummaryHeight
    const activePeople = rows.length
    const hours = activePeople * 8
    const ordersPerHour = hours ? Math.round(totalOrders / hours) : 0
    const unitsPerHour = hours ? Math.round(totalUnits / hours) : 0

    ctx.setTransform(imageScale, 0, 0, imageScale, 0, 0)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, W, H)
    ctx.strokeStyle = '#111111'
    ctx.lineWidth = 3
    ctx.strokeRect(left, top, right - left, summaryBottom - top)

    ctx.fillStyle = '#99b59b'
    ctx.fillRect(left, top, right - left, titleBottom - top)
    ctx.fillStyle = '#b1c7b3'
    ctx.fillRect(left, titleBottom, right - left, headerBottom - titleBottom)

    Array.from({ length: displayedRows }, (_, index) => {
      ctx.fillStyle = index % 2 === 0 ? '#fff2cd' : '#ffecb7'
      ctx.fillRect(left, headerBottom + rowHeight * index, right - left, rowHeight)
    })

    ctx.fillStyle = '#ffcfcf'
    ctx.fillRect(left, rowsBottom, col1 - left, summaryHeight)
    ctx.fillStyle = '#ffe2e2'
    ctx.fillRect(col1, rowsBottom, right - col1, summaryHeight)

    const summaryCaptionHeight = 48
    ctx.fillStyle = '#ffcfcf'
    ctx.fillRect(col1, summaryDivider - summaryCaptionHeight, right - col1, summaryCaptionHeight)
    ctx.fillRect(col1, summaryBottom - summaryCaptionHeight, right - col1, summaryCaptionHeight)

    const line = (x1: number, y1: number, x2: number, y2: number, dashed = false) => {
      ctx.save()
      ctx.setLineDash(dashed ? [10, 8] : [])
      ctx.strokeStyle = dashed ? '#fffdf2' : '#111111'
      ctx.lineWidth = dashed ? 2 : 3
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      ctx.restore()
    }

    line(col1, titleBottom, col1, summaryBottom)
    line(col2, top, col2, summaryBottom)
    line(left, titleBottom, right, titleBottom, true)
    line(left, headerBottom, right, headerBottom)
    Array.from({ length: displayedRows }, (_, index) => line(left, headerBottom + rowHeight * (index + 1), right, headerBottom + rowHeight * (index + 1), true))
    line(left, rowsBottom, right, rowsBottom)
    line(col1, summaryDivider, right, summaryDivider, true)

    const text = (value: string, x: number, y: number, size: number, options: { align?: CanvasTextAlign; italic?: boolean; weight?: number; color?: string; family?: string; opticalCenter?: boolean } = {}) => {
      ctx.fillStyle = options.color ?? '#111111'
      ctx.textAlign = options.align ?? 'center'
      ctx.textBaseline = 'middle'
      ctx.font = `${options.italic ? 'italic ' : ''}${options.weight ?? 700} ${size}px ${options.family ?? 'Arial, sans-serif'}`
      let drawX = x
      if (options.opticalCenter && ctx.textAlign === 'center') {
        const metrics = ctx.measureText(value)
        drawX -= (metrics.actualBoundingBoxRight - metrics.actualBoundingBoxLeft) / 2
      }
      ctx.fillText(value, drawX, y)
    }

    text('Роздрібні замовлення', left + 28, 94, 70, { align: 'left', color: '#4e006d', weight: 500 })
    text(formatDate(date), col2 + 28, 94, 94, { align: 'left', italic: true, color: '#4e006d', weight: 900, family: 'Arial Black, Arial, sans-serif' })
    text('П.І.Б.', (left + col1) / 2, 198, 52, { color: '#4e006d', italic: true, weight: 700 })
    text('К-СТЬ', (col1 + col2) / 2, 182, 36, { color: '#4e006d', italic: true })
    text('замовлень', (col1 + col2) / 2, 218, 34, { color: '#4e006d', italic: true })
    text('К-СТЬ', (col2 + right) / 2, 182, 36, { color: '#4e006d', italic: true })
    text('одиниць товару', (col2 + right) / 2, 218, 34, { color: '#4e006d', italic: true })

    if (rows.length === 0) {
      text('Немає даних за обрану дату', W / 2, headerBottom + rowHeight / 2, 38, { color: '#475569', weight: 500 })
    }

    rows.forEach((row, index) => {
      const y = headerBottom + rowHeight * index + rowHeight / 2
      const [surname, firstName] = reportName(row.user_name)
      text(surname, (left + col1) / 2, y - 20, 38, { weight: 500 })
      if (firstName) text(firstName, (left + col1) / 2, y + 26, 36, { weight: 500 })
      text(String(row.orders), (col1 + col2) / 2, y, 100, { weight: 900, family: 'Arial Black, Arial, sans-serif' })
      text(String(row.units), (col2 + right) / 2, y, 100, { weight: 900, family: 'Arial Black, Arial, sans-serif' })
    })

    const summaryTop = rowsBottom
    const summaryNumberVerticalOffset = -5
    text('Загальна сума :', (left + col1) / 2, summaryTop + firstSummaryHeight / 2, 42, { italic: true, weight: 500, color: '#53616b' })
    text(String(totalOrders), (col1 + col2) / 2, summaryTop + 86 + summaryNumberVerticalOffset, 124, { italic: true, weight: 900, color: '#707579', family: 'Arial Black, Arial, sans-serif', opticalCenter: true })
    text(String(totalUnits), (col2 + right) / 2, summaryTop + 86 + summaryNumberVerticalOffset, 124, { italic: true, weight: 900, color: '#707579', family: 'Arial Black, Arial, sans-serif', opticalCenter: true })
    text('загальна кількість замовлень', (col1 + col2) / 2, summaryDivider - 20, 24, { italic: true, weight: 500, color: '#4f5559' })
    text('загальна кількість одиниць товару', (col2 + right) / 2, summaryDivider - 20, 24, { italic: true, weight: 500, color: '#4f5559' })

    const kpiCenter = summaryDivider + (summaryBottom - summaryDivider) / 2
    text('ККД на 1 люд. :', (left + col1) / 2, kpiCenter, 42, { italic: true, weight: 500, color: '#53616b' })
    text(String(ordersPerHour), (col1 + col2) / 2, summaryDivider + 84 + summaryNumberVerticalOffset, 114, { italic: true, weight: 900, color: '#707579', family: 'Arial Black, Arial, sans-serif', opticalCenter: true })
    text(String(unitsPerHour), (col2 + right) / 2, summaryDivider + 84 + summaryNumberVerticalOffset, 114, { italic: true, weight: 900, color: '#707579', family: 'Arial Black, Arial, sans-serif', opticalCenter: true })
    text('замовлень за год', (col1 + col2) / 2, summaryBottom - 20, 24, { italic: true, weight: 500, color: '#4f5559' })
    text('одиниць товару за год', (col2 + right) / 2, summaryBottom - 20, 24, { italic: true, weight: 500, color: '#4f5559' })
  }, [date, rows, totalOrders, totalUnits])

  const copyImage = async () => {
    const canvas = canvasRef.current
    if (!canvas) return
    try {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
      if (!blob || !navigator.clipboard?.write || !window.ClipboardItem) throw new Error('Clipboard is unavailable')
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      setCopyState('copied')
    } catch {
      setCopyState('error')
    }
  }

  return (
    <section className="rounded-3xl border border-white/80 bg-white/75 p-3 shadow-md backdrop-blur-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
        <div>
          <h2 className="text-base font-bold text-gray-800">Скрін звіту</h2>
          <p className="text-xs text-gray-400">PNG для вставлення в Telegram</p>
        </div>
        <input
          type="date"
          value={date}
          max={new Date().toISOString().slice(0, 10)}
          onChange={event => event.target.value && onDateChange(event.target.value)}
          className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-300"
          aria-label="Дата звіту"
        />
      </div>

      <div className="flex justify-center overflow-hidden rounded-xl border border-slate-300 bg-white">
        <canvas ref={canvasRef} width={936} height={735} className="block h-auto w-full sm:w-[65%]" aria-label="Зображення денного CRM-звіту" />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className={`text-xs ${copyState === 'error' ? 'text-red-500' : 'text-gray-400'}`}>
          {loading ? 'Оновлюємо дані…' : copyState === 'copied' ? 'Зображення скопійовано' : copyState === 'error' ? 'Не вдалося скопіювати зображення' : 'Скопіюйте та вставте зображення в Telegram'}
        </p>
        <button
          type="button"
          disabled={loading}
          onClick={copyImage}
          className="shrink-0 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {copyState === 'copied' ? 'Скопійовано ✓' : 'Скопіювати'}
        </button>
      </div>
    </section>
  )
}
