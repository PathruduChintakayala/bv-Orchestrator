import { useEffect, useState } from "react";
import type { Package } from "../types/package";
import { fetchPackages, uploadPackage, deletePackage } from "../api/packages";

export default function PackagesPage() {
  const [items, setItems] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) { window.location.hash = "#/"; return; }
    load();
  }, []);

  async function load(s?: string) {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchPackages(s ? { search: s } : undefined);
      setItems(data);
    } catch (e: any) {
      setError(e.message || "Failed to load packages");
    } finally {
      setLoading(false);
    }
  }

  function openUpload() { setModalOpen(true); }
  function closeModal() { setModalOpen(false); }

  async function handleUpload(values: UploadValues) {
    try {
      await uploadPackage(values.file!, values.name || undefined, values.version || undefined);
      closeModal();
      await load(search);
    } catch (e: any) {
      alert(e.message || "Upload failed");
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this package?")) return;
    try {
      await deletePackage(id);
      await load(search);
    } catch (e: any) {
      alert(e.message || "Delete failed");
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827' }}>Packages</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search packages…" style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb' }} />
          <button onClick={()=>load(search)} style={secondaryBtn}>Search</button>
          <button onClick={openUpload} style={primaryBtn}>Upload Package</button>
        </div>
      </div>

      <div style={{ backgroundColor: '#fff', borderRadius: 12, boxShadow: '0 10px 24px rgba(15,23,42,0.08)', padding: 16 }}>
        {loading ? <p>Loading…</p> : error ? <p style={{color:'#b91c1c'}}>{error}</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', fontSize: 12, color: '#6b7280' }}>
                <th style={{ paddingBottom: 8 }}>Name</th>
                <th style={{ paddingBottom: 8 }}>Version</th>
                <th style={{ paddingBottom: 8 }}>Scripts</th>
                <th style={{ paddingBottom: 8 }}>Active</th>
                <th style={{ paddingBottom: 8 }}>Updated</th>
                <th style={{ paddingBottom: 8 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(p => (
                <tr key={p.id} style={{ fontSize: 14, color: '#111827' }}>
                  <td style={{ padding: '6px 0' }}>{p.name}</td>
                  <td style={{ padding: '6px 0' }}>{p.version}</td>
                  <td style={{ padding: '6px 0', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.scripts.join(', ')}</td>
                  <td style={{ padding: '6px 0' }}>{p.isActive ? 'Yes' : 'No'}</td>
                  <td style={{ padding: '6px 0' }}>{new Date(p.updatedAt).toLocaleString()}</td>
                  <td style={{ padding: '6px 0' }}>
                    <button style={dangerBtn} onClick={()=>handleDelete(p.id)}>Delete</button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={6} style={{ paddingTop: 12, color: '#6b7280' }}>No packages found</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {modalOpen && (
        <UploadModal onCancel={closeModal} onSave={handleUpload} />
      )}
    </div>
  );
}

function UploadModal({ onCancel, onSave }: { onCancel: ()=>void; onSave:(v:UploadValues)=>void }) {
  const [form, setForm] = useState<UploadValues>({ file: null, name: '', version: '' });
  const [saving, setSaving] = useState(false);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files && e.target.files[0] ? e.target.files[0] : null;
    setForm(prev => ({ ...prev, file: f }));
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target as any;
    setForm(prev => ({ ...prev, [name]: value }));
  }

  function validate(): string | null {
    if (!form.file) return 'Zip file is required';
    if (!form.file.name.toLowerCase().endsWith('.zip')) return 'File must be a .zip';
    const ver = (form.version || '').trim();
    if (ver && !/^\d+\.\d+\.\d+$/.test(ver)) return 'Version must be X.X.X';
    if (!form.name && !ver) {
      const base = form.file.name.replace(/\.zip$/i, '');
      if (!/^[A-Za-z0-9_-]+_\d+\.\d+\.\d+$/.test(base)) return 'Filename must be name_version.zip or provide Name/Version';
    }
    return null;
  }

  async function submit() {
    const err = validate();
    if (err) { alert(err); return; }
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
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 12 }}>Upload Package</h2>
        <div style={{ display: 'grid', gap: 10 }}>
          <label>
            <div style={label}>Zip File</div>
            <input type="file" accept=".zip" onChange={onFile} style={input} />
          </label>
          <label>
            <div style={label}>Name (optional)</div>
            <input name="name" value={form.name || ''} onChange={handleChange} style={input} placeholder="If blank, derived from filename" />
          </label>
          <label>
            <div style={label}>Version (optional)</div>
            <input name="version" value={form.version || ''} onChange={handleChange} style={input} placeholder="e.g. 1.2.0; if blank, derived from filename" />
          </label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button onClick={onCancel} style={secondaryBtn}>Cancel</button>
          <button onClick={submit} disabled={saving} style={primaryBtn}>{saving ? 'Uploading…' : 'Upload'}</button>
        </div>
      </div>
    </div>
  );
}

type UploadValues = {
  file: File | null;
  name?: string;
  version?: string;
};

const input: React.CSSProperties = { padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', width: '100%', maxWidth: '100%', boxSizing: 'border-box' };
const label: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 6 };
const primaryBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#2563eb', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' };
const secondaryBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#e5e7eb', color: '#111827', border: 'none', fontWeight: 600, cursor: 'pointer' };
const dangerBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#dc2626', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' };
