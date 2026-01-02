/**
 * Shared utilities for process and job type labels
 */

export function getProcessTypeLabel(isBvpackage: boolean): string {
  return isBvpackage ? 'RPA' : 'Agent'
}

export function getProcessTypeTone(isBvpackage: boolean): 'blue' | 'slate' {
  return isBvpackage ? 'blue' : 'slate'
}