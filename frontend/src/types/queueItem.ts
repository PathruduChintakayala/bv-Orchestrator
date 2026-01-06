import type { Queue } from './queue'

export type QueueItemStatus = 'new' | 'in_progress' | 'completed' | 'failed' | 'deleted'

export const queueItemPriorityLabels: Record<number, string> = {
  0: 'Low',
  1: 'Normal',
  2: 'Medium',
  3: 'High'
}

export function formatQueueItemPriority(priority: number): string {
  return queueItemPriorityLabels[priority] ?? `Priority ${priority}`
}

export interface QueueItem {
  id: string
  queueId: number
  reference?: string | null
  status: QueueItemStatus
  priority: number
  payload?: Record<string, unknown> | null
  result?: Record<string, unknown> | null
  errorMessage?: string | null
  retries: number
  lockedByRobotId?: number | null
  lockedAt?: string | null
  createdAt: string
  updatedAt: string
  queue?: Queue | null
}
