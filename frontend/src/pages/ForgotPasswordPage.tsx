import { useState } from 'react'

export default function ForgotPasswordPage() {
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMessage(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, newPassword }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || 'Reset failed')
      }
      setMessage('Password reset successful. You can log in now.')
      // Optional: route to login
      window.location.hash = '#/'
    } catch (err: any) {
      setMessage(err.message || 'Error')
    } finally {
      setLoading(false)
    }
  }

  const card: React.CSSProperties = {
    width: '100%',
    maxWidth: 420,
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

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f3f4f6', padding: 24 }}>
      <div style={card}>
        <h1 style={{ fontSize: 24, fontWeight: 700, textAlign: 'center', marginBottom: 24 }}>Reset Password</h1>
        <form onSubmit={submit}>
          <div style={{ marginBottom: 16 }}>
            <label style={label}>Username</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Your username" style={input} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={label}>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Your email" style={input} />
          </div>
          <div style={{ marginBottom: 24 }}>
            <label style={label}>New Password</label>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="New password" style={input} />
          </div>
          <button type="submit" disabled={loading} style={{ width: '100%', padding: 12, borderRadius: 8, border: 'none', fontSize: 16, fontWeight: 600, background: '#2563eb', color: '#fff' }}>
            {loading ? 'Resetting…' : 'Reset Password'}
          </button>
        </form>
        {message && (
          <p style={{ marginTop: 12, color: message.includes('successful') ? '#065f46' : '#b91c1c' }}>{message}</p>
        )}
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <a href="#/" style={{ color: '#2563eb', textDecoration: 'none' }}>Back to login</a>
        </div>
      </div>
    </div>
  )
}
