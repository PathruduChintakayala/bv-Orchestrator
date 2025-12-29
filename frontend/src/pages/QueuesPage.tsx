import { useEffect, useState } from 'react'
import type { Queue } from '../types/queue'
import { fetchQueues, createQueue, updateQueue, deleteQueue } from '../api/queues'
import { fetchQueueItems } from '../api/queueItems'

export default function QueuesPage() {
  const [items, setItems] = useState<Queue[]>([])
  const [queueItems, setQueueItems] = useState<import('../types/queueItem').QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Queue | null>(null)
  const [selectedQueue, setSelectedQueue] = useState<Queue | null>(null)
  const [hasTrigger, setHasTrigger] = useState(false)
  const [labels, setLabels] = useState('')
  const [properties, setProperties] = useState('')
  const [completedItems, setCompletedItems] = useState(false)
  const [uncompletedItems, setUncompletedItems] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    try {
      setLoading(true); setError(null)
      const [queuesData, itemsData] = await Promise.all([
        fetchQueues(search ? { search } : undefined),
        fetchQueueItems()
      ])
      setItems(queuesData)
      setQueueItems(itemsData)
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

  function getQueueMetrics(queueId: number) {
    const items = queueItems.filter(i => i.queueId === queueId)
    const inProgress = items.filter(i => i.status === 'in_progress').length
    const remaining = items.filter(i => i.status === 'new' || i.status === 'in_progress').length
    const successful = items.filter(i => i.status === 'completed').length
    const appExceptions = items.filter(i => i.status === 'failed').length
    const bizExceptions = 0 // not distinguished
    const completedItemsList = items.filter(i => i.status === 'completed')
    let avgProcessingTime = 0
    if (completedItemsList.length > 0) {
      const totalTime = completedItemsList.reduce((sum, i) => {
        const start = new Date(i.createdAt).getTime()
        const end = new Date(i.updatedAt || i.createdAt).getTime()
        return sum + (end - start)
      }, 0)
      avgProcessingTime = totalTime / completedItemsList.length / 1000 // seconds
    }
    return { inProgress, remaining, avgProcessingTime, successful, appExceptions, bizExceptions }
  }

  function formatTime(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)} s`
    const minutes = seconds / 60
    return `${minutes.toFixed(1)} min`
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827' }}>Queues</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder='Search queues...' style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb' }} />
          <button onClick={load} style={secondaryBtn}>Search</button>
          <button onClick={openNew} style={primaryBtn}>+ Add Queue</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={hasTrigger} onChange={e=>setHasTrigger(e.target.checked)} />
          Has Trigger
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span>Labels:</span>
          <input value={labels} onChange={e=>setLabels(e.target.value)} placeholder='Filter labels...' style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #e5e7eb', width: 120 }} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span>Properties:</span>
          <input value={properties} onChange={e=>setProperties(e.target.value)} placeholder='Filter properties...' style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #e5e7eb', width: 120 }} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={completedItems} onChange={e=>setCompletedItems(e.target.checked)} />
          Completed queue items
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={uncompletedItems} onChange={e=>setUncompletedItems(e.target.checked)} />
          Uncompleted queue items
        </label>
      </div>

      <div style={{ backgroundColor: '#fff', borderRadius: 12, boxShadow: '0 10px 24px rgba(15,23,42,0.08)', padding: 16 }}>
        {loading ? <p>Loading...</p> : error ? <p style={{color:'#b91c1c'}}>{error}</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', fontSize: 12, color: '#6b7280' }}>
                <th style={{ paddingBottom: 8 }}>Name</th>
                <th style={{ paddingBottom: 8, textAlign: 'right' }}>In Progress</th>
                <th style={{ paddingBottom: 8, textAlign: 'right' }}>Remaining</th>
                <th style={{ paddingBottom: 8, textAlign: 'right' }}>Average Processing Time</th>
                <th style={{ paddingBottom: 8, textAlign: 'right' }}>Successful</th>
                <th style={{ paddingBottom: 8, textAlign: 'right' }}>App Exceptions</th>
                <th style={{ paddingBottom: 8, textAlign: 'right' }}>Biz Exceptions</th>
                <th style={{ paddingBottom: 8 }}>Process</th>
                <th style={{ paddingBottom: 8 }}>Labels</th>
                <th style={{ paddingBottom: 8 }}>Properties</th>
                <th style={{ paddingBottom: 8 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(q => {
                const metrics = getQueueMetrics(q.id)
                return (
                  <tr key={q.id} style={{ fontSize: 14, color: '#111827' }}>
                    <td style={{ padding: '6px 0' }}>
                      <a href={`#/queue-items?queueId=${q.id}`} style={{ color: '#2563eb', textDecoration: 'none' }}>{q.name}</a>
                    </td>
                    <td style={{ padding: '6px 0', textAlign: 'right' }}>{metrics.inProgress}</td>
                    <td style={{ padding: '6px 0', textAlign: 'right' }}>{metrics.remaining}</td>
                    <td style={{ padding: '6px 0', textAlign: 'right' }}>{formatTime(metrics.avgProcessingTime)}</td>
                    <td style={{ padding: '6px 0', textAlign: 'right' }}>{metrics.successful}</td>
                    <td style={{ padding: '6px 0', textAlign: 'right' }}>{metrics.appExceptions}</td>
                    <td style={{ padding: '6px 0', textAlign: 'right' }}>{metrics.bizExceptions}</td>
                    <td style={{ padding: '6px 0' }}>-</td>
                    <td style={{ padding: '6px 0' }} title={''}>-</td>
                    <td style={{ padding: '6px 0' }} title={q.description || ''}>{(q.description || '').slice(0, 20)}{(q.description || '').length > 20 ? '...' : ''}</td>
                    <td style={{ padding: '6px 0' }}>
                      <select style={{ border: 'none', background: 'none', cursor: 'pointer' }} onChange={e => {
                        const action = e.target.value
                        if (action === 'view-items') window.location.hash = `#/queue-items?queueId=${q.id}`
                        else if (action === 'view-details') setSelectedQueue(q)
                        else if (action === 'edit') openEdit(q)
                        else if (action === 'delete') handleDelete(q.id)
                        e.target.value = ''
                      }}>
                        <option value=''>⋮</option>
                        <option value='view-items'>View Queue Items</option>
                        <option value='view-details'>View Details</option>
                        <option value='edit'>Edit Queue</option>
                        <option value='delete'>Delete Queue</option>
                      </select>
                    </td>
                  </tr>
                )
              })}
              {items.length === 0 && (
                <tr><td colSpan={11} style={{ paddingTop: 12, color: '#6b7280', textAlign: 'center' }}>
                  <div style={{ padding: 32 }}>
                    <p style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>No queues found</p>
                    <p>Queues are used to manage and process items asynchronously. Create your first queue to get started.</p>
                    <button onClick={openNew} style={{ ...primaryBtn, marginTop: 16 }}>Add Queue</button>
                  </div>
                </td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {modalOpen && (
        <QueueModal initial={editing} onCancel={closeModal} onSave={handleSave} />
      )}

      {selectedQueue && (
        <DetailsModal queue={selectedQueue} onClose={() => setSelectedQueue(null)} />
      )}
    </div>
  )
}

function DetailsModal({ queue, onClose }: { queue: Queue; onClose: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center' }}>
      <div style={{ width: '100%', maxWidth: 600, background: '#fff', borderRadius: 16, boxShadow: '0 4px 16px rgba(0,0,0,0.15)', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827' }}>Queue Details</h2>
          <button onClick={onClose} style={{ ...secondaryBtn, padding: '6px 10px' }}>×</button>
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <div><strong>Name:</strong> {queue.name}</div>
          <div><strong>Description:</strong> {queue.description || 'No description'}</div>
          <div><strong>Active:</strong> {queue.isActive ? 'Yes' : 'No'}</div>
          <div><strong>Max Retries:</strong> {queue.maxRetries}</div>
          <div><strong>Created At:</strong> {new Date(queue.createdAt).toLocaleString()}</div>
          <div><strong>Updated At:</strong> {new Date(queue.updatedAt).toLocaleString()}</div>
        </div>
      </div>
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
