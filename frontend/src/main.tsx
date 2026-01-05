import type { ReactNode } from 'react'
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import AppLayout from './components/AppLayout'
import { AuthProvider, useAuth } from './auth'
import Login from './pages/Login'
import LoginSuccess from './pages/LoginSuccess'
import SdkAuthPage from './pages/SdkAuthPage'
import DashboardPage from './pages/DashboardPage'
import AssetsPage from './pages/AssetsPage'
import LoggedOutPage from './pages/LoggedOutPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import ProcessesPage from './pages/ProcessesPage'
import PackagesPage from './pages/PackagesPage'
import MachinesPage from './pages/MachinesPage'
import RobotsPage from './pages/RobotsPage'
import JobsPage from './pages/JobsPage'
import JobLogsPage from './pages/JobLogsPage'
import QueuesPage from './pages/QueuesPage'
import QueueItemsPage from './pages/QueueItemsPage'
import ManageAccessPage from './pages/ManageAccessPage'
import AuditPage from './pages/AuditPage'
import SettingsPage from './pages/SettingsPage'
import TriggersPage from './pages/TriggersPage'
import LogsPage from './pages/LogsPage'
import AutomationsLayout from './components/AutomationsLayout'
import InviteAcceptPage from './pages/InviteAcceptPage'
import MyAccountPage from './pages/MyAccountPage'
import CredentialStoresPage from './pages/CredentialStoresPage'

function normalizeHash(h: string | null): string {
  const raw = (h || '#/').trim()
  // strip any trailing spaces or accidental characters
  const cleaned = raw.replace(/\s+$/,'')
  return cleaned || '#/'
}

const PUBLIC_ROUTE_PREFIXES = [
  '#/login',
  '#/forgot-password',
  '#/reset-password',
  '#/accept-invite',
  '#/sdk-auth',
  '#/logged-out',
  '#/login-success',
]

const PROTECTED_ROUTE_PREFIXES = [
  '#/dashboard',
  '#/assets',
  '#/automations',
  '#/automations/processes',
  '#/automations/jobs',
  '#/automations/triggers',
  '#/automations/logs',
  '#/processes',
  '#/packages',
  '#/machines',
  '#/robots',
  '#/jobs',
  '#/manage-access',
  '#/access',
  '#/access/users',
  '#/access/invites',
  '#/audit',
  '#/credential-stores',
  '#/logs',
  '#/settings',
  '#/queues',
  '#/queue-items',
  '#/triggers',
  '#/me',
  '#/me/account',
  '#/me/security',
]

function isPublicRoute(route: string): boolean {
  if (route === '#/' || route === '#') return true
  return PUBLIC_ROUTE_PREFIXES.some((base) => route === base || route.startsWith(`${base}`))
}

function isProtectedRoute(route: string): boolean {
  if (isPublicRoute(route)) return false
  return PROTECTED_ROUTE_PREFIXES.some((base) => route === base || route.startsWith(`${base}`))
}

function rememberReturnTo(route: string) {
  if (route && !route.startsWith('#/login') && !sessionStorage.getItem('bv_return_to')) {
    sessionStorage.setItem('bv_return_to', route)
  }
}

function navigate(to: string) {
  if (window.location.hash === to) return
  window.location.hash = to
}

function Router() {
  const { status } = useAuth()
  const [route, setRoute] = useState(normalizeHash(window.location.hash))

  const renderProtected = (node: ReactNode) => {
    if (status !== 'authenticated') return null
    return <AppLayout>{node}</AppLayout>
  }

  useEffect(() => {
    const onHashChange = () => {
      const next = normalizeHash(window.location.hash)
      console.log('[Router] route change:', next)
      setRoute(next)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    if (status === 'unauthenticated' && isProtectedRoute(route)) {
      rememberReturnTo(route)
      navigate('#/login')
    }
    const onLoginScreen = route === '#/login' || route.startsWith('#/login?')
    if (status === 'authenticated' && onLoginScreen) {
      const storedReturn = sessionStorage.getItem('bv_return_to')
      if (storedReturn && isProtectedRoute(storedReturn)) {
        sessionStorage.removeItem('bv_return_to')
        navigate(storedReturn)
      } else {
        navigate('#/dashboard')
      }
    }
  }, [route, status])

  if (status === 'loading') {
    return <FullScreenLoader />
  }

  if (status === 'unauthenticated' && isProtectedRoute(route)) {
    rememberReturnTo(route)
    navigate('#/login')
    return null
  }

  try {
    if (route === '#/') {
      navigate(status === 'authenticated' ? '#/dashboard' : '#/login')
      return null
    }

    if (route === '#/login-success') return <LoginSuccess />
    if (route.startsWith('#/login')) return <Login />
    if (route.startsWith('#/sdk-auth')) return <SdkAuthPage />
    if (route === '#/logged-out') return <LoggedOutPage />
    if (route.startsWith('#/forgot-password')) return <ForgotPasswordPage />
    if (route.startsWith('#/reset-password')) return <ResetPasswordPage />
    if (route.startsWith('#/accept-invite')) return <InviteAcceptPage />
    if (route === '#/me' || route.startsWith('#/me/')) return renderProtected(<MyAccountPage />)

    if (route === '#/dashboard') return renderProtected(<DashboardPage />)
    if (route === '#/assets') return renderProtected(<AssetsPage />)
    if (route === '#/processes') {
      window.location.hash = '#/automations/processes'
      return null
    }
    if (route === '#/jobs') {
      window.location.hash = '#/automations/jobs'
      return null
    }
    if (route === '#/triggers') {
      window.location.hash = '#/automations/triggers'
      return null
    }
    if (route === '#/logs') {
      window.location.hash = '#/automations/logs'
      return null
    }
    if (route === '#/automations') {
      window.location.hash = '#/automations/processes'
      return null
    }
    if (route === '#/packages') return renderProtected(<PackagesPage />)
    if (route === '#/machines') return renderProtected(<MachinesPage />)
    if (route === '#/robots') return renderProtected(<RobotsPage />)
    if (route.startsWith('#/jobs/') && route.includes('/logs/')) {
      const parts = route.replace('#/jobs/', '').split('/')
      const jobId = Number(parts[0])
      const executionId = parts[2] || parts[1]
      if (Number.isFinite(jobId) && executionId) {
        return renderProtected(<JobLogsPage jobId={jobId} executionId={executionId} />)
      }
    }
    if (route.startsWith('#/jobs')) return renderProtected(<JobsPage />)
    if (route === '#/manage-access' || route.startsWith('#/access/users') || route.startsWith('#/access/invites')) return renderProtected(<ManageAccessPage />)
    if (route === '#/audit') return renderProtected(<AuditPage />)
    if (route === '#/credential-stores') return renderProtected(<CredentialStoresPage />)
    if (route.startsWith('#/automations/processes')) return renderProtected(<AutomationsLayout active="processes"><ProcessesPage /></AutomationsLayout>)
    if (route.startsWith('#/automations/jobs')) return renderProtected(<AutomationsLayout active="jobs"><JobsPage /></AutomationsLayout>)
    if (route.startsWith('#/automations/triggers')) return renderProtected(<AutomationsLayout active="triggers"><TriggersPage /></AutomationsLayout>)
    if (route.startsWith('#/automations/logs')) {
      const activeTab = route.includes('jobId=') ? 'jobs' : 'logs'
      return renderProtected(<AutomationsLayout active={activeTab as any}><LogsPage /></AutomationsLayout>)
    }
    if (route === '#/settings') return renderProtected(<SettingsPage />)
    if (route === '#/queues') return renderProtected(<QueuesPage />)
    if (route.startsWith('#/queue-items')) return renderProtected(<QueueItemsPage />)

    navigate(status === 'authenticated' ? '#/dashboard' : '#/login')
    return null
  } catch (err) {
    console.error('Router render failed', err)
    return <FullScreenError />
  }
}

function FullScreenLoader() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', backgroundColor: '#f3f4f6' }}>
      <div style={{ padding: '16px 20px', borderRadius: 12, background: '#ffffff', boxShadow: '0 10px 30px rgba(0,0,0,0.08)', fontWeight: 600, color: '#111827' }}>
        Loading…
      </div>
    </div>
  )
}

function FullScreenError() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', backgroundColor: '#f3f4f6' }}>
      <div style={{ padding: '16px 20px', borderRadius: 12, background: '#ffffff', boxShadow: '0 10px 30px rgba(0,0,0,0.08)', fontWeight: 600, color: '#b91c1c' }}>
        Something went wrong. Please reload.
      </div>
    </div>
  )
}

console.log('[App] booting...')
const rootEl = document.getElementById('root')
if (!rootEl) {
  console.error('Root element not found')
  throw new Error('Root element not found')
}
createRoot(rootEl as HTMLElement).render(
  <StrictMode>
    <AuthProvider>
      <Router />
    </AuthProvider>
  </StrictMode>,
)
