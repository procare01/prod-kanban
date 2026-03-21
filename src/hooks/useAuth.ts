import { useState, useEffect, useCallback } from 'react'
import type { User } from '../types'
import { supabase } from '../lib/supabase'
import { DEMO_USERS, isDemoMode } from '../lib/demoData'

const STORAGE_KEY = 'prod_kanban_user_id'

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Auto-login on mount
  useEffect(() => {
    const storedId = localStorage.getItem(STORAGE_KEY)
    if (!storedId) { setLoading(false); return }

    if (isDemoMode) {
      const found = DEMO_USERS.find(u => u.id === storedId) ?? null
      setUser(found)
      setLoading(false)
      return
    }

    supabase
      .from('users')
      .select('*')
      .eq('id', storedId)
      .single()
      .then(({ data }) => {
        setUser(data ?? null)
        setLoading(false)
      })
  }, [])

  const login = useCallback(async (pin: string): Promise<boolean> => {
    setError(null)
    setLoading(true)

    try {
      if (isDemoMode) {
        const found = DEMO_USERS.find(u => u.pin === pin)
        if (found) {
          setUser(found)
          localStorage.setItem(STORAGE_KEY, found.id)
          return true
        }
        setError('Невірний PIN-код')
        return false
      }

      const { data, error: rpcError } = await supabase.rpc('login_by_pin', { p_pin: pin })
      if (rpcError || !data || data.length === 0) {
        setError('Невірний PIN-код')
        return false
      }
      const u: User = data[0]
      setUser(u)
      localStorage.setItem(STORAGE_KEY, u.id)
      return true
    } catch {
      setError('Помилка з\'єднання')
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setUser(null)
  }, [])

  return { user, loading, error, login, logout }
}
