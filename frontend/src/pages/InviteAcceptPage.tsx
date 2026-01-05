import { useMemo, useState } from 'react'

function extractToken(): string | null {
  try {
    const hash = window.location.hash || ''
    const [pathPart, query] = hash.split('?')
    const pathSegments = (pathPart || '').replace(/^#/, '').split('/').filter(Boolean)
    if (pathSegments[0] === 'accept-invite' && pathSegments[1]) {
      return pathSegments[1]
    }
    const params = new URLSearchParams(query || '')
    return params.get('token')
  } catch {
    return null
  }
}

export default function InviteAcceptPage() {
  const token = useMemo(() => extractToken(), [])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token) return
    if (password !== confirmPassword) {
      setMessage('Passwords must match.')
      return
    }
    setMessage(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/invite/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, username, password, full_name: fullName || undefined }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || 'Invite acceptance failed')
      }
      setMessage('Account created. You can log in now.')
      window.location.hash = '#/login'
    } catch (err: any) {
      setMessage(err?.message || 'Invite acceptance failed')
    } finally {
      setLoading(false)
    }
  }

  const card: React.CSSProperties = {
    width: '100%',
    maxWidth: 480,
    padding: '32px 28px',
    borderRadius: 18,
    background: '#fff',
    boxShadow: '0 18px 45px rgba(15,23,42,0.12)',
    boxSizing: 'border-box',
  }

  const input: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #e5e7eb',
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box',
  }

  const label: React.CSSProperties = {
    display: 'block',
    marginBottom: 8,
    fontSize: 14,
    fontWeight: 600,
    color: '#111827',
  }

  if (!token) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f3f4f6', padding: 24 }}>
        <div style={card}>
          <h1 style={{ fontSize: 24, fontWeight: 700, textAlign: 'center', marginBottom: 12 }}>Invite not found</h1>
          <p style={{ color: '#6b7280', textAlign: 'center', marginBottom: 16 }}>Missing or invalid invite token.</p>
          <div style={{ textAlign: 'center' }}>
            <a href="#/login" style={{ color: '#2563eb', textDecoration: 'none' }}>Go to login</a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f3f4f6', padding: 24 }}>
      <div style={card}>
        <h1 style={{ fontSize: 24, fontWeight: 700, textAlign: 'center', marginBottom: 10 }}>Accept your invite</h1>
        <p style={{ color: '#6b7280', textAlign: 'center', marginBottom: 24 }}>Set a username and password to finish signup.</p>
        <form onSubmit={submit}>
          <div style={{ marginBottom: 16 }}>
            <label style={label}>Username</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Choose a username" style={input} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={label}>Full name (optional)</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your name" style={input} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={label}>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Create a password" style={input} />
          </div>
          <div style={{ marginBottom: 24 }}>
            <label style={label}>Confirm password</label>
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm password" style={input} />
          </div>
          <button type="submit" disabled={loading} style={{ width: '100%', padding: 12, borderRadius: 8, border: 'none', fontSize: 16, fontWeight: 600, background: '#2563eb', color: '#fff' }}>
            {loading ? 'Creating…' : 'Create account'}
          </button>
        </form>
        {message && (
          <p style={{ marginTop: 12, color: message.includes('created') ? '#065f46' : '#b91c1c' }}>{message}</p>
        )}
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <a href="#/login" style={{ color: '#2563eb', textDecoration: 'none' }}>Back to login</a>
        </div>
      </div>
    </div>
  )
}
