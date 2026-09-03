import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { PinLogin } from './components/PinLogin'

const Board = lazy(() => import('./pages/Board').then(module => ({ default: module.Board })))
const Admin = lazy(() => import('./pages/Admin').then(module => ({ default: module.Admin })))
const Analytics = lazy(() => import('./pages/Analytics').then(module => ({ default: module.Analytics })))
const DataAnalytics = lazy(() => import('./pages/DataAnalytics').then(module => ({ default: module.DataAnalytics })))
const CrmWarehouse = lazy(() => import('./pages/CrmWarehouse').then(module => ({ default: module.CrmWarehouse })))

function PageLoader() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center" aria-label="Завантаження сторінки">
      <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

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
  const isAdmin = user.role === 'admin' || user.role === 'super_admin' || user.role === 'ceo'

  return (
    <Suspense fallback={<PageLoader />}>
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
    </Suspense>
  )
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AppInner />
    </BrowserRouter>
  )
}
