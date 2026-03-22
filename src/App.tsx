import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { PinLogin } from './components/PinLogin'
import { Board } from './pages/Board'
import { Admin } from './pages/Admin'
import { Analytics } from './pages/Analytics'
import { DataAnalytics } from './pages/DataAnalytics'
import { CrmWarehouse } from './pages/CrmWarehouse'

function AppInner() {
  const { user, loading, error, login, logout } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) {
    return <PinLogin onLogin={login} error={error} loading={loading} />
  }

  // CRM users go directly to the warehouse page
  const isCrm = user.role === 'crm' || user.role === 'crm_admin'
  const isAdmin = user.role === 'admin'

  return (
    <Routes>
      <Route
        path="/"
        element={isCrm ? <Navigate to="/crm" replace /> : <Board user={user} onLogout={logout} />}
      />
      <Route
        path="/admin"
        element={isAdmin ? <Admin user={user} /> : <Navigate to="/" replace />}
      />
      <Route
        path="/analytics"
        element={isAdmin ? <Analytics user={user} /> : <Navigate to="/" replace />}
      />
      <Route
        path="/data-analytics"
        element={isAdmin ? <DataAnalytics user={user} /> : <Navigate to="/" replace />}
      />
      <Route
        path="/crm"
        element={(isCrm || isAdmin) ? <CrmWarehouse user={user} onLogout={logout} /> : <Navigate to="/" replace />}
      />
      <Route path="*" element={<Navigate to={isCrm ? '/crm' : '/'} replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AppInner />
    </BrowserRouter>
  )
}
