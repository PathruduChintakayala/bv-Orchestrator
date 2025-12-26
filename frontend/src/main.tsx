import React, { useEffect, useState } from 'react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Login from './pages/Login'
import Register from './pages/Register'
import RegisterSuccess from './pages/RegisterSuccess'
import LoginSuccess from './pages/LoginSuccess'
import DashboardPage from './pages/DashboardPage'
import AssetsPage from './pages/AssetsPage'
import LoggedOutPage from './pages/LoggedOutPage'
import AppLayout from './components/AppLayout'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ProcessesPage from './pages/ProcessesPage'
import PackagesPage from './pages/PackagesPage'
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

    // If authenticated and at root, default to dashboard
    if (route === '#/') {
      const token = localStorage.getItem('token')
      if (token) {
        window.location.hash = '#/dashboard'
        return null
      }
    }

    // Route order matters: check success before generic register
    if (route === '#/register-success') {
      return <RegisterSuccess />
    }
    if (route === '#/register') {
      return <Register />
    }
    if (route === '#/login-success') {
      return <LoginSuccess />
    }
    if (route === '#/dashboard') {
      const token = localStorage.getItem('token')
      if (!token) return <Login />
      return <AppLayout><DashboardPage /></AppLayout>
    }
    if (route === '#/assets') {
      const token = localStorage.getItem('token')
      if (!token) return <Login />
      return <AppLayout><AssetsPage /></AppLayout>
    }
    if (route === '#/processes') {
      const token = localStorage.getItem('token')
      if (!token) return <Login />
      return <AppLayout><ProcessesPage /></AppLayout>
    }
    if (route === '#/packages') {
      const token = localStorage.getItem('token')
      if (!token) return <Login />
      return <AppLayout><PackagesPage /></AppLayout>
    }
    if (route === '#/robots') {
      const token = localStorage.getItem('token')
      if (!token) return <Login />
      return <AppLayout><RobotsPage /></AppLayout>
    }
    if (route.startsWith('#/jobs')) {
      const token = localStorage.getItem('token')
      if (!token) return <Login />
      return <AppLayout><JobsPage /></AppLayout>
    }
    if (route === '#/manage-access') {
      const token = localStorage.getItem('token')
      if (!token) return <Login />
      return <AppLayout><ManageAccessPage /></AppLayout>
    }
    if (route === '#/audit') {
      const token = localStorage.getItem('token')
      if (!token) return <Login />
      return <AppLayout><AuditPage /></AppLayout>
    }
    if (route === '#/settings') {
      const token = localStorage.getItem('token')
      if (!token) return <Login />
      return <AppLayout><SettingsPage /></AppLayout>
    }
    if (route === '#/queues') {
      const token = localStorage.getItem('token')
      if (!token) return <Login />
      return <AppLayout><QueuesPage /></AppLayout>
    }
    if (route.startsWith('#/queue-items')) {
      const token = localStorage.getItem('token')
      if (!token) return <Login />
      return <AppLayout><QueueItemsPage /></AppLayout>
    }
    if (route === '#/logged-out') {
      return <LoggedOutPage />
    }
    if (route === '#/forgot') {
      return <ForgotPasswordPage />
    }
  // TODO: add Forgot page later
  console.log('[Router] render route:', route)
  const token = localStorage.getItem('token')
  // Fallback: if authed, ensure we land on dashboard; if not, ensure hash is login
  if (token) {
    if (route !== '#/dashboard') {
      window.location.hash = '#/dashboard'
      return null
    }
    return <AppLayout><DashboardPage /></AppLayout>
  } else {
    if (route !== '#/') {
      window.location.hash = '#/'
      return null
    }
    return <Login />
  }
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
