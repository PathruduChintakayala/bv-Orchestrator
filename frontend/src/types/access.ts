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
}

export interface UserRoles {
  user: UserSummary
  roles: Role[]
}
