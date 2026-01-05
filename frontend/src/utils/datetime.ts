export function formatDisplayTime(value?: string | null): string {
  if (!value) return '—'
  // Avoid timezone re-conversion; show the server-provided offset plainly.
  const cleaned = value.replace('T', ' ').replace('Z', ' UTC')
  return cleaned
}
