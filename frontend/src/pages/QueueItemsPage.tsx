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
  const [modalOpen, setModalOpen] = useState(false)
  const [queues, setQueues] = useState<import('../types/queue').Queue[]>([])
  const [selectedItem, setSelectedItem] = useState<QueueItem | null>(null)

  useEffect(() => {
    const hash = window.location.hash || '#/queue-items'
    const url = new URL(hash.replace('#',''), 'http://localhost')
    const qid = url.searchParams.get('queueId')
    setQueueId(qid ? Number(qid) : null)
    fetchQueues().then(setQueues).catch(()=>{})
  }, [])

  useEffect(() => { load() }, [queueId, status])

  async function load() {
    try {
      setLoading(true); setError(null)
      const data = await fetchQueueItems({ queueId: queueId ?? undefined, status: status || undefined as any })
      setItems(data)
    } catch (e: any) {
      setError(e.message || 'Failed to load items')
    } finally { setLoading(false) }
  }

  function openNew() { setModalOpen(true) }
  function closeModal() { setModalOpen(false) }

  async function handleCreate(values: FormValues) {
    try {
      await createQueueItem({ queueId: values.queueId!, reference: values.reference || undefined, priority: values.priority ?? 0, payload: values.payload || undefined })
      closeModal(); await load()
    } catch (e: any) { alert(e.message || 'Create failed') }
  }

  async function markStatus(id: number, s: QueueItemStatus) {
    try { await updateQueueItem(id, { status: s }); await load() } catch (e: any) { alert(e.message || 'Update failed') }
  }

  const currentQueue = queues.find(q => q.id === queueId) || null

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827' }}>{currentQueue ? `${currentQueue.name} – Items` : 'Queue Items'}</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={queueId ?? ''} onChange={e=>setQueueId(e.target.value ? Number(e.target.value) : null)} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb' }}>
            <option value=''>All queues</option>
            {queues.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}
          </select>
          <select value={status} onChange={e=>setStatus(e.target.value as QueueItemStatus | '')} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb' }}>
            <option value=''>All statuses</option>
            {(['new','in_progress','completed','failed','abandoned'] as QueueItemStatus[]).map(s=> <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={openNew} style={primaryBtn}>New Item</button>
        </div>
      </div>

      <div style={{ backgroundColor: '#fff', borderRadius: 12, boxShadow: '0 10px 24px rgba(15,23,42,0.08)', padding: 16 }}>
        {loading ? <p>Loading...</p> : error ? <p style={{color:'#b91c1c'}}>{error}</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', fontSize: 12, color: '#6b7280' }}>
                <th style={{ paddingBottom: 8 }}>ID</th>
                <th style={{ paddingBottom: 8 }}>Queue</th>
                <th style={{ paddingBottom: 8 }}>Reference</th>
                <th style={{ paddingBottom: 8 }}>Status</th>
                <th style={{ paddingBottom: 8 }}>Priority</th>
                <th style={{ paddingBottom: 8 }}>Retries</th>
                <th style={{ paddingBottom: 8 }}>Created</th>
                <th style={{ paddingBottom: 8 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id} style={{ fontSize: 14, color: '#111827' }}>
                  <td style={{ padding: '6px 0' }}>{it.id}</td>
                  <td style={{ padding: '6px 0' }}>{queues.find(q => q.id === it.queueId)?.name ?? it.queueId}</td>
                  <td style={{ padding: '6px 0' }}>{it.reference ?? '-'}</td>
                  <td style={{ padding: '6px 0' }}>{it.status}</td>
                  <td style={{ padding: '6px 0' }}>{it.priority}</td>
                  <td style={{ padding: '6px 0' }}>{it.retries}</td>
                  <td style={{ padding: '6px 0' }}>{new Date(it.createdAt).toLocaleString()}</td>
                  <td style={{ padding: '6px 0' }}>
                    <button style={secondaryBtn} onClick={()=>setSelectedItem(it)}>View Details</button>{' '}
                    <button style={secondaryBtn} onClick={()=>markStatus(it.id, 'completed')}>Mark Completed</button>{' '}
                    <button style={dangerBtn} onClick={()=>markStatus(it.id, 'failed')}>Mark Failed</button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={8} style={{ paddingTop: 12, color: '#6b7280' }}>No items found</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {modalOpen && (
        <NewItemModal defaultQueueId={queueId ?? undefined} queues={queues} onCancel={closeModal} onSave={handleCreate} />
      )}

      {selectedItem && (
        <DetailsModal item={selectedItem} queueName={queues.find(q => q.id === selectedItem.queueId)?.name ?? 'Unknown'} onClose={() => setSelectedItem(null)} />
      )}
    </div>
  )
}

function NewItemModal({ defaultQueueId, queues, onCancel, onSave }: { defaultQueueId?: number; queues: import('../types/queue').Queue[]; onCancel: ()=>void; onSave:(v:FormValues)=>void }) {
  const [form, setForm] = useState<FormValues>({ queueId: defaultQueueId, reference: '', priority: 0, payloadText: '' })
  const [saving, setSaving] = useState(false)

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const { name, value } = e.target as any
    setForm(prev => ({ ...prev, [name]: name === 'queueId' || name === 'priority' ? (value ? Number(value) : undefined) : value }))
  }

  function parsePayload(): Record<string, unknown> | undefined {
    const t = (form.payloadText || '').trim()
    if (!t) return undefined
    try { return JSON.parse(t) } catch { alert('Payload must be valid JSON'); return undefined }
  }

  async function submit() {
    if (!form.queueId) { alert('Queue is required'); return }
    const payload = parsePayload()
    if (form.payloadText && !payload) return
    try { setSaving(true); await onSave({ queueId: form.queueId, reference: form.reference, priority: form.priority, payload }); } finally { setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center' }}>
      <div style={{ width: '100%', maxWidth: 640, background: '#fff', borderRadius: 16, boxShadow: '0 4px 16px rgba(0,0,0,0.15)', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 12 }}>New Item</h2>
        <div style={{ display: 'grid', gap: 10 }}>
          <label>
            <div style={label}>Queue</div>
            <select name='queueId' value={form.queueId ?? ''} onChange={handleChange} style={input}>
              <option value=''>Select a queue</option>
              {queues.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}
            </select>
          </label>
          <label>
            <div style={label}>Reference</div>
            <input name='reference' value={form.reference || ''} onChange={handleChange} style={input} />
          </label>
          <label>
            <div style={label}>Priority</div>
            <input name='priority' type='number' value={form.priority ?? 0} onChange={handleChange} style={input} />
          </label>
          <label>
            <div style={label}>Payload (JSON)</div>
            <textarea name='payloadText' value={form.payloadText || ''} onChange={handleChange} style={{...input, minHeight: 120}} placeholder='e.g. {"invoiceId":123}' />
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

function DetailsModal({ item, queueName, onClose }: { item: QueueItem; queueName: string; onClose: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center' }}>
      <div style={{ width: '100%', maxWidth: 800, background: '#fff', borderRadius: 16, boxShadow: '0 4px 16px rgba(0,0,0,0.15)', padding: 24, display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '80vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827' }}>
            {queueName} – Item {item.id} ({item.status})
          </h2>
          <button onClick={onClose} style={{ ...secondaryBtn, padding: '6px 10px' }}>×</button>
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <div><strong>Item ID:</strong> {item.id}</div>
          <div><strong>Status:</strong> {item.status}</div>
          <div><strong>Created At:</strong> {new Date(item.createdAt).toLocaleString()}</div>
          <div><strong>Updated At:</strong> {item.updatedAt ? new Date(item.updatedAt).toLocaleString() : 'N/A'}</div>
          <div>
            <strong>Payload:</strong>
            <pre style={{ background: '#f3f4f6', padding: 12, borderRadius: 8, fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap', wordWrap: 'break-word', maxHeight: 300, overflow: 'auto' }}>
              {item.payload ? JSON.stringify(item.payload, null, 2) : 'No payload'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}

type FormValues = { queueId?: number; reference?: string; priority?: number; payload?: Record<string, unknown>; payloadText?: string }

const input: React.CSSProperties = { padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', width: '100%', maxWidth: '100%', boxSizing: 'border-box' }
const label: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 6 }
const primaryBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#2563eb', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' }
const secondaryBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#e5e7eb', color: '#111827', border: 'none', fontWeight: 600, cursor: 'pointer' }
const dangerBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#dc2626', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' }
