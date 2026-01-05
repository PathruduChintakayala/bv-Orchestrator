import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

type AuthContextValue = {
  status: AuthStatus
  token: string | null
  user: any | null
  permissions: Record<string, boolean>
  setAuthenticatedSession: (token: string, me?: { user?: any; permissions?: { flat?: Record<string, boolean> } | Record<string, boolean> }) => void
  logout: () => void
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

function persistAuth(token: string, me?: { user?: any; permissions?: { flat?: Record<string, boolean> } | Record<string, boolean> }) {
  localStorage.setItem('token', token)
  if (me?.user) {
    localStorage.setItem('currentUser', JSON.stringify(me.user))
    if ((me as any).user?.username) {
      localStorage.setItem('username', (me as any).user.username)
    }
  }
  const perms = (me as any)?.permissions?.flat || (me as any)?.permissions
  if (perms && typeof perms === 'object') {
    localStorage.setItem('permissions', JSON.stringify(perms))
  }
}

function clearAuthStorage() {
  try {
    localStorage.removeItem('token')
    localStorage.removeItem('currentUser')
    localStorage.removeItem('permissions')
  } catch {
    // ignore
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<any | null>(null)
  const [permissions, setPermissions] = useState<Record<string, boolean>>({})

  const setAuthenticatedSession = useCallback(
    (nextToken: string, me?: { user?: any; permissions?: { flat?: Record<string, boolean> } | Record<string, boolean> }) => {
      persistAuth(nextToken, me)
      setToken(nextToken)
      setUser((me as any)?.user ?? null)
      const perms = (me as any)?.permissions?.flat || (me as any)?.permissions
      setPermissions(perms && typeof perms === 'object' ? (perms as Record<string, boolean>) : {})
      setStatus('authenticated')
    },
    [],
  )

  const logout = useCallback(() => {
    clearAuthStorage()
    setToken(null)
    setUser(null)
    setPermissions({})
    setStatus('unauthenticated')
  }, [])

  const refresh = useCallback(async () => {
    const stored = localStorage.getItem('token')
    if (!stored) {
      logout()
      return
    }

    setStatus('loading')
    try {
      const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${stored}` } })
      if (!res.ok) throw new Error('unauthorized')
      const me = await res.json()
      setAuthenticatedSession(stored, me)
    } catch {
      logout()
    }
  }, [logout, setAuthenticatedSession])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    const originalFetch = window.fetch
    window.fetch = (async (...args: Parameters<typeof originalFetch>) => {
      const response = await originalFetch(...args)
      try {
        const requestUrl = typeof args[0] === 'string' ? args[0] : (args[0] as Request)?.url
        const isAuthMe = typeof requestUrl === 'string' && requestUrl.includes('/api/auth/me')
        if (response.status === 401 && isAuthMe) {
          logout()
          window.location.hash = '#/login'
        }
      } catch {
        // noop
      }
      return response
    }) as typeof window.fetch
    return () => {
      window.fetch = originalFetch
    }
  }, [logout])

  const value = useMemo(
    () => ({ status, token, user, permissions, setAuthenticatedSession, logout, refresh }),
    [status, token, user, permissions, setAuthenticatedSession, logout, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
