import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth'
import type { ArtifactKey, Role, RolePermission, UserInvite, UserSummary } from '../types/access'
import { fetchRoles, createRole, updateRole, deleteRole, fetchUsers, assignUserRoles, fetchUserRoles, fetchInvites, sendInvite, resendInvite, revokeInvite, disableUser, enableUser, adminPasswordReset } from '../api/access'
import { formatDisplayTime } from '../utils/datetime'

const ARTIFACTS: ArtifactKey[] = ['dashboard', 'processes', 'packages', 'assets', 'jobs', 'robots', 'queues', 'queue_items', 'users', 'roles']

type AccessTab = 'roles' | 'users'

function tabFromHash(hash: string): AccessTab {
  if (hash.startsWith('#/access/users') || hash.startsWith('#/access/invites')) return 'users'
  return 'roles'
}

export default function ManageAccessPage() {
  const { user, permissions } = useAuth()
  const [activeTab, setActiveTab] = useState<AccessTab>(() => tabFromHash(window.location.hash || '#/manage-access'))

  useEffect(() => {
    const onHash = () => {
      const next = tabFromHash(window.location.hash || '')
      setActiveTab(next)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  function goTab(tab: AccessTab) {
    if (tab === 'roles') window.location.hash = '#/manage-access'
    if (tab === 'users') window.location.hash = '#/access/users'
    setActiveTab(tab)
  }
  return (
    <div style={{ padding: 16 }}>
      <div className="page-shell" style={{ gap: 12 }}>
        <div className="surface-card" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h1 className="page-title" style={{ margin: 0 }}>Manage Access</h1>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => goTab('roles')} style={activeTab === 'roles' ? primaryBtn : secondaryBtn}>Roles</button>
            <button onClick={() => goTab('users')} style={activeTab === 'users' ? primaryBtn : secondaryBtn}>Users</button>
          </div>
        </div>
        {activeTab === 'roles' ? <RolesTab /> : (
          <UsersTab
            canInvite={!!(user?.is_admin || permissions['users:invite'] || permissions['users:create'])}
            canManageUsers={!!(user?.is_admin || permissions['users:edit'])}
          />
        )}
      </div>
    </div>
  )
}

function RolesTab() {
  const [items, setItems] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Role | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    try { setLoading(true); setError(null); const data = await fetchRoles(); setItems(data) }
    catch (e: any) { setError(e.message || 'Failed to load roles') }
    finally { setLoading(false) }
  }

  function openNew() { setEditing(null); setModalOpen(true) }
  function openEdit(r: Role) { setEditing(r); setModalOpen(true) }
  function closeModal() { setModalOpen(false); setEditing(null) }

  async function handleSave(values: RoleFormValues) {
    try {
      if (editing) {
        await updateRole(editing.id, { name: values.name, description: values.description, permissions: values.permissions })
      } else {
        await createRole({ name: values.name, description: values.description, permissions: values.permissions })
      }
      closeModal(); await load()
    } catch (e: any) { alert(e.message || 'Save failed') }
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this role?')) return
    try { await deleteRole(id); await load() } catch (e: any) { alert(e.message || 'Delete failed') }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button onClick={openNew} style={primaryBtn}>New Role</button>
      </div>
      <div style={{ backgroundColor: '#fff', borderRadius: 12, boxShadow: '0 10px 24px rgba(15,23,42,0.08)', padding: 16 }}>
        {loading ? <p>Loading...</p> : error ? <p style={{ color: '#b91c1c' }}>{error}</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', fontSize: 12, color: '#6b7280' }}>
                <th style={{ paddingBottom: 8 }}>Name</th>
                <th style={{ paddingBottom: 8 }}>Description</th>
                <th style={{ paddingBottom: 8 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(r => (
                <tr key={r.id} style={{ fontSize: 14, color: '#111827' }}>
                  <td style={{ padding: '6px 0' }}>{r.name}</td>
                  <td style={{ padding: '6px 0' }}>{r.description ?? '-'}</td>
                  <td style={{ padding: '6px 0' }}>
                    <button style={secondaryBtn} onClick={() => openEdit(r)}>Edit</button>{' '}
                    <button style={dangerBtn} onClick={() => handleDelete(r.id)}>Delete</button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={3} style={{ paddingTop: 12, color: '#6b7280' }}>No roles found</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      {modalOpen && (
        <RoleModal initial={editing} onCancel={closeModal} onSave={handleSave} />
      )}
    </div>
  )
}

function RoleModal({ initial, onCancel, onSave }: { initial: Role | null; onCancel: () => void; onSave: (v: RoleFormValues) => void }) {
  const initPerms: RolePermission[] = useMemo(() => {
    const map: Record<ArtifactKey, RolePermission> = {} as any
    ARTIFACTS.forEach(a => {
      const existing = initial?.permissions.find(p => p.artifact === a)
      map[a] = {
        id: existing?.id,
        artifact: a,
        canView: !!existing?.canView,
        canCreate: !!existing?.canCreate,
        canEdit: !!existing?.canEdit,
        canDelete: !!existing?.canDelete,
      }
    })
    return Object.values(map)
  }, [initial])

  const [form, setForm] = useState<RoleFormValues>({ name: initial?.name || '', description: initial?.description || '', permissions: initPerms })
  const [saving, setSaving] = useState(false)

  function toggle(artifact: ArtifactKey, key: keyof Omit<RolePermission, 'id' | 'artifact'>) {
    setForm(prev => ({
      ...prev,
      permissions: prev.permissions.map(p => p.artifact === artifact ? { ...p, [key]: !p[key] } as RolePermission : p)
    }))
  }

  async function submit() {
    if (!initial && !form.name.trim()) { alert('Name is required'); return }
    try { setSaving(true); await onSave(form) } finally { setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center' }}>
      <div style={{ width: '100%', maxWidth: 900, background: '#fff', borderRadius: 16, boxShadow: '0 4px 16px rgba(0,0,0,0.15)', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 12 }}>{initial ? 'Edit Role' : 'New Role'}</h2>
        <div style={{ display: 'grid', gap: 10 }}>
          <label>
            <div style={label}>Role Name</div>
            <input name='name' value={form.name} onChange={e => setForm(f => ({ ...f, name: (e.target as any).value }))} style={input} />
          </label>
          <label>
            <div style={label}>Description</div>
            <input name='description' value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: (e.target as any).value }))} style={input} />
          </label>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Permissions</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', fontSize: 12, color: '#6b7280' }}>
                  <th style={{ paddingBottom: 8 }}>Artifact</th>
                  <th style={{ paddingBottom: 8 }}>View</th>
                  <th style={{ paddingBottom: 8 }}>Create</th>
                  <th style={{ paddingBottom: 8 }}>Edit</th>
                  <th style={{ paddingBottom: 8 }}>Delete</th>
                </tr>
              </thead>
              <tbody>
                {ARTIFACTS.map(a => {
                  const p = form.permissions.find(x => x.artifact === a) as RolePermission
                  const disableCreate = a === 'dashboard'
                  const disableEdit = a === 'dashboard'
                  const disableDelete = a === 'dashboard'
                  return (
                    <tr key={a} style={{ fontSize: 14 }}>
                      <td style={{ padding: '6px 0' }}>{a}</td>
                      <td style={{ padding: '6px 0' }}><input type='checkbox' checked={!!p?.canView} onChange={() => toggle(a, 'canView')} /></td>
                      <td style={{ padding: '6px 0' }}><input type='checkbox' disabled={disableCreate} checked={!!p?.canCreate} onChange={() => toggle(a, 'canCreate')} /></td>
                      <td style={{ padding: '6px 0' }}><input type='checkbox' disabled={disableEdit} checked={!!p?.canEdit} onChange={() => toggle(a, 'canEdit')} /></td>
                      <td style={{ padding: '6px 0' }}><input type='checkbox' disabled={disableDelete} checked={!!p?.canDelete} onChange={() => toggle(a, 'canDelete')} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button onClick={onCancel} style={secondaryBtn}>Cancel</button>
          <button onClick={submit} disabled={saving} style={primaryBtn}>{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

function UsersTab({ canInvite, canManageUsers }: { canInvite: boolean; canManageUsers: boolean }) {
  const [users, setUsers] = useState<UserSummary[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [selected, setSelected] = useState<UserSummary | null>(null)
  const [assigned, setAssigned] = useState<number[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [subTab, setSubTab] = useState<'users' | 'invites'>(() => (window.location.hash.startsWith('#/access/invites') ? 'invites' : 'users'))
  const [inviteModalOpen, setInviteModalOpen] = useState(false)
  const [invites, setInvites] = useState<UserInvite[]>([])
  const [invitesLoading, setInvitesLoading] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null)
  const [userActionMessage, setUserActionMessage] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  async function load(preferUserId?: number) {
    try {
      setLoading(true); setError(null)
      const [u, r] = await Promise.all([fetchUsers(), fetchRoles()])
      setUsers(u); setRoles(r)
      if (u.length) {
        const picked = preferUserId ? u.find(x => x.id === preferUserId) || u[0] : u[0]
        selectUser(picked)
      } else {
        setSelected(null)
        setAssigned([])
      }
    } catch (e: any) { setError(e.message || 'Failed to load data') }
    finally { setLoading(false) }
  }

  async function loadInvites() {
    try {
      setInvitesLoading(true); setInviteError(null)
      const data = await fetchInvites()
      setInvites(data)
    } catch (e: any) {
      setInviteError(e.message || 'Failed to load invites')
    } finally {
      setInvitesLoading(false)
    }
  }

  useEffect(() => {
    if (subTab === 'invites') loadInvites()
  }, [subTab])

  async function selectUser(u: UserSummary) {
    setUserActionMessage(null)
    setSelected(u)
    try {
      const ur = await fetchUserRoles(u.id)
      setAssigned(ur.roles.map(r => r.id))
    } catch { setAssigned([]) }
  }

  async function save() {
    if (!selected) return
    try { await assignUserRoles(selected.id, assigned); alert('Roles saved') }
    catch (e: any) { alert(e.message || 'Save failed') }
  }

  function toggleRole(id: number) {
    setAssigned(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function goSubTab(tab: 'users' | 'invites') {
    setSubTab(tab)
    window.location.hash = tab === 'users' ? '#/access/users' : '#/access/invites'
  }

  async function handleDisable() {
    if (!selected) return
    if (!confirm(`Disable ${selected.username}? They will be signed out and cannot log in.`)) return
    try {
      setUserActionMessage(null)
      await disableUser(selected.id)
      setUserActionMessage('User disabled')
      await load(selected.id)
    } catch (e: any) { alert(e.message || 'Failed to disable user') }
  }

  async function handleEnable() {
    if (!selected) return
    if (!confirm(`Enable ${selected.username}?`)) return
    try {
      setUserActionMessage(null)
      await enableUser(selected.id)
      setUserActionMessage('User enabled')
      await load(selected.id)
    } catch (e: any) { alert(e.message || 'Failed to enable user') }
  }

  async function handleAdminReset() {
    if (!selected) return
    if (!confirm(`Send a password reset link to ${selected.username}?`)) return
    try {
      setUserActionMessage(null)
      await adminPasswordReset(selected.id)
      setUserActionMessage('Reset link queued')
    } catch (e: any) { alert(e.message || 'Failed to send reset link') }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={() => goSubTab('users')} style={subTab === 'users' ? primaryBtn : secondaryBtn}>Users</button>
        {canInvite && <button onClick={() => goSubTab('invites')} style={subTab === 'invites' ? primaryBtn : secondaryBtn}>Invites</button>}
        {canInvite && subTab === 'users' && <button onClick={() => setInviteModalOpen(true)} style={{ ...primaryBtn, marginLeft: 'auto' }}>Invite User</button>}
      </div>

      {subTab === 'users' && userActionMessage && (
        <p style={{ color: '#065f46', margin: '0 0 4px 0' }}>{userActionMessage}</p>
      )}

      {subTab === 'users' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ backgroundColor: '#fff', borderRadius: 12, boxShadow: '0 10px 24px rgba(15,23,42,0.08)', padding: 16 }}>
            <h3 style={{ margin: 0, marginBottom: 12 }}>Users</h3>
            {loading ? <p>Loading...</p> : error ? <p style={{ color: '#b91c1c' }}>{error}</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', fontSize: 12, color: '#6b7280' }}>
                    <th style={{ paddingBottom: 8 }}>Username</th>
                    <th style={{ paddingBottom: 8 }}>Email</th>
                    <th style={{ paddingBottom: 8 }}>Roles</th>
                    <th style={{ paddingBottom: 8 }}>Status</th>
                    <th style={{ paddingBottom: 8 }}>Last Login</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id} style={{ fontSize: 14, color: '#111827', cursor: 'pointer', background: selected?.id === u.id ? '#f3f4f6' : 'transparent' }} onClick={() => selectUser(u)}>
                      <td style={{ padding: '6px 0' }}>{u.username}</td>
                      <td style={{ padding: '6px 0' }}>{u.email ?? '-'}</td>
                      <td style={{ padding: '6px 0' }}>{u.roles && u.roles.length ? u.roles.join(', ') : '—'}</td>
                      <td style={{ padding: '6px 0' }}><UserStatusBadge status={u.status} lockedUntil={u.lockedUntil} /></td>
                      <td style={{ padding: '6px 0' }}>{u.lastLogin ? formatDisplayTime(u.lastLogin) : '—'}</td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr><td colSpan={5} style={{ paddingTop: 12, color: '#6b7280' }}>No users found</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
          <div style={{ backgroundColor: '#fff', borderRadius: 12, boxShadow: '0 10px 24px rgba(15,23,42,0.08)', padding: 16 }}>
            <h3 style={{ margin: 0, marginBottom: 12 }}>Assign Roles</h3>
            {!selected ? <p>Select a user</p> : (
              <div>
                <div style={{ marginBottom: 8 }}>User: <strong>{selected.username}</strong></div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', fontSize: 12, color: '#6b7280' }}>
                      <th style={{ paddingBottom: 8 }}>Role</th>
                      <th style={{ paddingBottom: 8 }}>Assigned</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roles.map(r => (
                      <tr key={r.id} style={{ fontSize: 14 }}>
                        <td style={{ padding: '6px 0' }}>{r.name}</td>
                        <td style={{ padding: '6px 0' }}><input type='checkbox' disabled={!canManageUsers} checked={assigned.includes(r.id)} onChange={() => toggleRole(r.id)} /></td>
                      </tr>
                    ))}
                    {roles.length === 0 && (
                      <tr><td colSpan={2} style={{ paddingTop: 12, color: '#6b7280' }}>No roles available</td></tr>
                    )}
                  </tbody>
                </table>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                  {canManageUsers && (
                    <>
                      {selected?.status === 'active' && <button onClick={handleDisable} style={dangerBtn}>Disable</button>}
                      {selected?.status === 'disabled' && <button onClick={handleEnable} style={secondaryBtn}>Enable</button>}
                      <button onClick={handleAdminReset} style={secondaryBtn}>Send Reset</button>
                    </>
                  )}
                  <button onClick={save} disabled={!canManageUsers || !selected} style={{ ...primaryBtn, opacity: canManageUsers && selected ? 1 : 0.6 }}>{'Save Roles'}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {subTab === 'invites' && canInvite && (
        <InvitesPane
          invites={invites}
          loading={invitesLoading}
          error={inviteError}
          onReload={loadInvites}
          onResend={async (id) => { setInviteSuccess(null); await resendInvite(id); setInviteSuccess('Invite resent'); await loadInvites(); setTimeout(() => setInviteSuccess(null), 2000) }}
          onRevoke={async (id) => { setInviteSuccess(null); await revokeInvite(id); setInviteSuccess('Invite revoked'); await loadInvites(); setTimeout(() => setInviteSuccess(null), 2000) }}
          success={inviteSuccess}
        />
      )}

      {inviteModalOpen && canInvite && (
        <InviteModal
          roles={roles}
          onCancel={() => setInviteModalOpen(false)}
          onSent={async () => { setInviteModalOpen(false); await loadInvites(); setSubTab('invites'); window.location.hash = '#/access/invites' }}
        />
      )}
    </div>
  )
}



function StatusBadge({ status }: { status: UserInvite['status'] }) {
  const colors: Record<UserInvite['status'], string> = {
    pending: '#f59e0b',
    accepted: '#10b981',
    expired: '#6b7280',
    revoked: '#6b7280',
  }
  const labels: Record<UserInvite['status'], string> = {
    pending: 'Pending',
    accepted: 'Accepted',
    expired: 'Expired',
    revoked: 'Revoked',
  }
  return (
    <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 12, fontWeight: 700, color: '#fff', backgroundColor: colors[status] }}>
      {labels[status]}
    </span>
  )
}

function UserStatusBadge({ status, lockedUntil }: { status: UserSummary['status']; lockedUntil?: string | null }) {
  const colors: Record<UserSummary['status'], string> = {
    active: '#10b981',
    disabled: '#6b7280',
    locked: '#f59e0b',
  }
  const label = status === 'locked' && lockedUntil ? `Locked until ${formatDisplayTime(lockedUntil)}` : status === 'locked' ? 'Locked' : status === 'disabled' ? 'Disabled' : 'Active'
  return (
    <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 12, fontWeight: 700, color: '#fff', backgroundColor: colors[status] }}>
      {label}
    </span>
  )
}

function InviteModal({ roles, onCancel, onSent }: { roles: Role[]; onCancel: () => void; onSent: () => Promise<void> }) {
  const [email, setEmail] = useState('')
  const [roleIds, setRoleIds] = useState<number[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleRole(id: number) {
    setRoleIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function submit() {
    if (!email.trim()) { setError('Email is required'); return }
    try {
      setSending(true); setError(null)
      await sendInvite({ email: email.trim(), roleIds })
      await onSent()
    } catch (e: any) {
      setError(e.message || 'Failed to send invite')
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center', zIndex: 30 }}>
      <div style={{ width: '100%', maxWidth: 540, background: '#fff', borderRadius: 16, boxShadow: '0 10px 24px rgba(15,23,42,0.12)', padding: 20, display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Invite User</h3>
          <button onClick={onCancel} style={{ ...secondaryBtn, padding: '6px 10px' }}>×</button>
        </div>
        <label>
          <div style={label}>Email</div>
          <input value={email} onChange={e => setEmail(e.target.value)} style={input} placeholder="user@example.com" />
        </label>
        <div>
          <div style={{ ...label, marginBottom: 6 }}>Roles (optional)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
            {roles.map(r => (
              <label key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                <input type='checkbox' checked={roleIds.includes(r.id)} onChange={() => toggleRole(r.id)} />
                <span>{r.name}</span>
              </label>
            ))}
            {roles.length === 0 && <span style={{ color: '#6b7280' }}>No roles available</span>}
          </div>
        </div>
        {error && <p style={{ color: '#b91c1c', margin: 0 }}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onCancel} style={secondaryBtn}>Cancel</button>
          <button onClick={submit} disabled={sending} style={primaryBtn}>{sending ? 'Sending…' : 'Send Invite'}</button>
        </div>
      </div>
    </div>
  )
}

function InvitesPane({ invites, loading, error, onReload, onResend, onRevoke, success }: { invites: UserInvite[]; loading: boolean; error: string | null; onReload: () => void; onResend: (id: number) => Promise<void>; onRevoke: (id: number) => Promise<void>; success: string | null }) {
  return (
    <div style={{ backgroundColor: '#fff', borderRadius: 12, boxShadow: '0 10px 24px rgba(15,23,42,0.08)', padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>Invites</h3>
        <button onClick={onReload} style={secondaryBtn}>Refresh</button>
      </div>
      {success && <p style={{ color: '#065f46', margin: '4px 0' }}>{success}</p>}
      {loading ? <p>Loading…</p> : error ? <p style={{ color: '#b91c1c' }}>{error}</p> : invites.length === 0 ? (
        <p style={{ color: '#6b7280' }}>No invites yet.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', fontSize: 12, color: '#6b7280' }}>
              <th style={{ paddingBottom: 8 }}>Email</th>
              <th style={{ paddingBottom: 8 }}>Status</th>
              <th style={{ paddingBottom: 8 }}>Invited By</th>
              <th style={{ paddingBottom: 8 }}>Expires</th>
              <th style={{ paddingBottom: 8 }}>Created</th>
              <th style={{ paddingBottom: 8 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {invites.map(i => (
              <tr key={i.id} style={{ fontSize: 14, color: '#111827' }}>
                <td style={{ padding: '6px 0' }}>{i.email}</td>
                <td style={{ padding: '6px 0' }}><StatusBadge status={i.status} /></td>
                <td style={{ padding: '6px 0' }}>{i.invitedBy || '—'}</td>
                <td style={{ padding: '6px 0' }}>{i.expiresAt ? formatDisplayTime(i.expiresAt) : '—'}</td>
                <td style={{ padding: '6px 0' }}>{formatDisplayTime(i.createdAt)}</td>
                <td style={{ padding: '6px 0', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button style={secondaryBtn} onClick={() => onResend(i.id)}>Resend</button>
                  <button style={dangerBtn} onClick={() => onRevoke(i.id)}>Revoke</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

type RoleFormValues = { name: string; description?: string; permissions: RolePermission[] }

const input: React.CSSProperties = { padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', width: '100%', maxWidth: '100%', boxSizing: 'border-box' }
const label: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 6 }
const primaryBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#2563eb', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' }
const secondaryBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#e5e7eb', color: '#111827', border: 'none', fontWeight: 600, cursor: 'pointer' }
const dangerBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#dc2626', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' }
