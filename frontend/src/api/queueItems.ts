import type { QueueItem, QueueItemStatus } from '../types/queueItem'

function authHeaders() {
  const token = localStorage.getItem('token') || ''
  return { Authorization: `Bearer ${token}` }
}

function jsonOrNull(s: any): any {
  if (s == null) return null
  if (typeof s === 'string') {
    try { return JSON.parse(s) } catch { return null }
  }
  return s
}

function toClient(q: any): QueueItem {
  return {
    id: q.id,
    queueId: q.queue_id,
    reference: q.reference ?? null,
    status: q.status,
    priority: q.priority ?? 0,
    payload: jsonOrNull(q.payload),
    result: jsonOrNull(q.result),
    errorMessage: q.error_message ?? null,
    retries: q.retries ?? 0,
    lockedByRobotId: q.locked_by_robot_id ?? null,
    lockedAt: q.locked_at ?? null,
    createdAt: q.created_at,
    updatedAt: q.updated_at,
    queue: undefined,
  }
}

export async function fetchQueueItems(params?: { queueId?: number; status?: QueueItemStatus }): Promise<QueueItem[]> {
  const url = new URL('/api/queue-items/', window.location.origin)
  if (params?.queueId) url.searchParams.set('queue_id', String(params.queueId))
  if (params?.status) url.searchParams.set('status', params.status)
  const res = await fetch(url.toString(), { headers: authHeaders() })
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  return data.map(toClient)
}

export async function fetchQueueItem(id: string): Promise<QueueItem> {
  const res = await fetch(`/api/queue-items/${id}`, { headers: authHeaders() })
  if (!res.ok) throw new Error(await res.text())
  return toClient(await res.json())
}

export async function createQueueItem(payload: { queueId: number; reference?: string; priority?: number; payload?: Record<string, unknown> }): Promise<QueueItem> {
  const body: any = {
    queue_id: payload.queueId,
    reference: payload.reference ?? null,
    priority: payload.priority ?? 0,
    payload: payload.payload ?? null,
  }
  const res = await fetch('/api/queue-items/', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(await res.text())
  return toClient(await res.json())
}

export async function updateQueueItem(id: string, payload: Partial<{ status: QueueItemStatus; result: Record<string, unknown> | null; errorMessage: string | null }>): Promise<QueueItem> {
  const body: any = {}
  if (payload.status !== undefined) body.status = payload.status
  if (payload.result !== undefined) body.result = payload.result
  if (payload.errorMessage !== undefined) body.error_message = payload.errorMessage
  const res = await fetch(`/api/queue-items/${id}`, { method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(await res.text())
  return toClient(await res.json())
}
