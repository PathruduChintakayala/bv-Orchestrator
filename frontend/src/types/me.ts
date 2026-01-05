export interface MyProfile {
  id: number
  username: string
  email?: string | null
  displayName?: string | null
  isAdmin: boolean
  status: 'active' | 'disabled' | 'locked'
  lockedUntil?: string | null
  lastLogin?: string | null
  preferences: Record<string, any>
  roles: string[]
  tokenVersion: number
  timezone?: string | null
  avatarUrl?: string | null
  avatarUpdatedAt?: string | null
}

export interface SessionInfo {
  id: string
  label: string
  current: boolean
  lastActive?: string | null
}

export interface SessionList {
  tokenVersion: number
  lastLogin?: string | null
  sessions: SessionInfo[]
}
