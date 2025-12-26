import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Login from './pages/Login'
import Register from './pages/Register'
import RegisterSuccess from './pages/RegisterSuccess'
import LoginSuccess from './pages/LoginSuccess'
import SdkAuthPage from './pages/SdkAuthPage'
import DashboardPage from './pages/DashboardPage'
import AssetsPage from './pages/AssetsPage'
import LoggedOutPage from './pages/LoggedOutPage'
import AppLayout from './components/AppLayout'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ProcessesPage from './pages/ProcessesPage'
import PackagesPage from './pages/PackagesPage'
import MachinesPage from './pages/MachinesPage'
import RobotsPage from './pages/RobotsPage'
import JobsPage from './pages/JobsPage'
import QueuesPage from './pages/QueuesPage'
import QueueItemsPage from './pages/QueueItemsPage'
import ManageAccessPage from './pages/ManageAccessPage'
import AuditPage from './pages/AuditPage'
import SettingsPage from './pages/SettingsPage'

function normalizeHash(h: string | null): string {
  const raw = (h || '#/').trim()
  // strip any trailing spaces or accidental characters
  const cleaned = raw.replace(/\s+$/,'')
  return cleaned || '#/'
}

function Router() {
  const [route, setRoute] = useState(normalizeHash(window.location.hash))

  useEffect(() => {
    const onHashChange = () => {
      const next = normalizeHash(window.location.hash)
      console.log('[Router] route change:', next)
      setRoute(next)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const ensureLoggedIn = () => {
    if (!localStorage.getItem('token')) {
      const currentHash = window.location.hash

      if (
        currentHash &&
        !currentHash.startsWith('#/login') &&
        !sessionStorage.getItem('bv_return_to')
      ) {
        sessionStorage.setItem('bv_return_to', currentHash)
      }

      window.location.hash = '#/login'
      return false
    }

    return true
  }

    // Root route: send logged-in users to dashboard, otherwise show login.
    if (route === '#/') {
      const token = localStorage.getItem('token')
      if (token) {
        window.location.hash = '#/dashboard'
        return null
      }
      window.location.hash = '#/login'
      return null
    }

    // Route order matters: check success before generic register
    if (route === '#/register-success') {
      return <RegisterSuccess />
    }
    if (route === '#/register') {
      return <Register />
    }
    if (route.startsWith('#/login')) {
      return <Login />
    }
    if (route === '#/login-success') {
      return <LoginSuccess />
    }

    if (route.startsWith('#/sdk-auth')) {
      return <SdkAuthPage />
    }
    if (route === '#/dashboard') {
      if (!ensureLoggedIn()) return null
      return <AppLayout><DashboardPage /></AppLayout>
    }
    if (route === '#/assets') {
      if (!ensureLoggedIn()) return null
      return <AppLayout><AssetsPage /></AppLayout>
    }
    if (route === '#/processes') {
      if (!ensureLoggedIn()) return null
      return <AppLayout><ProcessesPage /></AppLayout>
    }
    if (route === '#/packages') {
      if (!ensureLoggedIn()) return null
      return <AppLayout><PackagesPage /></AppLayout>
    }
    if (route === '#/machines') {
      if (!ensureLoggedIn()) return null
      return <AppLayout><MachinesPage /></AppLayout>
    }
    if (route === '#/robots') {
      if (!ensureLoggedIn()) return null
      return <AppLayout><RobotsPage /></AppLayout>
    }
    if (route.startsWith('#/jobs')) {
      if (!ensureLoggedIn()) return null
      return <AppLayout><JobsPage /></AppLayout>
    }
    if (route === '#/manage-access') {
      if (!ensureLoggedIn()) return null
      return <AppLayout><ManageAccessPage /></AppLayout>
    }
    if (route === '#/audit') {
      if (!ensureLoggedIn()) return null
      return <AppLayout><AuditPage /></AppLayout>
    }
    if (route === '#/settings') {
      if (!ensureLoggedIn()) return null
      return <AppLayout><SettingsPage /></AppLayout>
    }
    if (route === '#/queues') {
      if (!ensureLoggedIn()) return null
      return <AppLayout><QueuesPage /></AppLayout>
    }
    if (route.startsWith('#/queue-items')) {
      if (!ensureLoggedIn()) return null
      return <AppLayout><QueueItemsPage /></AppLayout>
    }
    if (route === '#/logged-out') {
      return <LoggedOutPage />
    }
    if (route === '#/forgot') {
      return <ForgotPasswordPage />
    }
  // Unknown route fallback
  if (localStorage.getItem('token')) {
    window.location.hash = '#/dashboard'
  } else {
    window.location.hash = '#/login'
  }
  return null
}

console.log('[App] booting...')
const rootEl = document.getElementById('root')
if (!rootEl) {
  console.error('Root element not found')
}
createRoot(rootEl as HTMLElement).render(
  <StrictMode>
    <Router />
  </StrictMode>,
)
