/**
 * Shared utilities for process and job type labels
 */

export type ProcessType = 'rpa' | 'agent' | string | undefined | null

export function getProcessTypeLabel(type: ProcessType): string {
  const t = (type || '').toString().toLowerCase()
  if (t === 'agent') return 'AGENT'
  return 'RPA'
}

export function getProcessTypeTone(type: ProcessType): 'blue' | 'slate' {
  const t = (type || '').toString().toLowerCase()
  return t === 'agent' ? 'slate' : 'blue'
}