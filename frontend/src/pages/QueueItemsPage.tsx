import { useEffect, useState } from 'react'
import type { QueueItem, QueueItemStatus } from '../types/queueItem'
import { fetchQueueItems, createQueueItem, updateQueueItem } from '../api/queueItems'
import { fetchQueues } from '../api/queues'

export default function QueueItemsPage() {
  const [queueId, setQueueId] = useState<number | null>(null)
  const [items, setItems] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<QueueItemStatus | ''>('')
  const [selected, setSelected] = useState<string[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [currentQueue, setCurrentQueue] = useState<import('../types/queue').Queue | null>(null)
  const [selectedItem, setSelectedItem] = useState<QueueItem | null>(null)

  useEffect(() => {
    const hash = window.location.hash || '#/queue-items'
    const url = new URL(hash.replace('#', ''), 'http://localhost')
    const qid = url.searchParams.get('queueId')
    const newQueueId = qid ? Number(qid) : null
    setQueueId(newQueueId)

    if (!newQueueId) {
      setError('Queue ID is required. Please navigate from the Queues page.')
      setLoading(false)
      return
    }

    // Fetch the specific queue info
    fetchQueues({}).then(queues => {
      const queue = queues.find(q => q.id === newQueueId)
      setCurrentQueue(queue || null)
      if (!queue) {
        setError('Queue not found.')
        setLoading(false)
      }
    }).catch(() => {
      setError('Failed to load queue information.')
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    if (queueId) {
      load()
    }
  }, [queueId, status])

  async function load() {
    if (!queueId) return
    try {
      setLoading(true); setError(null)
      const data = await fetchQueueItems({ queueId, status: status || undefined as any })
      setItems(data)
      setSelected([]) // clear selection on reload
    } catch (e: any) {
      setError(e.message || 'Failed to load items')
    } finally { setLoading(false) }
  }

  function openNew() { setModalOpen(true) }
  function closeModal() { setModalOpen(false) }

  async function handleCreate(values: FormValues) {
    try {
      await createQueueItem({ queueId: queueId!, reference: values.reference || undefined, priority: values.priority ?? 0, payload: values.payload || undefined })
      closeModal(); await load()
    } catch (e: any) {
      // Error is handled in the modal
      throw e
    }
  }

  function toggleSelect(id: string) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function toggleSelectAll() {
    const selectableItems = items.filter(it => it.status !== 'deleted')
    if (selected.length === selectableItems.length) {
      setSelected([])
    } else {
      setSelected(selectableItems.map(it => it.id))
    }
  }

  async function handleBulkDelete() {
    if (selected.length === 0) return
    if (!confirm(`Soft delete ${selected.length} selected item(s)? They will be marked as deleted and cannot be modified.`)) return
    let successCount = 0
    let errorMessages: string[] = []
    for (const id of selected) {
      try {
        await updateQueueItem(id, { status: 'deleted' })
        successCount++
      } catch (e: any) {
        errorMessages.push(`Failed to delete item ${id}: ${e.message || 'Unknown error'}`)
      }
    }
    if (errorMessages.length > 0) {
      alert(`Deleted ${successCount} item(s).\n\nErrors:\n${errorMessages.join('\n')}`)
    } else {
      alert(`Successfully deleted ${successCount} item(s).`)
    }
    setSelected([])
    await load()
  }

  // If no queueId is provided, show a message
  if (queueId === null) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ textAlign: 'center', padding: 48 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827', marginBottom: 16 }}>Queue Items</h1>
          <p style={{ color: '#6b7280', marginBottom: 24 }}>Please select a queue from the Queues page to view its items.</p>
          <button onClick={() => window.location.hash = '#/queues'} style={{ padding: '10px 16px', borderRadius: 8, backgroundColor: '#2563eb', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' }}>
            Go to Queues
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: 16 }}>
      <div className="page-shell" style={{ gap: 12 }}>
        <div className="surface-card" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h1 className="page-title" style={{ margin: 0 }}>{currentQueue ? `Queue Items: ${currentQueue.name}` : 'Queue Items'}</h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <select value={status} onChange={e => setStatus(e.target.value as QueueItemStatus | '')} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb' }}>
              <option value=''>All statuses</option>
              {(['new', 'in_progress', 'completed', 'failed', 'deleted'] as QueueItemStatus[]).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button onClick={load} title="Refresh" style={{ ...secondaryBtn, padding: '10px', fontSize: '16px' }}>↻</button>
            <button onClick={openNew} style={primaryBtn}>New Item</button>
          </div>
        </div>

        <div className="surface-card">
          {selected.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', backgroundColor: '#f3f4f6', borderRadius: 8, marginBottom: 16 }}>
              <span style={{ fontWeight: 600 }}>{selected.length} selected</span>
              <button onClick={handleBulkDelete} style={dangerBtn}>Delete</button>
            </div>
          )}
          {loading ? <p>Loading...</p> : error ? <p style={{ color: '#b91c1c' }}>{error}</p> : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ width: 40 }}>
                    <input type="checkbox" checked={selected.length === items.filter(it => it.status !== 'deleted').length && items.filter(it => it.status !== 'deleted').length > 0} onChange={toggleSelectAll} ref={(el) => {
                      if (el) el.indeterminate = selected.length > 0 && selected.length < items.filter(it => it.status !== 'deleted').length
                    }} />
                  </th>
                  <th>Reference</th>
                  <th>Status</th>
                  <th data-align="right">Priority</th>
                  <th data-align="right">Retries</th>
                  <th>Created</th>
                  <th data-type="actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => (
                  <tr key={it.id}>
                    <td>
                      <input type="checkbox" checked={selected.includes(it.id)} onChange={() => toggleSelect(it.id)} disabled={it.status === 'deleted'} />
                    </td>
                    <td>{it.reference ?? '-'}</td>
                    <td><StatusBadge status={it.status} /></td>
                    <td data-align="right">{it.priority}</td>
                    <td data-align="right">{it.retries}</td>
                    <td>{new Date(it.createdAt).toLocaleString()}</td>
                    <td data-type="actions">
                      <button style={secondaryBtn} onClick={() => setSelectedItem(it)}>View Details</button>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr><td colSpan={7} style={{ paddingTop: 12, color: '#6b7280' }}>No items found</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>

      </div>

      {modalOpen && (
        <NewItemModal onCancel={closeModal} onSave={handleCreate} />
      )}

      {selectedItem && (
        <DetailsModal item={selectedItem} onClose={() => setSelectedItem(null)} />
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: QueueItemStatus }) {
  const colors = {
    new: '#10b981', // green
    in_progress: '#3b82f6', // blue
    completed: '#059669', // emerald
    failed: '#dc2626', // red
    deleted: '#6b7280' // gray
  }
  return (
    <span style={{
      padding: '2px 8px',
      borderRadius: 12,
      fontSize: 12,
      fontWeight: 600,
      color: '#fff',
      backgroundColor: colors[status] || '#6b7280',
      textTransform: 'uppercase'
    }}>
      {status.replace('_', ' ')}
    </span>
  )
}

function NewItemModal({ onCancel, onSave }: { onCancel: () => void; onSave: (v: FormValues) => Promise<void> }) {
  const [form, setForm] = useState<FormValues>({ reference: '', priority: 0, payloadText: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const { name, value } = e.target as any
    setForm(prev => ({ ...prev, [name]: name === 'priority' ? (value ? Number(value) : undefined) : value }))
    if (name === 'reference') setError(null) // Clear error when reference changes
  }

  function parsePayload(): Record<string, unknown> | undefined {
    const t = (form.payloadText || '').trim()
    if (!t) return undefined
    try { return JSON.parse(t) } catch { alert('Payload must be valid JSON'); return undefined }
  }

  async function submit() {
    const payload = parsePayload()
    if (form.payloadText && !payload) return
    setError(null)
    try { setSaving(true); await onSave({ reference: form.reference, priority: form.priority, payload }); } catch (e: any) { setError(e.message || 'Create failed') } finally { setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center' }}>
      <div style={{ width: '100%', maxWidth: 640, background: '#fff', borderRadius: 16, boxShadow: '0 4px 16px rgba(0,0,0,0.15)', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 12 }}>New Item</h2>
        <div style={{ display: 'grid', gap: 10 }}>
          <label>
            <div style={label}>Reference</div>
            <input name='reference' value={form.reference || ''} onChange={handleChange} style={input} />
            {error && <div style={{ color: '#dc2626', fontSize: 12, marginTop: 4 }}>{error}</div>}
          </label>
          <label>
            <div style={label}>Priority</div>
            <input name='priority' type='number' value={form.priority ?? 0} onChange={handleChange} style={input} />
          </label>
          <label>
            <div style={label}>Payload (JSON)</div>
            <textarea name='payloadText' value={form.payloadText || ''} onChange={handleChange} style={{ ...input, minHeight: 120 }} placeholder='e.g. {"invoiceId":123}' />
          </label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button onClick={onCancel} style={secondaryBtn}>Cancel</button>
          <button onClick={submit} disabled={saving} style={primaryBtn}>{saving ? 'Creating...' : 'Create'}</button>
        </div>
      </div>
    </div>
  )
}

function DetailsModal({ item, onClose }: { item: QueueItem; onClose: () => void }) {
  const toTitleCase = (str: string) => str.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, l => l.toUpperCase())

  const renderPayload = (payload: any): React.ReactElement => {
    if (!payload || typeof payload !== 'object') return <div>Specific Data: Empty</div>

    const renderValue = (value: any, indent = 0): React.ReactElement | string => {
      if (value === null) return 'null'
      if (typeof value === 'boolean') return value ? 'true' : 'false'
      if (typeof value === 'string' || typeof value === 'number') return String(value)
      if (Array.isArray(value)) {
        return <ul style={{ margin: 0, paddingLeft: 20 }}>{value.map((item, i) => <li key={i}>{renderValue(item, indent)}</li>)}</ul>
      }
      if (typeof value === 'object') {
        return <div style={{ marginLeft: indent * 20 }}>{Object.entries(value).map(([k, v]) => <div key={k}><strong>{toTitleCase(k)}:</strong> {renderValue(v, indent + 1)}</div>)}</div>
      }
      return String(value)
    }

    return <div>{Object.entries(payload).map(([k, v]) => <div key={k}><strong>{toTitleCase(k)}:</strong> {renderValue(v)}</div>)}</div>
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center' }}>
      <div style={{ width: '100%', maxWidth: 800, background: '#fff', borderRadius: 16, boxShadow: '0 4px 16px rgba(0,0,0,0.15)', padding: 24, display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '80vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827' }}>
            {item.id}
          </h2>
          <button onClick={onClose} style={{ ...secondaryBtn, padding: '6px 10px' }}>×</button>
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <div><strong>Reference:</strong> {item.reference ?? 'N/A'}</div>
          <div><strong>Status:</strong> <StatusBadge status={item.status} /></div>
          <div><strong>Priority:</strong> {item.priority}</div>
          <div><strong>Retries:</strong> {item.retries}</div>
          <div><strong>Created At:</strong> {new Date(item.createdAt).toLocaleString()}</div>
          <div><strong>Updated At:</strong> {item.updatedAt ? new Date(item.updatedAt).toLocaleString() : 'N/A'}</div>
          <div>
            <strong>Specific Data:</strong>
            {renderPayload(item.payload)}
          </div>
        </div>
      </div>
    </div>
  )
}

type FormValues = { reference?: string; priority?: number; payload?: Record<string, unknown>; payloadText?: string }

const input: React.CSSProperties = { padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', width: '100%', maxWidth: '100%', boxSizing: 'border-box' }
const label: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 6 }
const primaryBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#2563eb', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' }
const secondaryBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#e5e7eb', color: '#111827', border: 'none', fontWeight: 600, cursor: 'pointer' }
const dangerBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#dc2626', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' }