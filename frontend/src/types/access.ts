export type ArtifactKey =
  | 'dashboard'
  | 'processes'
  | 'packages'
  | 'assets'
  | 'jobs'
  | 'robots'
  | 'queues'
  | 'queue_items'
  | 'users'
  | 'roles'

export interface RolePermission {
  id?: number
  artifact: ArtifactKey
  canView: boolean
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
}

export interface Role {
  id: number
  name: string
  description?: string | null
  permissions: RolePermission[]
  createdAt: string
  updatedAt: string
}

export interface UserSummary {
  id: number
  username: string
  email?: string | null
  isActive: boolean
  status: 'active' | 'disabled' | 'locked'
  lockedUntil?: string | null
  roles?: string[]
  lastLogin?: string | null
}

export interface UserRoles {
  user: UserSummary
  roles: Role[]
}

export interface UserInvite {
  id: number
  email: string
  status: 'pending' | 'accepted' | 'expired' | 'revoked'
  invitedBy: string | null
  expiresAt: string | null
  createdAt: string
}
