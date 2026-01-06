import type { Queue } from '../types/queue'
import { toCamel } from './utils'

function authHeaders() {
  const token = localStorage.getItem('token') || ''
  return { Authorization: `Bearer ${token}` }
}

function toClient(q: any): Queue {
  const externalCandidate = q?.external_id ?? q?.id
  const externalId = externalCandidate ? String(externalCandidate) : ''
  if (!externalId || /^\d+$/.test(externalId)) {
    throw new Error('Queue external_id missing or invalid (must be GUID)')
  }
  return {
    internalId: q?._internal_id ?? q?.id ?? null,
    externalId,
    name: q.name,
    description: q.description ?? null,
    maxRetries: q.max_retries ?? 0,
    enforceUniqueReference: q.enforce_unique_reference ?? false,
    createdAt: q.created_at,
    updatedAt: q.updated_at,
  }
}

export async function fetchQueues(params?: { search?: string; activeOnly?: boolean }): Promise<Queue[]> {
  const url = new URL('/api/queues/', window.location.origin)
  if (params?.search) url.searchParams.set('search', params.search)
  // activeOnly parameter kept for backward compatibility but not used
  const res = await fetch(url.toString(), { headers: authHeaders() })
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  return data.map(toClient)
}

export async function createQueue(payload: { name: string; description?: string; maxRetries?: number; enforceUniqueReference?: boolean }): Promise<Queue> {
  const body = {
    name: payload.name,
    description: payload.description ?? null,
    max_retries: payload.maxRetries ?? 0,
    enforce_unique_reference: payload.enforceUniqueReference ?? false,
  }
  const res = await fetch('/api/queues/', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(await res.text())
  return toClient(await res.json())
}

export async function updateQueue(externalId: string, payload: Partial<{ description: string; maxRetries: number }>): Promise<Queue> {
  const body: any = {}
  if (payload.description !== undefined) body.description = payload.description
  if (payload.maxRetries !== undefined) body.max_retries = payload.maxRetries
  if (!externalId || /^\d+$/.test(externalId)) {
    throw new Error('Queue external_id missing or invalid (must be GUID)')
  }
  const res = await fetch(`/api/queues/${externalId}`, { method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(await res.text())
  return toClient(await res.json())
}

export async function fetchQueueStats(externalId: string): Promise<{
  inProgress: number;
  remaining: number;
  avgProcessingTime: number;
  successful: number;
  appExceptions: number;
  bizExceptions: number;
}> {
  if (!externalId || /^\d+$/.test(externalId)) {
    throw new Error('Queue external_id missing or invalid (must be GUID)')
  }
  const res = await fetch(`/api/queues/${externalId}/stats`, { headers: authHeaders() })
  if (!res.ok) throw new Error(await res.text())
  return toCamel(await res.json())
}

export async function deleteQueue(externalId: string): Promise<void> {
  if (!externalId || /^\d+$/.test(externalId)) {
    throw new Error('Queue external_id missing or invalid (must be GUID)')
  }
  const res = await fetch(`/api/queues/${externalId}`, { method: 'DELETE', headers: authHeaders() })
  if (!res.ok) throw new Error(await res.text())
}
