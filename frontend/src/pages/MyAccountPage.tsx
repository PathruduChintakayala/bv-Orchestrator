import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth'
import { changeMyPassword, deleteMyAvatar, fetchAuthMe, fetchMyProfile, listMySessions, logoutOtherSessions, updateMyProfile, uploadMyAvatar } from '../api/me'
import type { MyProfile, SessionInfo } from '../types/me'
import { formatDisplayTime } from '../utils/datetime'
import { Avatar } from '../components/Avatar'

type TabKey = 'account' | 'security'

function tabFromHash(hash: string): TabKey {
  if (hash.includes('/security')) return 'security'
  return 'account'
}

export default function MyAccountPage() {
  const { setAuthenticatedSession, user, refresh } = useAuth()
  const [profile, setProfile] = useState<MyProfile | null>(null)
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [activeTab, setActiveTab] = useState<TabKey>(() => tabFromHash(window.location.hash || '#/me/account'))
  const [loading, setLoading] = useState(true)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [savingSessions, setSavingSessions] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [removingAvatar, setRemovingAvatar] = useState(false)
  const [avatarError, setAvatarError] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [displayName, setDisplayName] = useState('')
  const [timezonePref, setTimezonePref] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [lastLogin, setLastLogin] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    const onHash = () => setActiveTab(tabFromHash(window.location.hash || '#/me/account'))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  function goTab(tab: TabKey) {
    window.location.hash = tab === 'security' ? '#/me/security' : '#/me/account'
    setActiveTab(tab)
  }

  async function load() {
    try {
      setLoading(true)
      const p = await fetchMyProfile()
      setProfile(p)
      setDisplayName(p.displayName || '')
      setTimezonePref((p.preferences?.timezone as string) || '')
      setLastLogin(p.lastLogin || null)
      const sess = await listMySessions()
      setSessions(sess.sessions)
      setLastLogin(sess.lastLogin || p.lastLogin || null)
    } catch (e: any) {
      alert(e.message || 'Failed to load profile')
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveProfile() {
    try {
      setSavingProfile(true)
      const prefs = { ...(profile?.preferences || {}) }
      if (timezonePref.trim()) prefs.timezone = timezonePref.trim()
      else delete prefs.timezone
      const updated = await updateMyProfile({ displayName, preferences: prefs })
      setProfile(updated)
      setTimezonePref((updated.preferences?.timezone as string) || '')
      alert('Profile updated')
    } catch (e: any) {
      alert(e.message || 'Save failed')
    } finally {
      setSavingProfile(false)
    }
  }

  async function handleChangePassword() {
    if (!currentPassword.trim()) { alert('Enter your current password'); return }
    if (!newPassword.trim()) { alert('Enter a new password'); return }
    if (newPassword !== confirmPassword) { alert('Passwords do not match'); return }
    try {
      setSavingPassword(true)
      const res = await changeMyPassword({ currentPassword, newPassword })
      const me = await fetchAuthMe(res.accessToken)
      setAuthenticatedSession(res.accessToken, me)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      alert('Password changed. Sessions refreshed.')
    } catch (e: any) {
      alert(e.message || 'Password change failed')
    } finally {
      setSavingPassword(false)
    }
  }

  async function handleLogoutOthers() {
    try {
      setSavingSessions(true)
      const res = await logoutOtherSessions()
      const me = await fetchAuthMe(res.accessToken)
      setAuthenticatedSession(res.accessToken, me)
      const sess = await listMySessions()
      setSessions(sess.sessions)
      setLastLogin(sess.lastLogin || profile?.lastLogin || null)
      alert('Other sessions logged out')
    } catch (e: any) {
      alert(e.message || 'Action failed')
    } finally {
      setSavingSessions(false)
    }
  }

  function persistProfileLocally(p: MyProfile) {
    try {
      localStorage.setItem('currentUser', JSON.stringify({
        id: p.id,
        username: p.username,
        display_name: p.displayName,
        full_name: p.displayName,
        avatar_url: p.avatarUrl,
        avatarUrl: p.avatarUrl,
      }))
      if (p.username) localStorage.setItem('username', p.username)
    } catch {
      // ignore
    }
  }

  async function handleAvatarSelect(file: File | null | undefined) {
    if (!file) return
    setAvatarError('')
    const typeOk = ['image/png', 'image/jpeg', 'image/jpg'].includes(file.type)
    if (!typeOk) { setAvatarError('Only PNG or JPG images are supported'); return }
    if (file.size > 2 * 1024 * 1024) { setAvatarError('Max file size is 2MB'); return }
    try {
      setUploadingAvatar(true)
      const updated = await uploadMyAvatar(file)
      setProfile(updated)
      persistProfileLocally(updated)
      await refresh()
    } catch (e: any) {
      setAvatarError(e?.message || 'Upload failed')
    } finally {
      setUploadingAvatar(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleAvatarRemove() {
    try {
      setRemovingAvatar(true)
      const updated = await deleteMyAvatar()
      setProfile(updated)
      persistProfileLocally(updated)
      await refresh()
    } catch (e: any) {
      setAvatarError(e?.message || 'Remove failed')
    } finally {
      setRemovingAvatar(false)
    }
  }

  const headerName = useMemo(() => {
    if (profile?.displayName) return profile.displayName
    if (user?.full_name) return user.full_name
    return user?.username || 'My Account'
  }, [profile, user])

  if (loading) return <div style={{ padding: 16 }}>Loading...</div>
  if (!profile) return <div style={{ padding: 16 }}>Profile unavailable</div>

  return (
    <div style={{ padding: 16 }}>
      <div className="page-shell" style={{ gap: 12 }}>
        <div className="surface-card" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h1 className="page-title" style={{ margin: 0 }}>{headerName}</h1>
            <p style={{ margin: 0, color: '#6b7280' }}>{profile.email || 'No email on file'}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => goTab('account')} style={activeTab==='account'?primaryBtn:secondaryBtn}>My Account</button>
            <button onClick={() => goTab('security')} style={activeTab==='security'?primaryBtn:secondaryBtn}>Security</button>
          </div>
        </div>

        {activeTab === 'account' ? (
          <div className="surface-card" style={{ padding: 16, display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>Profile Picture</div>
                  <div style={{ color: '#6b7280', fontSize: 12 }}>PNG or JPG, max 2MB.</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Avatar user={{ id: profile.id, username: profile.username, display_name: profile.displayName, full_name: profile.displayName, avatar_url: profile.avatarUrl || null }} size={56} />
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button onClick={() => fileInputRef.current?.click()} disabled={uploadingAvatar} style={secondaryBtn}>{uploadingAvatar ? 'Uploading...' : 'Upload picture'}</button>
                    {profile.avatarUrl ? (
                      <button onClick={handleAvatarRemove} disabled={removingAvatar} style={dangerBtn}>{removingAvatar ? 'Removing...' : 'Remove picture'}</button>
                    ) : null}
                  </div>
                </div>
              </div>
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg" style={{ display: 'none' }} onChange={e => handleAvatarSelect(e.target.files?.[0])} />
              {avatarError && <div style={{ color: '#b91c1c', fontSize: 13 }}>{avatarError}</div>}
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              <label style={labelStyle}>Display name</label>
              <input value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder="How should we show your name?" style={inputStyle} />
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              <label style={labelStyle}>Email</label>
              <input value={profile.email || ''} readOnly style={{ ...inputStyle, background:'#f3f4f6' }} />
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              <label style={labelStyle}>Roles</label>
              <input value={profile.roles.join(', ') || '—'} readOnly style={{ ...inputStyle, background:'#f3f4f6' }} />
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              <label style={labelStyle}>Preferred timezone (optional)</label>
              <input value={timezonePref} onChange={e=>setTimezonePref(e.target.value)} placeholder={profile.timezone || 'Inherit global timezone'} style={inputStyle} />
              <p style={{ margin: 0, color: '#6b7280', fontSize: 12 }}>We will display timestamps using this timezone when available.</p>
            </div>
            <div>
              <button onClick={handleSaveProfile} disabled={savingProfile} style={primaryBtn}>{savingProfile ? 'Saving...' : 'Save changes'}</button>
            </div>
          </div>
        ) : (
          <div className="surface-card" style={{ padding: 16, display: 'grid', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontWeight: 600 }}>Last login</div>
              <div style={{ color: '#374151' }}>{formatDisplayTime(lastLogin)}</div>
            </div>

            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ fontWeight: 600 }}>Change password</div>
              <input type="password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} placeholder="Current password" style={inputStyle} />
              <input type="password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} placeholder="New password" style={inputStyle} />
              <input type="password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} placeholder="Confirm new password" style={inputStyle} />
              <p style={{ margin: 0, color: '#6b7280', fontSize: 12 }}>Use at least 8 characters, including letters and numbers.</p>
              <button onClick={handleChangePassword} disabled={savingPassword} style={primaryBtn}>{savingPassword ? 'Updating...' : 'Change password'}</button>
            </div>

            <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Sessions</div>
              <p style={{ margin: '0 0 8px 0', color: '#6b7280' }}>If you suspect unwanted access, log out other devices. Your current session will stay signed in with a fresh token.</p>
              <div style={{ display: 'grid', gap: 6 }}>
                {sessions.map(s => (
                  <div key={s.id} style={{ padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#f9fafb' }}>
                    <div style={{ fontWeight: 600 }}>{s.label}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>{s.current ? 'Current session' : 'Other session'} · Last active {formatDisplayTime(s.lastActive)}</div>
                  </div>
                ))}
                {sessions.length === 0 && (
                  <div style={{ color: '#6b7280' }}>No sessions to show.</div>
                )}
              </div>
              <div style={{ marginTop: 10 }}>
                <button onClick={handleLogoutOthers} disabled={savingSessions} style={dangerBtn}>{savingSessions ? 'Applying...' : 'Log out other sessions'}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = { border: '1px solid #d1d5db', borderRadius: 8, padding: '10px 12px', fontSize: 14 }
const labelStyle: React.CSSProperties = { fontWeight: 600, color: '#374151' }
const primaryBtn: React.CSSProperties = { background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 14px', fontWeight: 700, cursor: 'pointer' }
const secondaryBtn: React.CSSProperties = { background: '#fff', color: '#111827', border: '1px solid #d1d5db', borderRadius: 8, padding: '10px 14px', fontWeight: 700, cursor: 'pointer' }
const dangerBtn: React.CSSProperties = { background: '#b91c1c', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 14px', fontWeight: 700, cursor: 'pointer' }
