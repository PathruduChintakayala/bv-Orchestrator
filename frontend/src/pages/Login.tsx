import { useState } from 'react'
import { useAuth } from '../auth'

export default function Login() {
  let auth: ReturnType<typeof useAuth> | null = null
  try {
    auth = useAuth()
  } catch (err) {
    console.error('Auth context missing', err)
    return (
      <div style={{ minHeight: '100vh', width: '100%', display: 'grid', placeItems: 'center', backgroundColor: '#f3f4f6', padding: '24px' }}>
        <div style={{ width: '100%', maxWidth: '420px', padding: '32px 28px', borderRadius: '18px', backgroundColor: '#ffffff', boxShadow: '0 18px 45px rgba(15, 23, 42, 0.12)', margin: '0 auto', boxSizing: 'border-box', textAlign: 'center' }}>
          <p style={{ color: '#b91c1c', fontWeight: 600 }}>Something went wrong. Please reload.</p>
        </div>
      </div>
    )
  }
  const { setAuthenticatedSession } = auth
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return
    setMessage(null)
    setLoading(true)
    const params = new URLSearchParams()
    params.append('username', username)
    params.append('password', password)
    params.append('grant_type', 'password')
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || 'Login failed')
      }
      const data = await res.json()
      let me: any | null = null
      try {
        const meRes = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${data.access_token}` } })
        if (meRes.ok) {
          me = await meRes.json()
        }
      } catch {}

      setAuthenticatedSession(data.access_token, me || undefined)

      const returnTo = sessionStorage.getItem('bv_return_to')
      sessionStorage.removeItem('bv_return_to')

      if (returnTo && !returnTo.startsWith('#/login')) {
        window.location.hash = returnTo
      } else {
        window.location.hash = '#/dashboard'
      }
    } catch (err: any) {
      setMessage(err.message || 'Error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100%',
        display: 'grid',
        placeItems: 'center',
        backgroundColor: '#f3f4f6',
        padding: '24px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '420px',
          padding: '32px 28px',
          borderRadius: '18px',
          backgroundColor: '#ffffff',
          boxShadow: '0 18px 45px rgba(15, 23, 42, 0.12)',
          margin: '0 auto',
          boxSizing: 'border-box',
        }}
      >
        <h1
          style={{
            fontSize: '26px',
            fontWeight: 700,
            textAlign: 'center',
            marginBottom: '32px',
            color: '#111827',
          }}
        >
          BV Orchestrator
        </h1>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ marginBottom: '20px' }}>
            <label
              htmlFor="username"
              style={{
                display: 'block',
                marginBottom: '8px',
                fontSize: '14px',
                fontWeight: 600,
                color: '#111827',
              }}
            >
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid #e5e7eb',
                fontSize: '14px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label
              htmlFor="password"
              style={{
                display: 'block',
                marginBottom: '8px',
                fontSize: '14px',
                fontWeight: 600,
                color: '#111827',
              }}
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid #e5e7eb',
                fontSize: '14px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '8px',
              border: 'none',
              fontSize: '16px',
              fontWeight: 600,
              backgroundColor: '#2563eb',
              color: '#ffffff',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Logging in…' : 'Login'}
          </button>
        </form>

        {message && (
          <p style={{ marginTop: 12, color: message.includes('success') ? '#065f46' : '#b91c1c' }}>
            {message}
          </p>
        )}
        <div
          style={{
            marginTop: 16,
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '14px',
          }}
        >
          <a href="#/forgot-password" style={{ color: '#2563eb', textDecoration: 'none' }}>
            Forgot password?
          </a>
          <span style={{ color: '#6b7280' }}>Need access? Ask an admin for an invite.</span>
        </div>
      </div>
    </div>
  )
}
