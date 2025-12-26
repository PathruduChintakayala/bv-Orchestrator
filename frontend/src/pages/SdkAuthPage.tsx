import { useEffect, useRef, useState } from 'react'

function getSessionIdFromHash(hash: string): string | null {
  try {
    const url = new URL((hash || '#/sdk-auth').replace('#', ''), 'http://localhost')
    return url.searchParams.get('session_id')
  } catch {
    return null
  }
}

export default function SdkAuthPage() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState<string>('')
  const hasConfirmedRef = useRef(false)

  const sessionId = getSessionIdFromHash(window.location.hash)

  const storeReturnToOnce = () => {
    const currentHash = window.location.hash
    if (
      currentHash &&
      !currentHash.startsWith('#/login') &&
      !sessionStorage.getItem('bv_return_to')
    ) {
      sessionStorage.setItem('bv_return_to', currentHash)
    }
  }

  useEffect(() => {
    const token = localStorage.getItem('token')

    if (!sessionId) {
      setStatus('error')
      setMessage('Missing session_id. You can close this window and restart SDK authentication.')
      return
    }

    if (!token) {
      storeReturnToOnce()
      window.location.hash = '#/login'
      return
    }

    if (hasConfirmedRef.current) return
    hasConfirmedRef.current = true

    setStatus('loading')
    setMessage('Confirming authentication…')

    fetch('/api/sdk/auth/confirm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ session_id: sessionId }),
    })
      .then(async (res) => {
        if (res.status === 401) {
          throw new Error('unauthorized')
        }
        if (!res.ok) {
          const text = await res.text()
          // Treat idempotent “already confirmed” responses as success.
          if ((text || '').toLowerCase().includes('already') && (text || '').toLowerCase().includes('confirm')) {
            return { status: 'ok' }
          }
          throw new Error(text || 'Failed to confirm session')
        }
        return res.json()
      })
      .then(() => {
        setStatus('success')
        setMessage('Authentication successful. You may return to the CLI.')

        // Best-effort: browsers may block closing tabs not opened by script.
        // After a login redirect, some browsers are stricter unless we try immediately.
        const attemptClose = () => {
          try {
            window.close()
          } catch {
            // ignore
          }

          // Extra fallback (harmless if blocked)
          try {
            window.open('', '_self')
            window.close()
          } catch {
            // ignore
          }
        }

        attemptClose()
        setTimeout(attemptClose, 100)
        setTimeout(attemptClose, 800)
        setTimeout(attemptClose, 1500)
      })
      .catch((e: any) => {
        if (e?.message === 'unauthorized') {
          try {
            localStorage.removeItem('token')
          } catch {}
          storeReturnToOnce()
          window.location.hash = '#/login'
          return
        }
        setStatus('error')
        setMessage(e?.message || 'Failed to confirm session')
      })
  }, [sessionId])

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
          maxWidth: '520px',
          padding: '32px 28px',
          borderRadius: '18px',
          backgroundColor: '#ffffff',
          boxShadow: '0 18px 45px rgba(15, 23, 42, 0.12)',
          margin: '0 auto',
          boxSizing: 'border-box',
          textAlign: 'center',
        }}
      >
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#111827', marginBottom: 10 }}>
          SDK Authentication
        </h1>
        {status === 'loading' ? (
          <p style={{ color: '#374151', fontSize: 14 }}>{message}</p>
        ) : status === 'success' ? (
          <p style={{ color: '#065f46', fontSize: 14 }}>{message}</p>
        ) : status === 'error' ? (
          <p style={{ color: '#b91c1c', fontSize: 14 }}>{message}</p>
        ) : (
          <p style={{ color: '#374151', fontSize: 14 }}>Preparing…</p>
        )}
        <div style={{ marginTop: 14, color: '#6b7280', fontSize: 12 }}>
          This page is for developer-only SDK authentication.
        </div>
      </div>
    </div>
  )
}
