import { useEffect, useState } from "react";
import type { Asset, AssetType } from "../types/assets";
import { fetchAssets, createAsset, updateAsset, deleteAsset } from "../api/assets";

export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [canCreate, setCanCreate] = useState(true);
  const [canEdit, setCanEdit] = useState(true);
  const [canDelete, setCanDelete] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) { window.location.hash = "#/"; return; }
    try {
      const cuRaw = localStorage.getItem('currentUser') || 'null'
      const cu = JSON.parse(cuRaw)
      if (cu?.is_admin) {
        setCanCreate(true)
        setCanEdit(true)
        setCanDelete(true)
      } else {
        const pm = JSON.parse(localStorage.getItem('permissions') || '{}')
        setCanCreate(!!pm['assets:create'])
        setCanEdit(!!pm['assets:edit'])
        setCanDelete(!!pm['assets:delete'])
      }
    } catch {
      // If permissions are not yet hydrated, allow actions and rely on backend RBAC
      setCanCreate(true)
      setCanEdit(true)
      setCanDelete(true)
    }
    load();
  }, []);

  async function load(s?: string) {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchAssets(s);
      setAssets(data);
    } catch (e: any) {
      setError(e.message || "Failed to load assets");
    } finally {
      setLoading(false);
    }
  }

  function openNew() { setEditing(null); setModalOpen(true); }
  function openEdit(a: Asset) { setEditing(a); setModalOpen(true); }
  function closeModal() { setModalOpen(false); setEditing(null); }

  async function handleSave(values: FormValues) {
    try {
      const payload = normalizePayload(values);
      if (editing) {
        await updateAsset(editing.id, payload as any);
      } else {
        await createAsset(payload as any);
      }
      closeModal();
      await load(search);
    } catch (e: any) {
      alert(e.message || "Save failed");
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this asset?")) return;
    try {
      await deleteAsset(id);
      await load(search);
    } catch (e: any) {
      alert(e.message || "Delete failed");
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827' }}>Assets</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search assets…" style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb' }} />
          <button onClick={()=>load(search)} style={secondaryBtn}>Search</button>
          <button onClick={openNew} style={{...primaryBtn, opacity: canCreate ? 1 : 0.6, cursor: canCreate ? 'pointer' : 'not-allowed'}} disabled={!canCreate}>New Asset</button>
        </div>
      </div>

      <div style={{ backgroundColor: '#fff', borderRadius: 12, boxShadow: '0 10px 24px rgba(15,23,42,0.08)', padding: 16 }}>
        {loading ? <p>Loading…</p> : error ? <p style={{color:'#b91c1c'}}>{error}</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', fontSize: 12, color: '#6b7280' }}>
                <th style={{ paddingBottom: 8 }}>Name</th>
                <th style={{ paddingBottom: 8 }}>Type</th>
                <th style={{ paddingBottom: 8 }}>Value</th>
                <th style={{ paddingBottom: 8 }}>Description</th>
                <th style={{ paddingBottom: 8 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {assets.map(a => (
                <tr key={a.id} style={{ fontSize: 14, color: '#111827' }}>
                  <td style={{ padding: '6px 0' }}>{a.name}</td>
                  <td style={{ padding: '6px 0' }}>{a.type}</td>
                  <td style={{ padding: '6px 0' }}>{a.type === 'secret' ? '••••••' : a.type === 'credential' ? (a.username || '') : a.value}</td>
                  <td style={{ padding: '6px 0', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.description || ''}</td>
                  <td style={{ padding: '6px 0' }}>
                    <button style={{...secondaryBtn, opacity: canEdit ? 1 : 0.6, cursor: canEdit ? 'pointer' : 'not-allowed'}} onClick={()=>openEdit(a)} disabled={!canEdit}>Edit</button>{' '}
                    <button style={{...dangerBtn, opacity: canDelete ? 1 : 0.6, cursor: canDelete ? 'pointer' : 'not-allowed'}} onClick={()=>handleDelete(a.id)} disabled={!canDelete}>Delete</button>
                  </td>
                </tr>
              ))}
              {assets.length === 0 && (
                <tr><td colSpan={5} style={{ paddingTop: 12, color: '#6b7280' }}>No assets found</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {modalOpen && (
        <AssetModal
          initial={editing || null}
          onCancel={closeModal}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

function AssetModal({ initial, onCancel, onSave }: { initial: Asset | null; onCancel: ()=>void; onSave:(v:FormValues)=>void }) {
  const [form, setForm] = useState<FormValues>({
    name: initial?.name || "",
    type: (initial?.type as AssetType) || "text",
    value: initial?.value || "",
    description: initial?.description || "",
    credUser: initial?.type === 'credential' ? (initial?.username || '') : '',
    credPass: '',
  });
  const [saving, setSaving] = useState(false);

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const { name, value, type } = e.target as any;
    setForm(prev => {
      const next = { ...prev, [name]: value } as FormValues;
      if (name === 'type') {
        next.value = '';
        next.credUser = '';
        next.credPass = '';
      }
      return next;
    });
  }

  async function submit() {
    if (!form.name.trim()) { alert('Name is required'); return; }
    if (!form.type) { alert('Type is required'); return; }
    if (form.type === 'credential') {
      if (!(form.credUser || '').trim()) { alert('Username is required'); return; }
      // Require password both on create and edit for credentials
      if (!(form.credPass || '').trim()) { alert('Password is required'); return; }
    } else {
      if (!form.value.trim()) { alert('Value is required'); return; }
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
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 12 }}>{initial ? 'Edit Asset' : 'New Asset'}</h2>
        <div style={{ display: 'grid', gap: 10 }}>
          <label>
            <div style={label}>Name</div>
            <input name="name" value={form.name} onChange={handleChange} disabled={!!initial} style={input} />
          </label>
          <label>
            <div style={label}>Type</div>
            <select name="type" value={form.type} onChange={handleChange} style={input}>
              {['text','int','bool','credential','secret'].map(t=> <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
            {form.type === 'bool' ? (
              <div>
                <div style={label}>Value</div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="radio" name="boolValue" checked={form.value === 'true'} onChange={()=>setForm(prev=>({...prev, value: 'true'}))} />
                    <span>True</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="radio" name="boolValue" checked={form.value === 'false'} onChange={()=>setForm(prev=>({...prev, value: 'false'}))} />
                    <span>False</span>
                  </label>
                </div>
              </div>
            ) : form.type === 'credential' ? (
              <div style={{ display: 'grid', gap: 16 }}>
                <label className="modal-field">
                  <div style={label}>Username</div>
                  <input name="credUser" value={form.credUser || ''} onChange={e=>setForm(prev=>({...prev, credUser: e.target.value}))} style={input} />
                </label>
                <label className="modal-field">
                  <div style={label}>Password</div>
                  <input type="password" name="credPass" value={form.credPass || ''} onChange={e=>setForm(prev=>({...prev, credPass: e.target.value}))} style={input} placeholder={initial ? 'Leave blank to keep current' : ''} />
                </label>
              </div>
            ) : (
              <label className="modal-field">
                <div style={label}>{form.type === 'secret' ? 'Secret value' : 'Value'}</div>
                <input name="value" value={form.value} onChange={handleChange} style={input} type={form.type === 'secret' ? 'password' : 'text'} />
              </label>
            )}
          {/* isSecret checkbox removed for all types as requested */}
          <label className="modal-field">
            <div style={label}>Description</div>
            <textarea name="description" value={form.description || ''} onChange={handleChange} style={{...input, minHeight: 60}} />
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
  type: AssetType;
  value: string;
  description?: string | null;
  credUser?: string;
  credPass?: string;
};

function normalizePayload(values: FormValues) {
  const { type } = values;
  if (type === 'credential') {
    return {
      name: values.name,
      type,
      username: values.credUser || '',
      password: values.credPass || '',
      description: values.description || null,
    };
  }
  if (type === 'secret') {
    return {
      name: values.name,
      type,
      value: values.value,
      description: values.description || null,
    };
  }
  if (type === 'bool') {
    return {
      name: values.name,
      type,
      value: values.value === 'true' ? 'true' : 'false',
      description: values.description || null,
    };
  }
  return {
    name: values.name,
    type,
    value: values.value,
    description: values.description || null,
  };
}

const input: React.CSSProperties = { padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', width: '100%', maxWidth: '100%', boxSizing: 'border-box' };
const label: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 6 };
const primaryBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#2563eb', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' };
const secondaryBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#e5e7eb', color: '#111827', border: 'none', fontWeight: 600, cursor: 'pointer' };
const dangerBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#dc2626', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' };
