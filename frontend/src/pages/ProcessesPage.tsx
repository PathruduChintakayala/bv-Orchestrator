import { useEffect, useState } from "react";
import type { Process } from "../types/processes";
import { fetchProcesses, createProcess, updateProcess, deleteProcess } from "../api/processes";
import { fetchPackages } from "../api/packages";

export default function ProcessesPage() {
  const [items, setItems] = useState<Process[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Process | null>(null);
  const [packages, setPackages] = useState<import('../types/package').Package[]>([]);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) { window.location.hash = "#/"; return; }
    load();
    // preload active packages for selection
    fetchPackages({ activeOnly: true }).then(setPackages).catch(()=>{});
  }, []);

  async function load(s?: string) {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchProcesses(s ? { search: s } : undefined);
      setItems(data);
    } catch (e: any) {
      setError(e.message || "Failed to load processes");
    } finally {
      setLoading(false);
    }
  }

  function openNew() { setEditing(null); setModalOpen(true); }
  function openEdit(p: Process) { setEditing(p); setModalOpen(true); }
  function closeModal() { setModalOpen(false); setEditing(null); }

  async function handleSave(values: FormValues) {
    try {
      const payload = {
        name: values.name,
        scriptPath: values.scriptPath,
        description: values.description || undefined,
        isActive: values.isActive,
      };
      if (editing) {
        await updateProcess(editing.id, payload);
      } else {
        await createProcess(payload);
      }
      closeModal();
      await load(search);
    } catch (e: any) {
      alert(e.message || "Save failed");
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this process?")) return;
    try {
      await deleteProcess(id);
      await load(search);
    } catch (e: any) {
      alert(e.message || "Delete failed");
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827' }}>Processes</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search processes…" style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb' }} />
          <button onClick={()=>load(search)} style={secondaryBtn}>Search</button>
          <button onClick={openNew} style={primaryBtn}>New Process</button>
        </div>
      </div>

      <div style={{ backgroundColor: '#fff', borderRadius: 12, boxShadow: '0 10px 24px rgba(15,23,42,0.08)', padding: 16 }}>
        {loading ? <p>Loading…</p> : error ? <p style={{color:'#b91c1c'}}>{error}</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', fontSize: 12, color: '#6b7280' }}>
                <th style={{ paddingBottom: 8 }}>Name</th>
                <th style={{ paddingBottom: 8 }}>Script</th>
                <th style={{ paddingBottom: 8 }}>Active</th>
                <th style={{ paddingBottom: 8 }}>Version</th>
                <th style={{ paddingBottom: 8 }}>Updated</th>
                <th style={{ paddingBottom: 8 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(p => (
                <tr key={p.id} style={{ fontSize: 14, color: '#111827' }}>
                  <td style={{ padding: '6px 0' }}>{p.name}</td>
                  <td style={{ padding: '6px 0', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.scriptPath}</td>
                  <td style={{ padding: '6px 0' }}>{p.isActive ? 'Yes' : 'No'}</td>
                  <td style={{ padding: '6px 0' }}>{p.version}</td>
                  <td style={{ padding: '6px 0' }}>{new Date(p.updatedAt).toLocaleString()}</td>
                  <td style={{ padding: '6px 0' }}>
                    <button style={secondaryBtn} onClick={()=>openEdit(p)}>Edit</button>{' '}
                    <button style={dangerBtn} onClick={()=>handleDelete(p.id)}>Delete</button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={6} style={{ paddingTop: 12, color: '#6b7280' }}>No processes found</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {modalOpen && (
        <ProcessModal
          initial={editing || null}
          onCancel={closeModal}
          onSave={handleSave}
          packages={packages}
        />
      )}
    </div>
  );
}

function ProcessModal({ initial, onCancel, onSave, packages }: { initial: Process | null; onCancel: ()=>void; onSave:(v:FormValues)=>void; packages: import('../types/package').Package[] }) {
  const [form, setForm] = useState<FormValues>({
    name: initial?.name || "",
    packageId: initial?.packageId ?? undefined,
    scriptPath: initial?.scriptPath || "",
    description: initial?.description || "",
    isActive: initial?.isActive ?? true,
  });
  const [saving, setSaving] = useState(false);

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const { name, value } = e.target as any;
    setForm(prev => ({ ...prev, [name]: value }));
  }

  function toggleActive() { setForm(prev => ({ ...prev, isActive: !prev.isActive })); }

  async function submit() {
    if (!form.name.trim()) { alert('Name is required'); return; }
    if (!form.scriptPath.trim()) { alert('Script Path is required'); return; }
    try {
      setSaving(true);
      await onSave(form);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center' }}>
      <div style={{
        width: '100%',
        maxWidth: 600,
        background: '#fff',
        borderRadius: 16,
        boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 12 }}>{initial ? 'Edit Process' : 'New Process'}</h2>
        <div style={{ display: 'grid', gap: 10 }}>
          <label>
            <div style={label}>Name</div>
            <input name="name" value={form.name} onChange={handleChange} style={input} />
          </label>
          <label>
            <div style={label}>Package</div>
            <select name="packageId" value={form.packageId ?? ''} onChange={handleChange} style={input}>
              <option value="">(none)</option>
              {packages.map(p => (
                <option key={p.id} value={p.id}>{p.name} ({p.version})</option>
              ))}
            </select>
          </label>
          <label>
            <div style={label}>Script Path</div>
            <input name="scriptPath" value={form.scriptPath} onChange={handleChange} style={input} />
          </label>
          <label>
            <div style={label}>Description</div>
            <textarea name="description" value={form.description || ''} onChange={handleChange} style={{...input, minHeight: 60}} />
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={form.isActive} onChange={toggleActive} />
            <span>Active</span>
          </label>
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
  packageId?: number;
  scriptPath: string;
  description?: string | null;
  isActive: boolean;
};

const input: React.CSSProperties = { padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', width: '100%', maxWidth: '100%', boxSizing: 'border-box' };
const label: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 6 };
const primaryBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#2563eb', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' };
const secondaryBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#e5e7eb', color: '#111827', border: 'none', fontWeight: 600, cursor: 'pointer' };
const dangerBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#dc2626', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' };
