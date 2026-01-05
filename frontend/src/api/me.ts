import type { MyProfile, SessionList } from '../types/me'

type HeadersInit = Record<string, string>

function authHeaders(explicitToken?: string): HeadersInit {
  const token = explicitToken || localStorage.getItem('token') || ''
  const headers: HeadersInit = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}

function toProfile(raw: any): MyProfile {
  return {
    id: raw.id,
    username: raw.username,
    email: raw.email ?? null,
    displayName: raw.display_name ?? raw.full_name ?? null,
    isAdmin: !!raw.is_admin,
    status: (raw.status || 'active') as MyProfile['status'],
    lockedUntil: raw.locked_until ?? null,
    lastLogin: raw.last_login ?? null,
    preferences: raw.preferences || {},
    roles: Array.isArray(raw.roles) ? raw.roles : [],
    tokenVersion: Number(raw.token_version ?? raw.tokenVersion ?? 1),
    timezone: raw.timezone ?? null,
  }
}

export async function fetchAuthMe(token?: string): Promise<any> {
  const res = await fetch('/api/auth/me', { headers: authHeaders(token) })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function fetchMyProfile(): Promise<MyProfile> {
  const res = await fetch('/api/me', { headers: authHeaders() })
  if (!res.ok) throw new Error(await res.text())
  return toProfile(await res.json())
}

export async function updateMyProfile(payload: { displayName?: string; preferences?: Record<string, any> }): Promise<MyProfile> {
  const body: any = {}
  if (payload.displayName !== undefined) body.display_name = payload.displayName
  if (payload.preferences !== undefined) body.preferences = payload.preferences
  const res = await fetch('/api/me', { method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(await res.text())
  return toProfile(await res.json())
}

export async function changeMyPassword(payload: { currentPassword: string; newPassword: string }): Promise<{ accessToken: string; tokenVersion: number }> {
  const body = { current_password: payload.currentPassword, new_password: payload.newPassword }
  const res = await fetch('/api/me/change-password', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  return { accessToken: data.access_token, tokenVersion: Number(data.token_version ?? data.tokenVersion ?? 1) }
}

export async function listMySessions(): Promise<SessionList> {
  const res = await fetch('/api/me/sessions', { headers: authHeaders() })
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  return {
    tokenVersion: Number(data.token_version ?? data.tokenVersion ?? 1),
    lastLogin: data.last_login ?? null,
    sessions: Array.isArray(data.sessions) ? data.sessions.map((s: any) => ({
      id: s.id,
      label: s.label ?? s.id,
      current: !!s.current,
      lastActive: s.last_active ?? s.lastActive ?? null,
    })) : [],
  }
}

export async function logoutOtherSessions(): Promise<{ accessToken: string; tokenVersion: number }> {
  const res = await fetch('/api/me/logout-others', { method: 'POST', headers: authHeaders() })
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  return { accessToken: data.access_token, tokenVersion: Number(data.token_version ?? data.tokenVersion ?? 1) }
}
