import { useEffect, useState } from "react";
import type { Robot, RobotStatus } from "../types/robot";
import { fetchRobots, createRobot, updateRobot, deleteRobot } from "../api/robots";
import { fetchMachines } from "../api/machines";
import type { Machine } from "../types/machine";

export default function RobotsPage() {
  const [items, setItems] = useState<Robot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Robot | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    load();
  }, []);

  async function load(s?: string) {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchRobots(s ? { search: s } : undefined);
      setItems(data);
    } catch (e: any) {
      setError(e.message || "Failed to load robots");
    } finally {
      setLoading(false);
    }
  }

  function openNew() { setEditing(null); setModalOpen(true); }
  function openEdit(r: Robot) { setEditing(r); setModalOpen(true); }
  function closeModal() { setModalOpen(false); setEditing(null); }

  async function handleSave(values: FormValues) {
    try {
      if (editing) {
        await updateRobot(editing.id, { status: values.status, machineId: values.machineId ?? null, machineInfo: values.machineInfo || null });
      } else {
        const u = (values.credentialUsername || '').trim();
        const p = (values.credentialPassword || '').trim();
        await createRobot({
          name: values.name,
          machineId: values.machineId ?? undefined,
          machineInfo: values.machineInfo || undefined,
          credential: u && p ? { username: u, password: p } : undefined,
        });
      }
      closeModal();
      await load(search);
    } catch (e: any) {
      alert(e.message || "Save failed");
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this robot?")) return;
    try {
      await deleteRobot(id);
      await load(search);
    } catch (e: any) {
      alert(e.message || "Delete failed");
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827' }}>Robots</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={()=>load(search)} style={secondaryBtn} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search robots…" style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb' }} />
          <button onClick={()=>load(search)} style={secondaryBtn}>Search</button>
          <button onClick={openNew} style={primaryBtn}>New Robot</button>
        </div>
      </div>

      <div style={{ backgroundColor: '#fff', borderRadius: 12, boxShadow: '0 10px 24px rgba(15,23,42,0.08)', padding: 16 }}>
        {loading ? <p>Loading…</p> : error ? <p style={{color:'#b91c1c'}}>{error}</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', fontSize: 12, color: '#6b7280' }}>
                <th style={{ paddingBottom: 8 }}>Name</th>
                <th style={{ paddingBottom: 8 }}>Status</th>
                <th style={{ paddingBottom: 8 }}>Last heartbeat</th>
                <th style={{ paddingBottom: 8 }}>Current job</th>
                <th style={{ paddingBottom: 8 }}>Machine</th>
                <th style={{ paddingBottom: 8 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(r => (
                <tr key={r.id} style={{ fontSize: 14, color: '#111827' }}>
                  <td style={{ padding: '6px 0' }}>{r.name}</td>
                  <td style={{ padding: '6px 0' }}>
                    <span style={{ padding: '4px 8px', borderRadius: 999, backgroundColor: r.status === 'online' ? '#dcfce7' : '#e5e7eb', color: r.status === 'online' ? '#166534' : '#374151' }}>{r.status}</span>
                  </td>
                  <td style={{ padding: '6px 0' }}>{r.lastHeartbeat ? new Date(r.lastHeartbeat).toLocaleString() : '—'}</td>
                  <td style={{ padding: '6px 0' }}>{r.currentJobId ?? '—'}</td>
                  <td style={{ padding: '6px 0', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.machineInfo ?? '—'}</td>
                  <td style={{ padding: '6px 0' }}>
                    <button style={secondaryBtn} onClick={()=>openEdit(r)}>Edit</button>{' '}
                    <button style={dangerBtn} onClick={()=>handleDelete(r.id)}>Delete</button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={6} style={{ paddingTop: 12, color: '#6b7280' }}>No robots found</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {modalOpen && (
        <RobotModal initial={editing} onCancel={closeModal} onSave={handleSave} />
      )}
    </div>
  );
}

function RobotModal({ initial, onCancel, onSave }: { initial: Robot | null; onCancel: ()=>void; onSave:(v:FormValues)=>void }) {
  const [form, setForm] = useState<FormValues>({
    name: initial?.name || "",
    status: initial?.status || "offline",
    machineInfo: initial?.machineInfo || "",
    machineId: initial?.machineId ?? null,
    credentialUsername: "",
    credentialPassword: "",
  });
  const [saving, setSaving] = useState(false);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loadingMachines, setLoadingMachines] = useState(false);
  const [machineError, setMachineError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) return;
    (async () => {
      try {
        setLoadingMachines(true);
        setMachineError(null);
        const ms = await fetchMachines();
        setMachines(ms);
      } catch (e: any) {
        setMachineError(e.message || "Failed to load machines");
      } finally {
        setLoadingMachines(false);
      }
    })();
  }, [initial]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = e.target as any;
    setForm(prev => ({ ...prev, [name]: value }));
  }

  async function submit() {
    if (!initial && !form.name.trim()) { alert('Name is required'); return; }
    if (!initial) {
      const u = (form.credentialUsername || '').trim();
      const p = (form.credentialPassword || '').trim();
      if ((u && !p) || (!u && p)) {
        alert('Provide both username and password, or leave both empty');
        return;
      }
    }
    try {
      setSaving(true);
      await onSave(form);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center' }}>
      <div style={{ width: '100%', maxWidth: 600, background: '#fff', borderRadius: 16, boxShadow: '0 4px 16px rgba(0,0,0,0.15)', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 12 }}>{initial ? 'Edit Robot' : 'New Robot'}</h2>
        <div style={{ display: 'grid', gap: 10 }}>
          {!initial && (
            <label>
              <div style={label}>Name</div>
              <input name="name" value={form.name} onChange={handleChange} style={input} />
            </label>
          )}
          {!initial && (
            <label>
              <div style={label}>Machine</div>
              <select
                name="machineId"
                value={form.machineId ?? ''}
                onChange={(e) => {
                  const v = (e.target as HTMLSelectElement).value;
                  setForm(prev => ({ ...prev, machineId: v ? Number(v) : null }));
                }}
                style={input}
                disabled={loadingMachines}
              >
                <option value="">— Select machine —</option>
                {machines.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              {machineError && <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 6 }}>{machineError}</div>}
            </label>
          )}
          <label>
            <div style={label}>Status</div>
            <select name="status" value={form.status} onChange={handleChange} style={input}>
              {(['offline','online'] as RobotStatus[]).map(s=> <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label>
            <div style={label}>Machine Info</div>
            <input name="machineInfo" value={form.machineInfo || ''} onChange={handleChange} style={input} />
          </label>
          {!initial && (
            <>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Unattended credentials (optional)</div>
              <label>
                <div style={label}>Username</div>
                <input name="credentialUsername" value={form.credentialUsername || ''} onChange={handleChange} style={input} />
              </label>
              <label>
                <div style={label}>Password</div>
                <input name="credentialPassword" type="password" value={form.credentialPassword || ''} onChange={handleChange} style={input} />
              </label>
            </>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button onClick={onCancel} style={secondaryBtn}>Cancel</button>
          <button onClick={submit} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

type FormValues = {
  name: string;
  status: RobotStatus;
  machineId?: number | null;
  machineInfo?: string | null;
  credentialUsername?: string;
  credentialPassword?: string;
};

const input: React.CSSProperties = { padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', width: '100%', maxWidth: '100%', boxSizing: 'border-box' };
const label: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 6 };
const primaryBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#2563eb', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' };
const secondaryBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#e5e7eb', color: '#111827', border: 'none', fontWeight: 600, cursor: 'pointer' };
const dangerBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#dc2626', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' };
