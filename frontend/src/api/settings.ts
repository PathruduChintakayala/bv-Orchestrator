import { toCamel } from './utils'

function authHeaders() {
  const token = localStorage.getItem('token') || ''
  return { Authorization: `Bearer ${token}` }
}

export type GeneralSettings = {
  timezone: string
}

const defaultGeneral: GeneralSettings = { timezone: 'UTC' }

function normalizeGeneralSettings(input: Partial<GeneralSettings> | null | undefined): GeneralSettings {
  const tz = typeof input?.timezone === 'string' && input.timezone.trim() ? input.timezone.trim() : defaultGeneral.timezone
  return { timezone: tz }
}

export type EmailSettings = {
  enabled: boolean
  smtpHost: string
  smtpPort: number | null
  smtpUsername: string
  smtpPassword?: string
  smtpPasswordSet?: boolean
  smtpUseTls: boolean
  smtpUseSsl: boolean
  fromAddress: string
}

export const defaultEmailSettings: EmailSettings = {
  enabled: false,
  smtpHost: '',
  smtpPort: null,
  smtpUsername: '',
  smtpPassword: '',
  smtpPasswordSet: false,
  smtpUseTls: false,
  smtpUseSsl: false,
  fromAddress: '',
}

export async function fetchGeneralSettings(): Promise<GeneralSettings> {
  const res = await fetch('/api/settings/general', { headers: authHeaders() })
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  const parsed = toCamel(data)
  return normalizeGeneralSettings(parsed)
}

export async function updateGeneralSettings(payload: Partial<GeneralSettings>): Promise<GeneralSettings> {
  const body = { ...(payload.timezone ? { timezone: payload.timezone } : {}) }
  const res = await fetch('/api/settings/general', {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  const parsed = toCamel(data)
  return normalizeGeneralSettings(parsed)
}

export async function fetchEmailSettings(): Promise<EmailSettings> {
  const res = await fetch('/api/settings/email', { headers: authHeaders() })
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  const parsed = toCamel(data)
  return { ...defaultEmailSettings, ...parsed }
}

export async function updateEmailSettings(payload: Partial<EmailSettings>): Promise<EmailSettings> {
  const body: Record<string, any> = {
    enabled: payload.enabled ?? defaultEmailSettings.enabled,
    smtpHost: payload.smtpHost ?? defaultEmailSettings.smtpHost,
    smtpPort: payload.smtpPort ?? null,
    smtpUsername: payload.smtpUsername ?? defaultEmailSettings.smtpUsername,
    smtpUseTls: payload.smtpUseTls ?? defaultEmailSettings.smtpUseTls,
    smtpUseSsl: payload.smtpUseSsl ?? defaultEmailSettings.smtpUseSsl,
    fromAddress: payload.fromAddress ?? defaultEmailSettings.fromAddress,
  }
  if (payload.smtpPassword !== undefined) {
    body.smtpPassword = payload.smtpPassword
  }
  const res = await fetch('/api/settings/email', {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  const parsed = toCamel(data)
  return { ...defaultEmailSettings, ...parsed }
}

export async function testEmailSettings(to?: string): Promise<{ status: string }> {
  const res = await fetch('/api/settings/email/test', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ to }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}
