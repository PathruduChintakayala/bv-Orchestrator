import React, { useEffect, useMemo, useState } from "react";
import { fetchAudit, fetchAuditDetail } from "../api/audit";
import type { AuditItem, AuditDetail } from "../types/audit";

export default function AuditPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<AuditItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [search, setSearch] = useState("")
  const [fromTime, setFromTime] = useState("")
  const [toTime, setToTime] = useState("")
  const [actionType, setActionType] = useState("")
  const [user, setUser] = useState("")
  const [entityType, setEntityType] = useState("")
  const [selected, setSelected] = useState<AuditDetail | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetchAudit({
        search: search.trim() || undefined,
        fromTime: fromTime || undefined,
        toTime: toTime || undefined,
        actionType: actionType || undefined,
        user: user || undefined,
        entityType: entityType || undefined,
        page,
        pageSize,
      })
      setItems(res.items)
      setTotal(res.total)
      setPage(res.page)
      setPageSize(res.pageSize)
    } catch (e: any) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [page, pageSize])

  const pages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize])

  function openDetail(id: number) {
    fetchAuditDetail(id).then(setSelected).catch(() => {})
  }

  return (
    <div style={{ padding: 16 }}>
      <div className="page-shell" style={{ gap: 12 }}>
        <div className="surface-card" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h1 className="page-title" style={{ margin: 0 }}>Audit</h1>
          </div>
        </div>

        <div style={{ backgroundColor: '#fff', borderRadius: 12, boxShadow: '0 10px 24px rgba(15,23,42,0.08)', padding: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." style={inputStyle} />
          <input type="datetime-local" value={fromTime} onChange={e => setFromTime(e.target.value)} style={inputStyle} />
          <input type="datetime-local" value={toTime} onChange={e => setToTime(e.target.value)} style={inputStyle} />
          <select value={actionType} onChange={e => setActionType(e.target.value)} style={inputStyle as React.CSSProperties}>
            <option value="">Any action</option>
            {ACTION_TYPES.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <input value={user} onChange={e => setUser(e.target.value)} placeholder="User" style={inputStyle} />
          <select value={entityType} onChange={e => setEntityType(e.target.value)} style={inputStyle as React.CSSProperties}>
            <option value="">Any entity</option>
            {ENTITY_TYPES.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <button onClick={() => { setPage(1); load(); }} style={primaryBtn}>Apply</button>
          <button onClick={() => {
            setSearch(""); setFromTime(""); setToTime(""); setActionType(""); setUser(""); setEntityType(""); setPage(1); load();
          }} style={secondaryBtn}>Clear</button>
          <button onClick={() => load()} title="Refresh" style={{ ...secondaryBtn, padding: '10px', fontSize: '16px' }}>↻</button>
        </div>
        </div>

        <div style={{ backgroundColor: '#fff', borderRadius: 12, boxShadow: '0 10px 24px rgba(15,23,42,0.08)', padding: 16 }}>
        {loading ? (
          <div>Loading…</div>
        ) : error ? (
          <div style={{ color: '#b91c1c' }}>{error}</div>
        ) : (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', fontSize: 12, color: '#6b7280' }}>
                  <th style={th}>Time</th>
                  <th style={th}>User</th>
                  <th style={th}>Action</th>
                  <th style={th}>Entity</th>
                  <th style={th}>Details</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} style={{ fontSize: 14, color: '#111827', cursor: 'pointer' }} onClick={() => openDetail(it.id)}>
                    <td style={td}>{fmt(it.timestamp)}</td>
                    <td style={td}>{it.actorUsername || '—'}</td>
                    <td style={td}>{friendlyAction(it.actionType || it.action)}</td>
                    <td style={td}>{it.entityDisplay || [it.entityType, it.entityName || it.entityId].filter(Boolean).join(' / ') || '—'}</td>
                    <td style={td} title={it.message || it.summary || undefined}>{it.message || it.summary || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
              <div style={{ color: '#6b7280', fontSize: 12 }}>Total: {total}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} style={secondaryBtn}>Prev</button>
                <span style={{ fontSize: 12, color: '#374151' }}>Page {page} / {pages}</span>
                <button disabled={page >= pages} onClick={() => setPage(p => Math.min(pages, p + 1))} style={secondaryBtn}>Next</button>
              </div>
            </div>
          </>
        )}
        </div>

        {selected && (
        <div style={modalBackdrop} onClick={() => setSelected(null)}>
          <div style={modal} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827' }}>Event #{selected.id}</h2>
              <button onClick={() => setSelected(null)} style={secondaryBtn}>Close</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <KV k="Time" v={selected.timestamp} />
              <KV k="User" v={selected.actorUsername || '—'} />
              <KV k="Action" v={selected.action} />
              <KV k="Entity" v={[selected.entityType, selected.entityName || selected.entityId].filter(Boolean).join(' / ') || '—'} />
              <KV k="IP" v={selected.ipAddress || '—'} />
              <KV k="Agent" v={selected.userAgent || '—'} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <h3 style={subhead}>Before</h3>
                <Pre data={selected.beforeData} />
              </div>
              <div>
                <h3 style={subhead}>After</h3>
                <Pre data={selected.afterData} />
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <h3 style={subhead}>Metadata</h3>
              <Pre data={selected.metadata} />
            </div>
          </div>
          </div>
        )}
      </div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <div style={{ minWidth: 100, color: '#6b7280', fontSize: 12 }}>{k}</div>
      <div style={{ color: '#111827', fontSize: 14 }}>{v}</div>
    </div>
  )
}

function Pre({ data }: { data: any }) {
  return (
    <pre style={{ background: '#f9fafb', padding: 10, borderRadius: 8, fontSize: 12, maxHeight: 220, overflow: 'auto' }}>
      {typeof data === 'string' ? data : JSON.stringify(data ?? {}, null, 2)}
    </pre>
  )
}

const th: React.CSSProperties = { paddingBottom: 8 }
const td: React.CSSProperties = { padding: '6px 0', borderTop: '1px solid #f3f4f6' }
const primaryBtn: React.CSSProperties = { padding: '8px 12px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }
const secondaryBtn: React.CSSProperties = { padding: '8px 12px', background: '#e5e7eb', color: '#111827', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }
const inputStyle: React.CSSProperties = { padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 8, minWidth: 220 }
const subhead: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: '#374151', margin: '0 0 6px 0' }
const modalBackdrop: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center' }
const modal: React.CSSProperties = { width: '90%', maxWidth: 900, background: '#fff', borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', padding: 16 }

function fmt(ts: string) {
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ts
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const s = String(d.getSeconds()).padStart(2, '0')
  return `${y}-${m}-${day} ${h}:${mi}:${s}`
}

function friendlyAction(s: string) {
  if (!s) return '—'
  return s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
}

const ACTION_TYPES: { value: string; label: string }[] = [
  { value: 'created', label: 'Created' },
  { value: 'modified', label: 'Modified' },
  { value: 'deleted', label: 'Deleted' },
  { value: 'status_changed', label: 'Status Changed' },
]

const ENTITY_TYPES: { value: string; label: string }[] = [
  { value: 'asset', label: 'Asset' },
  { value: 'process', label: 'Process' },
  { value: 'package', label: 'Package' },
  { value: 'robot', label: 'Robot' },
  { value: 'job', label: 'Job' },
  { value: 'queue', label: 'Queue' },
  { value: 'queue_item', label: 'Queue Item' },
  { value: 'user', label: 'User' },
  { value: 'role', label: 'Role' },
  { value: 'setting', label: 'Setting' },
]

