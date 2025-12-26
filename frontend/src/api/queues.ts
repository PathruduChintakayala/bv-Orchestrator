import type { Queue } from '../types/queue'

function authHeaders() {
  const token = localStorage.getItem('token') || ''
  return { Authorization: `Bearer ${token}` }
}

function toClient(q: any): Queue {
  return {
    id: q.id,
    name: q.name,
    description: q.description ?? null,
    isActive: !!q.is_active,
    maxRetries: q.max_retries ?? 0,
    createdAt: q.created_at,
    updatedAt: q.updated_at,
  }
}

export async function fetchQueues(params?: { search?: string; activeOnly?: boolean }): Promise<Queue[]> {
  const url = new URL('/api/queues/', window.location.origin)
  if (params?.search) url.searchParams.set('search', params.search)
  if (params?.activeOnly) url.searchParams.set('active_only', 'true')
  const res = await fetch(url.toString(), { headers: authHeaders() })
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  return data.map(toClient)
}

export async function createQueue(payload: { name: string; description?: string; maxRetries?: number; isActive?: boolean }): Promise<Queue> {
  const body = {
    name: payload.name,
    description: payload.description ?? null,
    max_retries: payload.maxRetries ?? 0,
    is_active: payload.isActive ?? true,
  }
  const res = await fetch('/api/queues/', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(await res.text())
  return toClient(await res.json())
}

export async function updateQueue(id: number, payload: Partial<{ description: string; maxRetries: number; isActive: boolean }>): Promise<Queue> {
  const body: any = {}
  if (payload.description !== undefined) body.description = payload.description
  if (payload.maxRetries !== undefined) body.max_retries = payload.maxRetries
  if (payload.isActive !== undefined) body.is_active = payload.isActive
  const res = await fetch(`/api/queues/${id}`, { method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(await res.text())
  return toClient(await res.json())
}

export async function deleteQueue(id: number): Promise<void> {
  const res = await fetch(`/api/queues/${id}`, { method: 'DELETE', headers: authHeaders() })
  if (!res.ok) throw new Error(await res.text())
}
