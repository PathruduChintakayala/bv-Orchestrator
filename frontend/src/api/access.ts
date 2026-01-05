import type { Role, RolePermission, UserInvite, UserRoles, UserSummary } from '../types/access'

function authHeaders() {
  const token = localStorage.getItem('token') || ''
  return { Authorization: `Bearer ${token}` }
}

function toRolePermission(p: any): RolePermission {
  return {
    id: p.id,
    artifact: p.artifact,
    canView: !!p.can_view,
    canCreate: !!p.can_create,
    canEdit: !!p.can_edit,
    canDelete: !!p.can_delete,
  }
}

function toRole(r: any): Role {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    permissions: (r.permissions || []).map(toRolePermission),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export async function fetchRoles(): Promise<Role[]> {
  const res = await fetch('/api/access/roles', { headers: authHeaders() })
  if (!res.ok) throw new Error(await res.text())
  return (await res.json()).map(toRole)
}

export async function createRole(payload: { name: string; description?: string; permissions: RolePermission[] }): Promise<Role> {
  const body = {
    name: payload.name,
    description: payload.description ?? null,
    permissions: payload.permissions.map(p => ({
      artifact: p.artifact,
      can_view: !!p.canView,
      can_create: !!p.canCreate,
      can_edit: !!p.canEdit,
      can_delete: !!p.canDelete,
    })),
  }
  const res = await fetch('/api/access/roles', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(await res.text())
  return toRole(await res.json())
}

export async function updateRole(id: number, payload: { name?: string; description?: string; permissions?: RolePermission[] }): Promise<Role> {
  const body: any = {}
  if (payload.name !== undefined) body.name = payload.name
  if (payload.description !== undefined) body.description = payload.description
  if (payload.permissions !== undefined) body.permissions = payload.permissions.map(p => ({
    artifact: p.artifact,
    can_view: !!p.canView,
    can_create: !!p.canCreate,
    can_edit: !!p.canEdit,
    can_delete: !!p.canDelete,
  }))
  const res = await fetch(`/api/access/roles/${id}`, { method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(await res.text())
  return toRole(await res.json())
}

export async function deleteRole(id: number): Promise<void> {
  const res = await fetch(`/api/access/roles/${id}`, { method: 'DELETE', headers: authHeaders() })
  if (!res.ok) throw new Error(await res.text())
}

function toUserSummary(u: any): UserSummary {
  const statusRaw = typeof u.status === 'string' ? (u.status as string).toLowerCase() : ''
  let status: UserSummary['status'] = 'active'
  if (statusRaw === 'disabled') status = 'disabled'
  else if (statusRaw === 'locked') status = 'locked'
  else if (statusRaw === 'active') status = 'active'
  else if (u.is_active === false) status = 'disabled'
  else if (u.locked_until) status = 'locked'
  return {
    id: u.id,
    username: u.username,
    email: u.email ?? null,
    isActive: u.is_active ?? status !== 'disabled',
    status,
    lockedUntil: u.locked_until ?? null,
    roles: Array.isArray(u.roles) ? u.roles.map((r: any) => String(r)) : [],
    lastLogin: u.last_login ?? null,
  }
}

function toInvite(i: any): UserInvite {
  return {
    id: i.id,
    email: i.email,
    status: ((i.status || 'pending') as string).toLowerCase() as UserInvite['status'],
    invitedBy: i.invited_by ?? null,
    expiresAt: i.expires_at ?? null,
    createdAt: i.created_at,
  }
}

export async function fetchUsers(): Promise<UserSummary[]> {
  const res = await fetch('/api/access/users', { headers: authHeaders() })
  if (!res.ok) throw new Error(await res.text())
  return (await res.json()).map(toUserSummary)
}

export async function fetchUserRoles(userId: number): Promise<UserRoles> {
  const res = await fetch(`/api/access/users/${userId}/roles`, { headers: authHeaders() })
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  return { user: toUserSummary(data.user), roles: (data.roles || []).map(toRole) }
}

export async function assignUserRoles(userId: number, roleIds: number[]): Promise<UserRoles> {
  const body = { role_ids: roleIds }
  const res = await fetch(`/api/access/users/${userId}/roles`, { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  return { user: toUserSummary(data.user), roles: (data.roles || []).map(toRole) }
}

export async function disableUser(userId: number): Promise<UserSummary> {
  const res = await fetch(`/api/access/users/${userId}/disable`, { method: 'POST', headers: authHeaders() })
  if (!res.ok) throw new Error(await res.text())
  return toUserSummary(await res.json())
}

export async function enableUser(userId: number): Promise<UserSummary> {
  const res = await fetch(`/api/access/users/${userId}/enable`, { method: 'POST', headers: authHeaders() })
  if (!res.ok) throw new Error(await res.text())
  return toUserSummary(await res.json())
}

export async function adminPasswordReset(userId: number): Promise<void> {
  const res = await fetch(`/api/access/users/${userId}/password-reset`, { method: 'POST', headers: authHeaders() })
  if (!res.ok) throw new Error(await res.text())
}

export async function fetchInvites(): Promise<UserInvite[]> {
  const res = await fetch('/api/users/invites', { headers: authHeaders() })
  if (!res.ok) throw new Error(await res.text())
  return (await res.json()).map(toInvite)
}

export async function sendInvite(payload: { email: string; roleIds?: number[] }): Promise<UserInvite> {
  const body: any = { email: payload.email }
  if (payload.roleIds?.length) body.role_ids = payload.roleIds
  const res = await fetch('/api/users/invite', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(await res.text())
  return toInvite(await res.json())
}

export async function resendInvite(inviteId: number): Promise<UserInvite> {
  const res = await fetch(`/api/users/invite/${inviteId}/resend`, { method: 'POST', headers: authHeaders() })
  if (!res.ok) throw new Error(await res.text())
  return toInvite(await res.json())
}

export async function revokeInvite(inviteId: number): Promise<void> {
  const res = await fetch(`/api/users/invite/${inviteId}`, { method: 'DELETE', headers: authHeaders() })
  if (!res.ok) throw new Error(await res.text())
}
