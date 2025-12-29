import { useEffect, useState } from 'react'
import type { Queue } from '../types/queue'
import { fetchQueues, fetchQueueStats } from '../api/queues'

export default function QueuesPage() {
  const [items, setItems] = useState<Queue[]>([])
  const [queueStats, setQueueStats] = useState<Record<number, any>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<number[]>([])
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
      const queuesData = await fetchQueues(search ? { search } : undefined)
      setItems(queuesData)
      // Fetch stats for all queues
      const statsPromises = queuesData.map(q => fetchQueueStats(q.id).then(stats => ({ id: q.id, stats })).catch(() => ({ id: q.id, stats: null })))
      const statsResults = await Promise.all(statsPromises)
      const statsMap: Record<number, any> = {}
      statsResults.forEach(({ id, stats }) => {
        statsMap[id] = stats
      })
      setQueueStats(statsMap)
      setSelected([]) // clear selection on reload
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
        await updateQueue(editing.id, { description: values.description || undefined, maxRetries: values.maxRetries })
      } else {
        await createQueue({ name: values.name!, description: values.description || undefined, maxRetries: values.maxRetries, enforceUniqueReference: values.enforceUniqueReference })
      }
      closeModal(); await load()
    } catch (e: any) { alert(e.message || 'Save failed') }
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this queue?')) return
    try { await deleteQueue(id); await load() } catch (e: any) { alert(e.message || 'Delete failed') }
  }

  function getQueueMetrics(queueId: number) {
    const stats = queueStats[queueId]
    if (!stats) return { inProgress: 0, remaining: 0, avgProcessingTime: 0, successful: 0, appExceptions: 0, bizExceptions: 0 }
    return {
      inProgress: stats.inProgress ?? 0,
      remaining: stats.remaining ?? 0,
      avgProcessingTime: stats.avgProcessingTime ?? 0,
      successful: stats.successful ?? 0,
      appExceptions: stats.appExceptions ?? 0,
      bizExceptions: stats.bizExceptions ?? 0
    }
  }

  function formatTime(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)} s`
    const minutes = seconds / 60
    return `${minutes.toFixed(1)} min`
  }

  function toggleSelect(id: number) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function toggleSelectAll() {
    if (selected.length === items.length) {
      setSelected([])
    } else {
      setSelected(items.map(q => q.id))
    }
  }

  async function handleBulkDelete() {
    if (selected.length === 0) return
    if (!confirm(`Delete ${selected.length} selected queue(s)? This action cannot be undone.`)) return
    let successCount = 0
    let errorMessages: string[] = []
    for (const id of selected) {
      try {
        await deleteQueue(id)
        successCount++
      } catch (e: any) {
        errorMessages.push(`Failed to delete queue ${id}: ${e.message || 'Unknown error'}`)
      }
    }
    if (errorMessages.length > 0) {
      alert(`Deleted ${successCount} queue(s).\n\nErrors:\n${errorMessages.join('\n')}`)
    } else {
      alert(`Successfully deleted ${successCount} queue(s).`)
    }
    setSelected([])
    await load()
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
        {selected.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', backgroundColor: '#f3f4f6', borderRadius: 8, marginBottom: 16 }}>
            <span style={{ fontWeight: 600 }}>{selected.length} selected</span>
            <button onClick={handleBulkDelete} style={dangerBtn}>Delete</button>
          </div>
        )}
        {loading ? <p>Loading...</p> : error ? <p style={{color:'#b91c1c'}}>{error}</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', fontSize: 12, color: '#6b7280' }}>
                <th style={{ paddingBottom: 8, width: 40 }}>
                  <input type="checkbox" checked={selected.length === items.length && items.length > 0} onChange={toggleSelectAll} ref={(el) => {
                    if (el) el.indeterminate = selected.length > 0 && selected.length < items.length
                  }} />
                </th>
                <th style={{ paddingBottom: 8 }}>Name</th>
                <th style={{ paddingBottom: 8, textAlign: 'right' }}>In Progress</th>
                <th style={{ paddingBottom: 8, textAlign: 'right' }}>Remaining</th>
                <th style={{ paddingBottom: 8, textAlign: 'right' }}>Average Processing Time</th>
                <th style={{ paddingBottom: 8, textAlign: 'right' }}>Successful</th>
                <th style={{ paddingBottom: 8, textAlign: 'right' }}>App Exceptions</th>
                <th style={{ paddingBottom: 8, textAlign: 'right' }}>Biz Exceptions</th>
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
                      <input type="checkbox" checked={selected.includes(q.id)} onChange={() => toggleSelect(q.id)} />
                    </td>
                    <td style={{ padding: '6px 0' }}>
                      <a href={`#/queue-items?queueId=${q.id}`} style={{ color: '#2563eb', textDecoration: 'none' }}>{q.name}</a>
                    </td>
                    <td style={{ padding: '6px 0', textAlign: 'right' }}>{metrics.inProgress ?? 0}</td>
                    <td style={{ padding: '6px 0', textAlign: 'right' }}>{metrics.remaining ?? 0}</td>
                    <td style={{ padding: '6px 0', textAlign: 'right' }}>{formatTime(metrics.avgProcessingTime ?? 0)}</td>
                    <td style={{ padding: '6px 0', textAlign: 'right' }}>{metrics.successful ?? 0}</td>
                    <td style={{ padding: '6px 0', textAlign: 'right' }}>{metrics.appExceptions ?? 0}</td>
                    <td style={{ padding: '6px 0', textAlign: 'right' }}>{metrics.bizExceptions ?? 0}</td>
                    <td style={{ padding: '6px 0' }} title={q.description || ''}>{(q.description || '').slice(0, 20)}{(q.description || '').length > 20 ? '...' : ''}</td>
                    <td style={{ padding: '6px 0' }}>
                      <select style={{ border: '1px solid #e5e7eb', backgroundColor: '#f3f4f6', cursor: 'pointer', padding: '4px 8px', borderRadius: 4, fontSize: 12, color: '#111827' }} onChange={e => {
                        const action = e.target.value
                        if (action === 'view-items') window.location.hash = `#/queue-items?queueId=${q.id}`
                        else if (action === 'view-details') setSelectedQueue(q)
                        else if (action === 'edit') openEdit(q)
                        else if (action === 'delete') handleDelete(q.id)
                        e.target.value = ''
                      }}>
                        <option value=''>Actions</option>
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
          <div><strong>Max Retries:</strong> {queue.maxRetries}</div>
          <div><strong>Enforce Unique Reference:</strong> {queue.enforceUniqueReference ? 'Yes' : 'No'}</div>
          <div><strong>Created At:</strong> {new Date(queue.createdAt).toLocaleString()}</div>
          <div><strong>Updated At:</strong> {new Date(queue.updatedAt).toLocaleString()}</div>
        </div>
      </div>
    </div>
  )
}

function QueueModal({ initial, onCancel, onSave }: { initial: Queue | null; onCancel: ()=>void; onSave:(v:FormValues)=>void }) {
  const [form, setForm] = useState<FormValues>({ name: initial?.name || '', description: initial?.description || '', maxRetries: initial?.maxRetries ?? 0, enforceUniqueReference: initial?.enforceUniqueReference ?? false })
  const [saving, setSaving] = useState(false)

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const { name, value, type, checked } = e.target as any
    if (type === 'checkbox') setForm(prev => ({ ...prev, [name]: checked }))
    else if (name === 'maxRetries') setForm(prev => ({ ...prev, maxRetries: Number(value) }))
    else setForm(prev => ({ ...prev, [name]: value }))
  }

  async function submit() {
    if (!initial && !form.name?.trim()) { alert('Name is required'); return }
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
          {!initial && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input name='enforceUniqueReference' type='checkbox' checked={form.enforceUniqueReference} onChange={handleChange} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>Enforce unique reference for queue items</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>If enabled, queue items must have unique references within this queue. Deleted items still count.</div>
              </div>
            </label>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button onClick={onCancel} style={secondaryBtn}>Cancel</button>
          <button onClick={submit} disabled={saving} style={primaryBtn}>{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

type FormValues = { name?: string; description?: string; maxRetries: number; enforceUniqueReference?: boolean }

const input: React.CSSProperties = { padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', width: '100%', maxWidth: '100%', boxSizing: 'border-box' }
const label: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 6 }
const primaryBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#2563eb', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' }
const secondaryBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#e5e7eb', color: '#111827', border: 'none', fontWeight: 600, cursor: 'pointer' }
const dangerBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#dc2626', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' }
