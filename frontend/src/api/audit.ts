import type { AuditListResponse, AuditItem, AuditDetail } from '../types/audit'

function authHeaders() {
  const token = localStorage.getItem('token') || ''
  return { Authorization: `Bearer ${token}` }
}

function toItem(raw: any): AuditItem {
  return {
    id: raw.id,
    timestamp: raw.timestamp,
    actorUsername: raw.actor_username ?? null,
    action: raw.action,
    actionType: raw.action_type ?? undefined,
    entityType: raw.entity_type ?? null,
    entityDisplay: raw.entity_display ?? undefined,
    entityId: raw.entity_id ?? null,
    entityName: raw.entity_name ?? null,
    message: raw.message ?? undefined,
    summary: raw.summary ?? null,
  }
}

export async function fetchAudit(params?: {
  // New structured filters
  fromTime?: string
  toTime?: string
  actionType?: string
  user?: string
  search?: string
  entityType?: string
  entityId?: string
  // Legacy filters (still supported by backend)
  from?: string
  to?: string
  userId?: number
  username?: string
  action?: string
  q?: string
  page?: number
  pageSize?: number
}): Promise<{ items: AuditItem[]; total: number; page: number; pageSize: number }>{
  const url = new URL('/api/audit', window.location.origin)
  // New structured params
  if (params?.fromTime) url.searchParams.set('from_time', params.fromTime)
  if (params?.toTime) url.searchParams.set('to_time', params.toTime)
  if (params?.actionType) url.searchParams.set('action_type', params.actionType)
  if (params?.user) url.searchParams.set('user', params.user)
  if (params?.search) url.searchParams.set('search', params.search)
  if (params?.entityType) url.searchParams.set('entity_type', params.entityType)
  if (params?.entityId) url.searchParams.set('entity_id', params.entityId)
  // Legacy params (kept for compatibility)
  if (params?.from) url.searchParams.set('from', params.from)
  if (params?.to) url.searchParams.set('to', params.to)
  if (params?.userId != null) url.searchParams.set('user_id', String(params.userId))
  if (params?.username) url.searchParams.set('username', params.username)
  if (params?.action) url.searchParams.set('action', params.action)
  if (params?.q) url.searchParams.set('q', params.q)
  if (params?.page) url.searchParams.set('page', String(params.page))
  if (params?.pageSize) url.searchParams.set('page_size', String(params.pageSize))
  const res = await fetch(url.toString(), { headers: authHeaders() })
  if (!res.ok) throw new Error(await res.text())
  const data: AuditListResponse = await res.json()
  return {
    items: (data.items || []).map(toItem),
    total: data.total,
    page: data.page,
    pageSize: (data as any).page_size ?? params?.pageSize ?? 50,
  }
}

export async function fetchAuditDetail(id: number): Promise<AuditDetail> {
  const res = await fetch(`/api/audit/${id}`, { headers: authHeaders() })
  if (!res.ok) throw new Error(await res.text())
  const raw = await res.json()
  return {
    id: raw.id,
    timestamp: raw.timestamp,
    actorUsername: raw.actor_username ?? null,
    actorUserId: raw.actor_user_id ?? null,
    ipAddress: raw.ip_address ?? null,
    userAgent: raw.user_agent ?? null,
    action: raw.action,
    entityType: raw.entity_type ?? null,
    entityId: raw.entity_id ?? null,
    entityName: raw.entity_name ?? null,
    beforeData: raw.before_data ? safeJson(raw.before_data) : null,
    afterData: raw.after_data ? safeJson(raw.after_data) : null,
    metadata: raw.metadata ? safeJson(raw.metadata) : null,
    summary: null,
  }
}

function safeJson(s: any) {
  if (typeof s !== 'string') return s
  try { return JSON.parse(s) } catch { return s }
}
