import React from 'react'

type AvatarUser = {
  id?: number | string | null
  username: string
  display_name?: string | null
  full_name?: string | null
  avatar_url?: string | null
}

const palette = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316', '#0ea5e9', '#22c55e', '#e11d48']

function hashToIndex(seed: string): number {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash) % palette.length
}

function initialFrom(user: AvatarUser): string {
  const display = (user.display_name || user.full_name || '').trim()
  if (display) return display[0].toUpperCase()
  return (user.username || 'U')[0].toUpperCase()
}

export function Avatar({ user, size = 36 }: { user: AvatarUser; size?: number }) {
  const [imageError, setImageError] = React.useState(false)
  const letter = initialFrom(user)
  const seed = `${user.id ?? ''}:${user.username}` || letter
  const bg = palette[hashToIndex(seed)]
  const dimension = `${size}px`
  const showImage = !!user.avatar_url && !imageError

  return (
    <div aria-label={`Avatar for ${user.username}`} style={{ width: dimension, height: dimension }}>
      {showImage ? (
        <img
          src={user.avatar_url || undefined}
          alt={`Avatar for ${user.username}`}
          width={size}
          height={size}
          onError={() => setImageError(true)}
          style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover', display: 'block', background: bg }}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: '50%',
            background: bg,
            color: '#ffffff',
            display: 'grid',
            placeItems: 'center',
            fontWeight: 700,
            fontSize: size >= 32 ? 16 : 14,
            userSelect: 'none',
          }}
        >
          {letter}
        </div>
      )}
    </div>
  )
}
