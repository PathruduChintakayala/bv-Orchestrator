import { useEffect, useRef, useState } from 'react'
import { fetchGeneralSettings, fetchEmailSettings, updateGeneralSettings, updateEmailSettings, defaultEmailSettings, testEmailSettings } from '../api/settings'
import { TIMEZONE_OPTIONS } from '../utils/timezones'

const cardStyle = { backgroundColor: '#fff', borderRadius: 12, boxShadow: '0 10px 24px rgba(15,23,42,0.08)', padding: 16 }
const label = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: '#6b7280' }
const selectStyle = { padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', minWidth: 260 }
const labelMap: Record<string, string> = { smtpHost: 'SMTP Host', smtpPort: 'SMTP Port', fromAddress: 'From Address' }

export default function SettingsPage() {
  const [timezone, setTimezone] = useState('UTC')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [emailSettings, setEmailSettings] = useState(defaultEmailSettings)
  const [emailPassword, setEmailPassword] = useState('')
  const [testRecipient, setTestRecipient] = useState('')
  const [testStatus, setTestStatus] = useState<{ ok: boolean; message: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [collapsedGeneral, setCollapsedGeneral] = useState(false) // expanded by default
  const [collapsedEmail, setCollapsedEmail] = useState(true) // collapsed by default
  const [invalidEmailFields, setInvalidEmailFields] = useState<string[]>([])
  const generalRef = useRef<HTMLDivElement | null>(null)
  const emailRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        setLoading(true)
        const [general, email] = await Promise.all([fetchGeneralSettings(), fetchEmailSettings()])
        if (mounted) {
          setTimezone(general.timezone || 'UTC')
          setEmailSettings({ ...defaultEmailSettings, ...email })
          setEmailPassword('')
        }
      } catch (e: any) {
        if (mounted) setError(e.message || 'Failed to load settings')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => { mounted = false }
  }, [])

  function validateEmailConfig(state: typeof defaultEmailSettings): { message: string | null; fields: string[] } {
    if (!state.enabled) return { message: null, fields: [] }
    if (state.smtpUseTls && state.smtpUseSsl) return { message: 'Choose either TLS or SSL, not both.', fields: ['smtpUseTls', 'smtpUseSsl'] }
    const missing: string[] = []
    if (!state.smtpHost.trim()) missing.push('smtpHost')
    if (state.smtpPort === null || Number.isNaN(state.smtpPort)) missing.push('smtpPort')
    if (!state.fromAddress.trim()) missing.push('fromAddress')
    if (missing.length) return { message: `Missing required fields: ${missing.map(m => labelMap[m] || m).join(', ')}`, fields: missing }
    return { message: null, fields: [] }
  }

  async function handleSave() {
    try {
      setSaving(true); setError(null); setSuccess(null); setInvalidEmailFields([])
      const emailValidation = validateEmailConfig(emailSettings)
      if (emailValidation.message) {
        setError(emailValidation.message)
        setInvalidEmailFields(emailValidation.fields)
        setCollapsedEmail(false)
        setTimeout(() => emailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
        setSaving(false)
        return
      }
      const emailPayload = { ...emailSettings }
      if (emailPassword.trim()) {
        emailPayload.smtpPassword = emailPassword.trim()
      } else {
        delete (emailPayload as any).smtpPassword
      }
      const [nextGeneral, nextEmail] = await Promise.all([
        updateGeneralSettings({ timezone }),
        updateEmailSettings(emailPayload),
      ])
      setTimezone(nextGeneral.timezone || 'UTC')
      setEmailSettings({ ...defaultEmailSettings, ...nextEmail })
      setEmailPassword('')
      setSuccess('Saved')
    } catch (e: any) {
      setError(e.message || 'Save failed')
    } finally {
      setSaving(false)
      setTimeout(() => setSuccess(null), 2500)
    }
  }

  async function handleTestEmail() {
    setTestStatus(null)
    if (!emailSettings.enabled) {
      setTestStatus({ ok: false, message: 'Enable email settings before testing.' })
      return
    }
    const target = testRecipient.trim() || emailSettings.fromAddress.trim()
    if (!target) {
      setTestStatus({ ok: false, message: 'Provide a recipient for the test email.' })
      return
    }
    try {
      setTesting(true)
      await testEmailSettings(target)
      setTestStatus({ ok: true, message: 'Test email queued. Check your inbox.' })
    } catch (e: any) {
      setTestStatus({ ok: false, message: e.message || 'Test email failed' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <div className="page-shell" style={{ gap: 12 }}>
        <div className="surface-card" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h1 className="page-title" style={{ margin: 0 }}>Settings</h1>
            <p style={{ margin: 0, color: '#6b7280' }}>Display preferences and notification channels.</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="btn btn-ghost" onClick={handleSave} disabled={saving || loading}>💾 Save</button>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          <div ref={generalRef} style={cardStyle}>
            <button onClick={() => setCollapsedGeneral(c => !c)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}>
              <div>
                <h2 style={{ marginTop: 0, marginBottom: 2, fontSize: 16, textAlign: 'left' }}>General</h2>
                <p style={{ color: '#374151', fontSize: 14, marginTop: 0, textAlign: 'left' }}>Controls how timestamps are rendered in the UI. Storage and scheduling remain UTC.</p>
              </div>
              <span aria-hidden style={{ transform: collapsedGeneral ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease', fontSize: 18, lineHeight: 1 }}>⌄</span>
            </button>
            {!collapsedGeneral && (
              loading ? <p>Loading…</p> : (
                <div style={{ display: 'grid', gap: 14, maxWidth: 420 }}>
                  <label style={label as any}>
                    <span>Display Timezone</span>
                    <select value={timezone} onChange={e => setTimezone(e.target.value)} style={selectStyle as any}>
                      {TIMEZONE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </select>
                    <span style={{ color: '#6b7280', fontSize: 12 }}>Used only for presentation; triggers and cron keep their own timezone.</span>
                  </label>
                </div>
              )
            )}
          </div>

          <div ref={emailRef} style={cardStyle}>
            <button onClick={() => setCollapsedEmail(c => !c)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}>
              <div>
                <h2 style={{ marginTop: 0, marginBottom: 2, fontSize: 16, textAlign: 'left' }}>Email / Notifications</h2>
                <p style={{ color: '#374151', fontSize: 14, marginTop: 0, textAlign: 'left' }}>SMTP alerts are off by default. Configure and enable to receive failure notifications.</p>
              </div>
              <span aria-hidden style={{ transform: collapsedEmail ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease', fontSize: 18, lineHeight: 1 }}>⌄</span>
            </button>
            {!collapsedEmail && (
              loading ? <p>Loading…</p> : (
                <div style={{ display: 'grid', gap: 12, maxWidth: 720 }}>
                  <label style={{ ...label, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <input type="checkbox" checked={emailSettings.enabled} onChange={e => setEmailSettings({ ...emailSettings, enabled: e.target.checked })} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ color: '#111827', fontWeight: 600 }}>Enable email notifications</span>
                      <span>When enabled, job/trigger failures and offline robots send alerts via SMTP.</span>
                    </div>
                  </label>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
                    <label style={label as any}>
                      <span>SMTP Host</span>
                      <input value={emailSettings.smtpHost} onChange={e => setEmailSettings({ ...emailSettings, smtpHost: e.target.value })} style={{ ...selectStyle as any, borderColor: invalidEmailFields.includes('smtpHost') ? '#b91c1c' : '#e5e7eb' }} placeholder="smtp.example.com" />
                    </label>
                    <label style={label as any}>
                      <span>SMTP Port</span>
                      <input type="number" value={emailSettings.smtpPort ?? ''} onChange={e => setEmailSettings({ ...emailSettings, smtpPort: e.target.value ? Number(e.target.value) : null })} style={{ ...selectStyle as any, borderColor: invalidEmailFields.includes('smtpPort') ? '#b91c1c' : '#e5e7eb' }} placeholder="587" />
                    </label>
                    <label style={label as any}>
                      <span>Username</span>
                      <input value={emailSettings.smtpUsername} onChange={e => setEmailSettings({ ...emailSettings, smtpUsername: e.target.value })} style={selectStyle as any} placeholder="user@example.com" />
                    </label>
                    <label style={label as any}>
                      <span>Password</span>
                      <input type="password" value={emailPassword} onChange={e => setEmailPassword(e.target.value)} style={selectStyle as any} placeholder={emailSettings.smtpPasswordSet ? 'Leave blank to keep existing' : 'SMTP password'} />
                    </label>
                  </div>

                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: '#374151' }}>
                      <input type="checkbox" checked={emailSettings.smtpUseTls} onChange={e => setEmailSettings({ ...emailSettings, smtpUseTls: e.target.checked, smtpUseSsl: e.target.checked ? false : emailSettings.smtpUseSsl })} />
                      <span>Use STARTTLS</span>
                    </label>
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: '#374151' }}>
                      <input type="checkbox" checked={emailSettings.smtpUseSsl} onChange={e => setEmailSettings({ ...emailSettings, smtpUseSsl: e.target.checked, smtpUseTls: e.target.checked ? false : emailSettings.smtpUseTls })} />
                      <span>Use SSL</span>
                    </label>
                  </div>

                  <label style={label as any}>
                    <span>From Address</span>
                    <input value={emailSettings.fromAddress} onChange={e => setEmailSettings({ ...emailSettings, fromAddress: e.target.value })} style={{ ...selectStyle as any, borderColor: invalidEmailFields.includes('fromAddress') ? '#b91c1c' : '#e5e7eb' }} placeholder="orchestrator@example.com" />
                    <span style={{ color: '#6b7280', fontSize: 12 }}>Used as the sender and fallback recipient for alerts.</span>
                  </label>

                  <div style={{ display: 'grid', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <input value={testRecipient} onChange={e => setTestRecipient(e.target.value)} style={{ ...selectStyle as any, minWidth: 260 }} placeholder="Test recipient (defaults to From)" />
                      <button className="btn" onClick={handleTestEmail} disabled={testing || loading}>✉️ Test Email</button>
                    </div>
                    {testStatus && <div style={{ color: testStatus.ok ? '#047857' : '#b91c1c', fontSize: 13 }}>{testStatus.message}</div>}
                  </div>
                </div>
              )
            )}
          </div>
        </div>

        {error && <p style={{ color: '#b91c1c', marginTop: 4 }}>{error}</p>}
        {success && <p style={{ color: '#047857', marginTop: 4 }}>{success}</p>}
      </div>
    </div>
  );
}
