import type { Role, RolePermission, UserRoles, UserSummary } from '../types/access'

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
  return {
    id: u.id,
    username: u.username,
    email: u.email ?? null,
    isActive: u.is_active ?? true,
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
