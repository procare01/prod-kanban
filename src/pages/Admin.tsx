import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import type { User, TaskStatus, WorkSettings, EventWithWebhook } from '../types'
import { supabase } from '../lib/supabase'
import { isDemoMode } from '../lib/demoData'
import { DEMO_USERS } from '../lib/demoData'

interface Props { user: User }

type Tab = 'users' | 'statuses' | 'lines' | 'settings' | 'events'

// ─── Users tab ────────────────────────────────────────────────

function UsersTab() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [editingPin, setEditingPin] = useState<string | null>(null)
  const [newPin, setNewPin] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ name: '', role: 'brigadir', pin: '' })
  const [msg, setMsg] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    if (isDemoMode) { setUsers(DEMO_USERS); setLoading(false); return }
    const { data } = await supabase.from('users').select('*').order('display_id')
    setUsers((data as User[]) ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 2000) }

  const updatePin = async (id: string) => {
    if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
      flash('PIN має бути 4 цифри'); return
    }
    if (!isDemoMode) {
      const { error } = await supabase.rpc('admin_update_user_pin', { p_id: id, p_pin: newPin })
      if (error) { flash('Помилка: ' + error.message); return }
    }
    setUsers(prev => prev.map(u => u.id === id ? { ...u, pin: newPin } : u))
    setEditingPin(null); setNewPin('')
    flash('PIN оновлено')
  }

  const deleteUser = async (id: string) => {
    if (!window.confirm('Видалити користувача?')) return
    if (!isDemoMode) {
      const { error } = await supabase.rpc('admin_delete_user', { p_id: id })
      if (error) { flash('Помилка: ' + error.message); return }
    }
    setUsers(prev => prev.filter(u => u.id !== id))
  }

  const addUser = async () => {
    if (!addForm.name.trim()) { flash('Введіть ім\'я'); return }
    if (!/^\d{4}$/.test(addForm.pin)) { flash('PIN має бути 4 цифри'); return }
    if (!isDemoMode) {
      const { data, error } = await supabase
        .rpc('admin_create_user', { p_name: addForm.name, p_role: addForm.role, p_pin: addForm.pin })
      if (error) { flash('Помилка: ' + error.message); return }
      setUsers(prev => [...prev, data as User].sort((a, b) => a.display_id - b.display_id))
    } else {
      setUsers(prev => [
        ...prev,
        {
          id: Date.now().toString(),
          display_id: prev.length + 1,
          ...addForm,
          created_at: new Date().toISOString(),
        } as User,
      ])
    }
    setAddForm({ name: '', role: 'brigadir', pin: '' })
    setShowAdd(false)
    flash('Користувача додано')
  }

  const ROLE_LABELS: Record<string, string> = { admin: 'Адмін', brigadir: 'Бригадир', controller: 'Контролер', crm: 'CRM' }
  const ROLE_COLORS: Record<string, string> = {
    admin: 'bg-purple-100 text-purple-700',
    brigadir: 'bg-blue-100 text-blue-700',
    controller: 'bg-green-100 text-green-700',
    crm: 'bg-emerald-100 text-emerald-700',
  }

  return (
    <div className="space-y-3">
      {msg && <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm text-green-700">{msg}</div>}

      <button
        onClick={() => setShowAdd(o => !o)}
        className="w-full py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold
                   hover:bg-blue-700 active:bg-blue-800 transition-colors"
      >
        + Додати користувача
      </button>

      {showAdd && (
        <div className="bg-gray-50 rounded-xl p-4 space-y-3 border border-gray-100">
          <input
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            placeholder="Ім'я"
            value={addForm.name}
            onChange={e => setAddForm(p => ({ ...p, name: e.target.value }))}
          />
          <select
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            value={addForm.role}
            onChange={e => setAddForm(p => ({ ...p, role: e.target.value }))}
          >
            <option value="brigadir">Бригадир</option>
            <option value="controller">Контролер</option>
            <option value="admin">Адміністратор</option>
            <option value="crm">CRM</option>
          </select>
          <input
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono"
            placeholder="PIN (4 цифри)"
            maxLength={4}
            value={addForm.pin}
            onChange={e => setAddForm(p => ({ ...p, pin: e.target.value.replace(/\D/g, '') }))}
          />
          <div className="flex gap-2">
            <button onClick={addUser} className="flex-1 py-2 bg-blue-600 text-white text-sm rounded-lg font-semibold">Додати</button>
            <button onClick={() => setShowAdd(false)} className="flex-1 py-2 border border-gray-200 text-gray-600 text-sm rounded-lg">Скасувати</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-400 text-center py-4">Завантаження...</p>
      ) : (
        <div className="space-y-2">
          {users.map(u => (
            <div key={u.id} className="bg-white rounded-xl border border-gray-100 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 text-sm">#{u.display_id} {u.name}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLORS[u.role]}`}>
                      {ROLE_LABELS[u.role]}
                    </span>
                    <span className="text-xs text-gray-400 font-mono">PIN: {u.pin}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setEditingPin(u.id); setNewPin('') }}
                    className="text-xs text-blue-500 hover:text-blue-700 font-medium"
                  >
                    PIN
                  </button>
                  <button
                    onClick={() => deleteUser(u.id)}
                    className="text-xs text-red-400 hover:text-red-600"
                  >
                    ×
                  </button>
                </div>
              </div>

              {editingPin === u.id && (
                <div className="flex gap-2 mt-2">
                  <input
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-mono"
                    placeholder="Новий PIN"
                    maxLength={4}
                    value={newPin}
                    onChange={e => setNewPin(e.target.value.replace(/\D/g, ''))}
                  />
                  <button onClick={() => updatePin(u.id)} className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg font-semibold">Зберегти</button>
                  <button onClick={() => setEditingPin(null)} className="px-3 py-1.5 border border-gray-200 text-gray-600 text-xs rounded-lg">✕</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Statuses tab ─────────────────────────────────────────────

function StatusesTab() {
  const [statuses, setStatuses] = useState<TaskStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', color: '#6B7280', is_terminal: false })
  const [msg, setMsg] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    if (isDemoMode) {
      setStatuses([
        { id: 's1', name: 'Початок',   color: '#6B7280', order_index: 0, is_terminal: false },
        { id: 's2', name: 'Фасування', color: '#F59E0B', order_index: 1, is_terminal: false },
        { id: 's3', name: 'Зупинка',   color: '#EF4444', order_index: 2, is_terminal: false },
        { id: 's4', name: 'Завершено', color: '#10B981', order_index: 3, is_terminal: true  },
      ])
      setLoading(false); return
    }
    const { data } = await supabase.from('task_statuses').select('*').order('order_index')
    setStatuses((data as TaskStatus[]) ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 2000) }

  const addStatus = async () => {
    if (!form.name.trim()) { flash('Введіть назву'); return }
    const newStatus = { ...form, order_index: statuses.length }
    if (!isDemoMode) {
      const { data, error } = await supabase.rpc('admin_create_status', {
        p_name: newStatus.name,
        p_color: newStatus.color,
        p_order_index: newStatus.order_index,
        p_is_terminal: newStatus.is_terminal,
      })
      if (error) { flash('Помилка: ' + error.message); return }
      setStatuses(prev => [...prev, data as TaskStatus])
    } else {
      setStatuses(prev => [...prev, { id: Date.now().toString(), ...newStatus }])
    }
    setForm({ name: '', color: '#6B7280', is_terminal: false })
    setShowAdd(false); flash('Статус додано')
  }

  const deleteStatus = async (id: string) => {
    if (!window.confirm('Видалити статус?')) return
    if (!isDemoMode) {
      const { error } = await supabase.rpc('admin_delete_status', { p_id: id })
      if (error) { flash('Помилка: ' + error.message); return }
    }
    setStatuses(prev => prev.filter(s => s.id !== id))
  }

  return (
    <div className="space-y-3">
      {msg && <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm text-green-700">{msg}</div>}

      <button
        onClick={() => setShowAdd(o => !o)}
        className="w-full py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors"
      >
        + Додати статус
      </button>

      {showAdd && (
        <div className="bg-gray-50 rounded-xl p-4 space-y-3 border border-gray-100">
          <input
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            placeholder="Назва статусу"
            value={form.name}
            onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
          />
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-600">Колір:</label>
            <input
              type="color"
              value={form.color}
              onChange={e => setForm(p => ({ ...p, color: e.target.value }))}
              className="w-10 h-8 rounded cursor-pointer border border-gray-200"
            />
            <span className="text-sm font-mono text-gray-500">{form.color}</span>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.is_terminal}
              onChange={e => setForm(p => ({ ...p, is_terminal: e.target.checked }))}
              className="w-4 h-4"
            />
            Термінальний (завершальний) статус
          </label>
          <div className="flex gap-2">
            <button onClick={addStatus} className="flex-1 py-2 bg-blue-600 text-white text-sm rounded-lg font-semibold">Додати</button>
            <button onClick={() => setShowAdd(false)} className="flex-1 py-2 border border-gray-200 text-gray-600 text-sm rounded-lg">Скасувати</button>
          </div>
        </div>
      )}

      {loading ? <p className="text-sm text-gray-400 text-center py-4">Завантаження...</p> : (
        <div className="space-y-2">
          {statuses.map(s => (
            <div key={s.id} className="bg-white rounded-xl border border-gray-100 p-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg" style={{ backgroundColor: s.color + '33', border: `2px solid ${s.color}` }} />
                <div>
                  <p className="font-semibold text-sm text-gray-900">{s.name}</p>
                  <p className="text-xs text-gray-400">
                    {s.is_terminal ? 'Термінальний · ' : ''}{s.color}
                  </p>
                </div>
              </div>
              <button onClick={() => deleteStatus(s.id)} className="text-red-300 hover:text-red-500 text-lg">×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Lines tab ────────────────────────────────────────────────

type AdminLine = {
  id: string
  name: string
  is_active: boolean
  subdivision_id?: string
  sub_name: string
}

type AdminSubdivision = {
  id: string
  name: string
}

function LinesTab() {
  const [data, setData] = useState<AdminLine[]>([])
  const [subdivisions, setSubdivisions] = useState<AdminSubdivision[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ subdivision_id: '', name: '' })
  const [msg, setMsg] = useState<string | null>(null)

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 2000) }

  const load = async () => {
    setLoading(true)
    if (isDemoMode) {
      const demoSubdivisions = [
        { id: 'sub1', name: 'Лінія' },
        { id: 'sub2', name: 'Тубна' },
        { id: 'sub3', name: 'Сашетна' },
      ]
      setSubdivisions(demoSubdivisions)
      setData([
        ...['Лінія-1','Лінія-2','Лінія-3','Лінія-4','Лінія-5','Лінія-6'].map((n,i) => ({ id: `l${i}`, subdivision_id: 'sub1', name: n, is_active: true, sub_name: 'Лінія' })),
        ...['Тубна-1','Тубна-2','Тубна-3','Тубна-4'].map((n,i) => ({ id: `t${i}`, subdivision_id: 'sub2', name: n, is_active: true, sub_name: 'Тубна' })),
        ...['Сашетна-1','Сашетна-2','Сашетна-3','Сашетна-4','Сашетна-5'].map((n,i) => ({ id: `s${i}`, subdivision_id: 'sub3', name: n, is_active: true, sub_name: 'Сашетна' })),
      ])
      setAddForm({ subdivision_id: demoSubdivisions[0].id, name: '' })
      setLoading(false)
      return
    }

    const [{ data: rows }, { data: subdivisionRows }] = await Promise.all([
      supabase
        .from('lines')
        .select('id, name, is_active, subdivision_id, subdivisions(name)')
        .order('order_index'),
      supabase
        .from('subdivisions')
        .select('id, name')
        .order('order_index'),
    ])

    const nextSubdivisions = (subdivisionRows as AdminSubdivision[] | null) ?? []
    setSubdivisions(nextSubdivisions)
    setData(((rows ?? []) as any[]).map((r) => ({
      id: r.id,
      name: r.name,
      is_active: r.is_active,
      subdivision_id: r.subdivision_id,
      sub_name: r.subdivisions?.name ?? '',
    })))
    setAddForm((prev) => ({
      subdivision_id: prev.subdivision_id || nextSubdivisions[0]?.id || '',
      name: prev.name,
    }))
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const toggle = async (id: string, current: boolean) => {
    if (!isDemoMode) {
      const { error } = await supabase.rpc('admin_set_line_active', { p_id: id, p_is_active: !current })
      if (error) return
    }
    setData(prev => prev.map(l => l.id === id ? { ...l, is_active: !current } : l))
  }

  const addLine = async () => {
    if (!addForm.subdivision_id) { flash('Оберіть підрозділ'); return }
    if (!addForm.name.trim()) { flash('Введіть назву лінії'); return }

    if (isDemoMode) {
      const selected = subdivisions.find(s => s.id === addForm.subdivision_id)
      const nextLine: AdminLine = {
        id: Date.now().toString(),
        subdivision_id: addForm.subdivision_id,
        name: addForm.name.trim(),
        is_active: true,
        sub_name: selected?.name ?? '',
      }
      setData(prev => [...prev, nextLine])
    } else {
      const { error } = await supabase.rpc('admin_create_line', {
        p_subdivision_id: addForm.subdivision_id,
        p_name: addForm.name,
      })
      if (error) { flash('Помилка: ' + error.message); return }
      await load()
    }

    setAddForm(prev => ({ ...prev, name: '' }))
    setShowAdd(false)
    flash('Лінію додано')
  }

  const grouped = data.reduce((acc, l) => {
    if (!acc[l.sub_name]) acc[l.sub_name] = []
    acc[l.sub_name].push(l)
    return acc
  }, {} as Record<string, typeof data>)

  return (
    <div className="space-y-4">
      {msg && <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm text-green-700">{msg}</div>}

      <button
        onClick={() => setShowAdd(o => !o)}
        className="w-full py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors"
      >
        + Додати лінію
      </button>

      {showAdd && (
        <div className="bg-gray-50 rounded-xl p-4 space-y-3 border border-gray-100">
          <select
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            value={addForm.subdivision_id}
            onChange={e => setAddForm(prev => ({ ...prev, subdivision_id: e.target.value }))}
          >
            {subdivisions.map((sub) => (
              <option key={sub.id} value={sub.id}>{sub.name}</option>
            ))}
          </select>
          <input
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            placeholder="Назва лінії"
            value={addForm.name}
            onChange={e => setAddForm(prev => ({ ...prev, name: e.target.value }))}
          />
          <div className="flex gap-2">
            <button onClick={addLine} className="flex-1 py-2 bg-blue-600 text-white text-sm rounded-lg font-semibold">Додати</button>
            <button onClick={() => setShowAdd(false)} className="flex-1 py-2 border border-gray-200 text-gray-600 text-sm rounded-lg">Скасувати</button>
          </div>
        </div>
      )}

      {loading ? <p className="text-sm text-gray-400 text-center py-4">Завантаження...</p> : (
        Object.entries(grouped).map(([sub, lines]) => (
          <div key={sub}>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{sub}</p>
            <div className="space-y-2">
              {lines.map(l => (
                <div key={l.id} className="bg-white rounded-xl border border-gray-100 p-3 flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-900">{l.name}</span>
                  <button
                    onClick={() => toggle(l.id, l.is_active)}
                    className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                      l.is_active
                        ? 'bg-green-100 text-green-700 hover:bg-green-200'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    {l.is_active ? 'Активна' : 'Вимкнена'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

// ─── Settings tab ──────────────────────────────────────────────

function SettingsTab({ user }: { user: User }) {
  const [settings, setSettings] = useState<WorkSettings>({ work_start: '08:00', work_end: '18:00', webhook_url: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const flash = (text: string, type: 'success' | 'error' = 'success') => {
    setMsg({ text, type })
    setTimeout(() => setMsg(null), 3000)
  }

  useEffect(() => {
    async function load() {
      setLoading(true)
      if (isDemoMode) {
        setSettings({ work_start: '08:00', work_end: '18:00', webhook_url: '' })
        setLoading(false)
        return
      }
      try {
        const { data } = await supabase.rpc('get_settings')
        if (data) {
          setSettings({
            work_start: (data as any).work_start ?? '08:00',
            work_end: (data as any).work_end ?? '18:00',
            webhook_url: (data as any).webhook_url ?? '',
          })
          // Also cache webhook URL in localStorage for useBoard
          localStorage.setItem('prod_kanban_webhook_url', (data as any).webhook_url ?? '')
        }
      } catch {
        // Table might not exist yet (migration not applied)
      }
      setLoading(false)
    }
    load()
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      if (!isDemoMode) {
        await Promise.all([
          supabase.rpc('update_setting', { p_key: 'work_start', p_value: settings.work_start }),
          supabase.rpc('update_setting', { p_key: 'work_end',   p_value: settings.work_end }),
          supabase.rpc('update_setting', { p_key: 'webhook_url', p_value: settings.webhook_url }),
        ])
      }
      // Cache webhook URL
      localStorage.setItem('prod_kanban_webhook_url', settings.webhook_url)
      flash('Налаштування збережено')
    } catch (e: any) {
      flash('Помилка: ' + e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const testWebhook = async () => {
    if (!settings.webhook_url) { flash('Введіть URL вебхука', 'error'); return }
    try {
      await fetch(settings.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'test',
          message: 'Тест вебхука з Production Kanban',
          timestamp: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(5000),
      })
      flash('Тест-запит надіслано')
    } catch (e: any) {
      flash('Помилка надсилання: ' + e.message, 'error')
    }
  }

  const completeAllLines = async () => {
    if (!window.confirm('Завершити всі активні лінії? Це встановить статус "Завершено" для всіх не-завершених ліній.')) return
    setCompleting(true)
    try {
      const { data, error } = await supabase.rpc('complete_all_lines_for_day', { p_user_id: user.id })
      if (error) throw error
      flash(`Завершено ${data ?? 0} ліній`)
    } catch (e: any) {
      flash('Помилка: ' + e.message, 'error')
    } finally {
      setCompleting(false)
    }
  }

  if (loading) return <p className="text-sm text-gray-400 text-center py-8">Завантаження...</p>

  return (
    <div className="space-y-4">
      {msg && (
        <div className={`rounded-xl p-3 text-sm font-medium ${
          msg.type === 'success'
            ? 'bg-green-50 border border-green-200 text-green-700'
            : 'bg-red-50 border border-red-200 text-red-700'
        }`}>{msg.text}</div>
      )}

      {/* Work Schedule */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center">
            <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 text-sm">Робочий день</h3>
            <p className="text-xs text-gray-400">Початок та кінець робочого дня</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Початок роботи</label>
            <input
              type="time"
              value={settings.work_start}
              onChange={e => setSettings(p => ({ ...p, work_start: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Кінець роботи</label>
            <input
              type="time"
              value={settings.work_end}
              onChange={e => setSettings(p => ({ ...p, work_end: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="bg-blue-50 rounded-xl p-3 text-xs text-blue-700">
          <strong>Автоматично:</strong> О 23:59 всі лінії скидаються до початкового статусу.
          В кінці робочого дня можна завершити всі процеси вручну кнопкою нижче.
        </div>

        {/* Manual complete all */}
        <button
          onClick={completeAllLines}
          disabled={completing || isDemoMode}
          className="w-full py-2.5 rounded-xl bg-green-600 text-white text-sm font-semibold
                     hover:bg-green-700 active:bg-green-800 transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {completing ? (
            <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Завершення...</>
          ) : (
            <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg> Завершити всі лінії зараз</>
          )}
        </button>
      </div>

      {/* Webhook */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-purple-50 flex items-center justify-center">
            <svg className="w-4 h-4 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 text-sm">Вебхук</h3>
            <p className="text-xs text-gray-400">URL для надсилання подій при зміні статусу</p>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">URL вебхука</label>
          <input
            type="url"
            value={settings.webhook_url}
            onChange={e => setSettings(p => ({ ...p, webhook_url: e.target.value }))}
            placeholder="https://hook.example.com/..."
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>

        <div className="flex gap-2">
          <button
            onClick={testWebhook}
            disabled={!settings.webhook_url}
            className="flex-1 py-2 rounded-xl border border-purple-200 text-purple-600 text-sm font-semibold
                       hover:bg-purple-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Тест
          </button>
        </div>

        <div className="bg-amber-50 rounded-xl p-3 text-xs text-amber-700">
          При кожній зміні статусу автоматично надсилається POST-запит на цей URL з даними події.
          Якщо надсилання не вдалося, можна повторити у вкладці «Останні події».
        </div>
      </div>

      {/* Save button */}
      <button
        onClick={save}
        disabled={saving}
        className="w-full py-3 rounded-xl bg-blue-600 text-white text-sm font-semibold
                   hover:bg-blue-700 active:bg-blue-800 transition-colors
                   disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {saving ? (
          <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Збереження...</>
        ) : 'Зберегти налаштування'}
      </button>
    </div>
  )
}

// ─── Recent Events tab ─────────────────────────────────────────

function RecentEventsTab() {
  const [events, setEvents] = useState<EventWithWebhook[]>([])
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const flash = (text: string, type: 'success' | 'error' = 'success') => {
    setMsg({ text, type })
    setTimeout(() => setMsg(null), 3000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await supabase.rpc('get_events_admin', { p_limit: 100 })
      setEvents((data as EventWithWebhook[]) ?? [])
    } catch {
      // Fallback to basic events if migration not yet applied
      const { data } = await supabase.rpc('get_events', { p_limit: 100 })
      setEvents(((data as any[]) ?? []).map(e => ({ ...e, webhook_status: null, webhook_error: null, webhook_sent_at: null })))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const sendWebhook = async (event: EventWithWebhook) => {
    const webhookUrl = localStorage.getItem('prod_kanban_webhook_url')
    if (!webhookUrl) {
      flash('Вебхук URL не налаштовано. Перейдіть у Налаштування.', 'error')
      return
    }

    setRetrying(event.id)
    try {
      const payload = {
        event: 'status_changed',
        line_name: event.line_name,
        user_name: event.user_name,
        description: event.description,
        comment: event.comment ?? null,
        timestamp: event.created_at,
      }

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8000),
      })

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      // Mark as sent in DB
      await supabase.rpc('update_event_webhook_status', { p_id: event.id, p_status: 'sent' })
      setEvents(prev => prev.map(e => e.id === event.id ? { ...e, webhook_status: 'sent', webhook_error: null } : e))
      flash('Вебхук надіслано успішно')
    } catch (err: any) {
      const errMsg = err.message ?? 'Помилка'
      await supabase.rpc('update_event_webhook_status', { p_id: event.id, p_status: 'failed', p_error: errMsg })
      setEvents(prev => prev.map(e => e.id === event.id ? { ...e, webhook_status: 'failed', webhook_error: errMsg } : e))
      flash('Помилка: ' + errMsg, 'error')
    } finally {
      setRetrying(null)
    }
  }

  const retryAllFailed = async () => {
    const failed = events.filter(e => e.webhook_status === 'failed' || e.webhook_status === null)
    for (const ev of failed) {
      await sendWebhook(ev)
    }
  }

  function formatTime(dateStr: string) {
    const d = new Date(dateStr)
    return d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
  }

  function formatDate(dateStr: string) {
    const d = new Date(dateStr)
    const today = new Date()
    if (d.toDateString() === today.toDateString()) return 'Сьогодні'
    return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })
  }

  const failedCount = events.filter(e => e.webhook_status === 'failed').length
  const pendingCount = events.filter(e => e.webhook_status === null).length

  return (
    <div className="space-y-3">
      {msg && (
        <div className={`rounded-xl p-3 text-sm font-medium ${
          msg.type === 'success'
            ? 'bg-green-50 border border-green-200 text-green-700'
            : 'bg-red-50 border border-red-200 text-red-700'
        }`}>{msg.text}</div>
      )}

      {/* Header actions */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {failedCount > 0 && (
            <span className="text-xs bg-red-100 text-red-700 font-semibold px-2 py-1 rounded-lg">
              {failedCount} помилок
            </span>
          )}
          {pendingCount > 0 && (
            <span className="text-xs bg-gray-100 text-gray-600 font-medium px-2 py-1 rounded-lg">
              {pendingCount} без вебхука
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50"
          >
            Оновити
          </button>
          {failedCount > 0 && (
            <button
              onClick={retryAllFailed}
              className="text-xs px-3 py-1.5 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700"
            >
              Повторити всі ({failedCount})
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 text-center py-8">Завантаження...</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">Подій немає</p>
      ) : (
        <div className="space-y-2">
          {events.map(ev => {
            const isRetrying = retrying === ev.id
            const isSent = ev.webhook_status === 'sent'
            const isFailed = ev.webhook_status === 'failed'

            return (
              <div key={ev.id} className="bg-white rounded-xl border border-gray-100 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    {/* Event description */}
                    <p className="text-sm text-gray-800 leading-snug">{ev.description}</p>
                    {ev.comment && (
                      <p className="text-xs text-gray-400 mt-0.5 italic">"{ev.comment}"</p>
                    )}
                    {/* Meta */}
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className="text-xs text-gray-400">{formatDate(ev.created_at)} {formatTime(ev.created_at)}</span>
                      {ev.line_name && (
                        <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{ev.line_name}</span>
                      )}
                      {/* Webhook status badge */}
                      {isSent && (
                        <span className="text-xs bg-green-100 text-green-700 font-medium px-1.5 py-0.5 rounded-full flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> Надіслано
                        </span>
                      )}
                      {isFailed && (
                        <span className="text-xs bg-red-100 text-red-700 font-medium px-1.5 py-0.5 rounded-full flex items-center gap-1" title={ev.webhook_error ?? ''}>
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> Помилка
                        </span>
                      )}
                      {!ev.webhook_status && (
                        <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-gray-400" /> Не надіслано
                        </span>
                      )}
                    </div>
                    {isFailed && ev.webhook_error && (
                      <p className="text-xs text-red-400 mt-1 truncate">{ev.webhook_error}</p>
                    )}
                  </div>

                  {/* Retry / Send button */}
                  <button
                    onClick={() => sendWebhook(ev)}
                    disabled={isRetrying}
                    className={`shrink-0 text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors
                      flex items-center gap-1 ${
                      isRetrying
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        : isSent
                        ? 'border border-gray-200 text-gray-500 hover:bg-gray-50'
                        : isFailed
                        ? 'bg-red-600 text-white hover:bg-red-700'
                        : 'bg-purple-600 text-white hover:bg-purple-700'
                    }`}
                  >
                    {isRetrying ? (
                      <span className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    )}
                    {isRetrying ? '' : isSent ? 'Ще раз' : isFailed ? 'Повторити' : 'Надіслати'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Admin page ───────────────────────────────────────────────

export function Admin({ user }: Props) {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('users')

  if (user.role !== 'admin') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Доступ заборонено</p>
      </div>
    )
  }

  const TABS: { key: Tab; label: string; short: string }[] = [
    { key: 'users',    label: 'Користувачі', short: 'Юзери'   },
    { key: 'statuses', label: 'Статуси',      short: 'Статуси' },
    { key: 'lines',    label: 'Лінії',        short: 'Лінії'   },
    { key: 'settings', label: 'Налаштування', short: 'Налашт.' },
    { key: 'events',   label: 'Останні події',short: 'Події'   },
  ]

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-screen-md mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="w-9 h-9 rounded-xl border border-gray-200 flex items-center justify-center
                       hover:bg-gray-50 active:bg-gray-100 transition-colors flex-shrink-0"
          >
            ‹
          </button>
          <h1 className="font-bold text-gray-900">Адмін-панель</h1>
        </div>

        {/* Tabs */}
        <div className="max-w-screen-md mx-auto px-4 pb-0">
          <div className="flex border-b border-gray-100">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex-1 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                  tab === t.key
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <span className="hidden sm:inline">{t.label}</span>
                <span className="sm:hidden">{t.short}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-screen-md mx-auto px-4 py-4">
        {tab === 'users'    && <UsersTab />}
        {tab === 'statuses' && <StatusesTab />}
        {tab === 'lines'    && <LinesTab />}
        {tab === 'settings' && <SettingsTab user={user} />}
        {tab === 'events'   && <RecentEventsTab />}
      </div>
    </div>
  )
}
