import { useEffect, useState } from 'react'
import type { Queue } from '../types/queue'
import { fetchQueues, createQueue, updateQueue, deleteQueue } from '../api/queues'

export default function QueuesPage() {
  const [items, setItems] = useState<Queue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Queue | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    try {
      setLoading(true); setError(null)
      const data = await fetchQueues(search ? { search } : undefined)
      setItems(data)
    } catch (e: any) {
      setError(e.message || 'Failed to load queues')
    } finally { setLoading(false) }
  }

  function openNew() { setEditing(null); setModalOpen(true) }
  function openEdit(q: Queue) { setEditing(q); setModalOpen(true) }
  function closeModal() { setModalOpen(false); setEditing(null) }

  async function handleSave(values: FormValues) {
    try {
      if (editing) {
        await updateQueue(editing.id, { description: values.description || undefined, maxRetries: values.maxRetries, isActive: values.isActive })
      } else {
        await createQueue({ name: values.name!, description: values.description || undefined, maxRetries: values.maxRetries, isActive: values.isActive })
      }
      closeModal(); await load()
    } catch (e: any) { alert(e.message || 'Save failed') }
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this queue?')) return
    try { await deleteQueue(id); await load() } catch (e: any) { alert(e.message || 'Delete failed') }
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827' }}>Queues</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder='Search queues...' style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb' }} />
          <button onClick={load} style={secondaryBtn}>Search</button>
          <button onClick={openNew} style={primaryBtn}>New Queue</button>
        </div>
      </div>

      <div style={{ backgroundColor: '#fff', borderRadius: 12, boxShadow: '0 10px 24px rgba(15,23,42,0.08)', padding: 16 }}>
        {loading ? <p>Loading...</p> : error ? <p style={{color:'#b91c1c'}}>{error}</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', fontSize: 12, color: '#6b7280' }}>
                <th style={{ paddingBottom: 8 }}>Name</th>
                <th style={{ paddingBottom: 8 }}>Active</th>
                <th style={{ paddingBottom: 8 }}>Max retries</th>
                <th style={{ paddingBottom: 8 }}>Created</th>
                <th style={{ paddingBottom: 8 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(q => (
                <tr key={q.id} style={{ fontSize: 14, color: '#111827' }}>
                  <td style={{ padding: '6px 0' }}>{q.name}</td>
                  <td style={{ padding: '6px 0' }}>{q.isActive ? 'Yes' : 'No'}</td>
                  <td style={{ padding: '6px 0' }}>{q.maxRetries}</td>
                  <td style={{ padding: '6px 0' }}>{new Date(q.createdAt).toLocaleString()}</td>
                  <td style={{ padding: '6px 0' }}>
                    <button style={secondaryBtn} onClick={()=>window.location.hash = `#/queue-items?queueId=${q.id}`}>View Items</button>{' '}
                    <button style={secondaryBtn} onClick={()=>openEdit(q)}>Edit</button>{' '}
                    <button style={dangerBtn} onClick={()=>handleDelete(q.id)}>Delete</button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={5} style={{ paddingTop: 12, color: '#6b7280' }}>No queues found</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {modalOpen && (
        <QueueModal initial={editing} onCancel={closeModal} onSave={handleSave} />
      )}
    </div>
  )
}

function QueueModal({ initial, onCancel, onSave }: { initial: Queue | null; onCancel: ()=>void; onSave:(v:FormValues)=>void }) {
  const [form, setForm] = useState<FormValues>({ name: initial?.name || '', description: initial?.description || '', maxRetries: initial?.maxRetries ?? 0, isActive: initial?.isActive ?? true })
  const [saving, setSaving] = useState(false)

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const { name, value, checked } = e.target as any
    if (name === 'maxRetries') setForm(prev => ({ ...prev, maxRetries: Number(value) }))
    else if (name === 'isActive') setForm(prev => ({ ...prev, isActive: !!checked }))
    else setForm(prev => ({ ...prev, [name]: value }))
  }

  async function submit() {
    if (!initial && !form.name.trim()) { alert('Name is required'); return }
    try { setSaving(true); await onSave(form) } finally { setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center' }}>
      <div style={{ width: '100%', maxWidth: 600, background: '#fff', borderRadius: 16, boxShadow: '0 4px 16px rgba(0,0,0,0.15)', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 12 }}>{initial ? 'Edit Queue' : 'New Queue'}</h2>
        <div style={{ display: 'grid', gap: 10 }}>
          {!initial && (
            <label>
              <div style={label}>Name</div>
              <input name='name' value={form.name} onChange={handleChange} style={input} />
            </label>
          )}
          <label>
            <div style={label}>Description</div>
            <textarea name='description' value={form.description || ''} onChange={handleChange} style={{...input, minHeight: 80}} />
          </label>
          <label>
            <div style={label}>Max retries</div>
            <input name='maxRetries' type='number' value={form.maxRetries} onChange={handleChange} style={input} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input name='isActive' type='checkbox' checked={form.isActive} onChange={handleChange} />
            <span>Active</span>
          </label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button onClick={onCancel} style={secondaryBtn}>Cancel</button>
          <button onClick={submit} disabled={saving} style={primaryBtn}>{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

type FormValues = { name: string; description?: string; maxRetries: number; isActive: boolean }

const input: React.CSSProperties = { padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', width: '100%', maxWidth: '100%', boxSizing: 'border-box' }
const label: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 6 }
const primaryBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#2563eb', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' }
const secondaryBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#e5e7eb', color: '#111827', border: 'none', fontWeight: 600, cursor: 'pointer' }
const dangerBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#dc2626', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' }
