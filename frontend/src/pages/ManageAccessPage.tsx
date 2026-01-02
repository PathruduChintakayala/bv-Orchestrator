import { useEffect, useMemo, useState } from 'react'
import type { ArtifactKey, Role, RolePermission, UserSummary } from '../types/access'
import { fetchRoles, createRole, updateRole, deleteRole, fetchUsers, assignUserRoles, fetchUserRoles } from '../api/access'

const ARTIFACTS: ArtifactKey[] = ['dashboard','processes','packages','assets','jobs','robots','queues','queue_items','users','roles']

export default function ManageAccessPage() {
  const [activeTab, setActiveTab] = useState<'roles' | 'users'>('roles')
  return (
    <div style={{ padding: 16 }}>
      <div className="page-shell" style={{ gap: 12 }}>
        <div className="surface-card" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h1 className="page-title" style={{ margin: 0 }}>Manage Access</h1>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={()=>setActiveTab('roles')} style={activeTab==='roles'?primaryBtn:secondaryBtn}>Roles</button>
            <button onClick={()=>setActiveTab('users')} style={activeTab==='users'?primaryBtn:secondaryBtn}>Users</button>
          </div>
        </div>
        {activeTab === 'roles' ? <RolesTab /> : <UsersTab />}
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
        {loading ? <p>Loading...</p> : error ? <p style={{color:'#b91c1c'}}>{error}</p> : (
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
                    <button style={secondaryBtn} onClick={()=>openEdit(r)}>Edit</button>{' '}
                    <button style={dangerBtn} onClick={()=>handleDelete(r.id)}>Delete</button>
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

function RoleModal({ initial, onCancel, onSave }: { initial: Role | null; onCancel: ()=>void; onSave:(v:RoleFormValues)=>void }) {
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
            <input name='name' value={form.name} onChange={e=>setForm(f=>({ ...f, name: (e.target as any).value }))} style={input} />
          </label>
          <label>
            <div style={label}>Description</div>
            <input name='description' value={form.description || ''} onChange={e=>setForm(f=>({ ...f, description: (e.target as any).value }))} style={input} />
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
                      <td style={{ padding: '6px 0' }}><input type='checkbox' checked={!!p?.canView} onChange={()=>toggle(a, 'canView')} /></td>
                      <td style={{ padding: '6px 0' }}><input type='checkbox' disabled={disableCreate} checked={!!p?.canCreate} onChange={()=>toggle(a, 'canCreate')} /></td>
                      <td style={{ padding: '6px 0' }}><input type='checkbox' disabled={disableEdit} checked={!!p?.canEdit} onChange={()=>toggle(a, 'canEdit')} /></td>
                      <td style={{ padding: '6px 0' }}><input type='checkbox' disabled={disableDelete} checked={!!p?.canDelete} onChange={()=>toggle(a, 'canDelete')} /></td>
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

function UsersTab() {
  const [users, setUsers] = useState<UserSummary[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [selected, setSelected] = useState<UserSummary | null>(null)
  const [assigned, setAssigned] = useState<number[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    try {
      setLoading(true); setError(null)
      const [u, r] = await Promise.all([fetchUsers(), fetchRoles()])
      setUsers(u); setRoles(r)
      if (u.length) { selectUser(u[0]) }
    } catch (e: any) { setError(e.message || 'Failed to load data') }
    finally { setLoading(false) }
  }

  async function selectUser(u: UserSummary) {
    setSelected(u)
    try {
      const ur = await fetchUserRoles(u.id)
      setAssigned(ur.roles.map(r => r.id))
    } catch { setAssigned([]) }
  }

  async function save() {
    if (!selected) return
    try { await assignUserRoles(selected.id, assigned) ; alert('Roles saved') }
    catch (e: any) { alert(e.message || 'Save failed') }
  }

  function toggleRole(id: number) {
    setAssigned(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <div style={{ backgroundColor: '#fff', borderRadius: 12, boxShadow: '0 10px 24px rgba(15,23,42,0.08)', padding: 16 }}>
        <h3 style={{ margin: 0, marginBottom: 12 }}>Users</h3>
        {loading ? <p>Loading...</p> : error ? <p style={{color:'#b91c1c'}}>{error}</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', fontSize: 12, color: '#6b7280' }}>
                <th style={{ paddingBottom: 8 }}>Username</th>
                <th style={{ paddingBottom: 8 }}>Email</th>
                <th style={{ paddingBottom: 8 }}>Active</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} style={{ fontSize: 14, color: '#111827', cursor: 'pointer', background: selected?.id === u.id ? '#f3f4f6' : 'transparent' }} onClick={()=>selectUser(u)}>
                  <td style={{ padding: '6px 0' }}>{u.username}</td>
                  <td style={{ padding: '6px 0' }}>{u.email ?? '-'}</td>
                  <td style={{ padding: '6px 0' }}>{u.isActive ? 'Yes' : 'No'}</td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={3} style={{ paddingTop: 12, color: '#6b7280' }}>No users found</td></tr>
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
                    <td style={{ padding: '6px 0' }}><input type='checkbox' checked={assigned.includes(r.id)} onChange={()=>toggleRole(r.id)} /></td>
                  </tr>
                ))}
                {roles.length === 0 && (
                  <tr><td colSpan={2} style={{ paddingTop: 12, color: '#6b7280' }}>No roles available</td></tr>
                )}
              </tbody>
            </table>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button onClick={save} style={primaryBtn}>Save Roles</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

type RoleFormValues = { name: string; description?: string; permissions: RolePermission[] }

const input: React.CSSProperties = { padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', width: '100%', maxWidth: '100%', boxSizing: 'border-box' }
const label: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 6 }
const primaryBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#2563eb', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' }
const secondaryBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#e5e7eb', color: '#111827', border: 'none', fontWeight: 600, cursor: 'pointer' }
const dangerBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#dc2626', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' }
