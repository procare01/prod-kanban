import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import type { User, TaskStatus } from '../types'
import { supabase } from '../lib/supabase'
import { isDemoMode } from '../lib/demoData'
import { DEMO_USERS } from '../lib/demoData'

interface Props { user: User }

type Tab = 'users' | 'statuses' | 'lines'

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

  const ROLE_LABELS: Record<string, string> = { admin: 'Адмін', brigadir: 'Бригадир', controller: 'Контролер' }
  const ROLE_COLORS: Record<string, string> = {
    admin: 'bg-purple-100 text-purple-700',
    brigadir: 'bg-blue-100 text-blue-700',
    controller: 'bg-green-100 text-green-700',
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

  useEffect(() => {
    load()
  }, [])

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

  const TABS: { key: Tab; label: string }[] = [
    { key: 'users',    label: 'Користувачі' },
    { key: 'statuses', label: 'Статуси'      },
    { key: 'lines',    label: 'Лінії'        },
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
                className={`flex-1 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  tab === t.key
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.label}
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
      </div>
    </div>
  )
}
