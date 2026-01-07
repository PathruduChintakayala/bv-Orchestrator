import { useEffect, useState, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import type { Asset, AssetType } from "../types/assets";
import { fetchAssets, createAsset, updateAsset, deleteAsset } from "../api/assets";
import { useDialog } from "../components/DialogProvider";
import { useToast } from "../components/ToastProvider";

const ASSET_TYPE_OPTIONS: { value: AssetType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'int', label: 'Int' },
  { value: 'bool', label: 'Bool' },
  { value: 'credential', label: 'Credential' },
  { value: 'secret', label: 'Secret' },
]

function formatAssetType(t: AssetType): string {
  return ASSET_TYPE_OPTIONS.find(o => o.value === t)?.label ?? t
}

export default function AssetsPage() {
  const dialog = useDialog();
  const { pushToast } = useToast();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [canCreate, setCanCreate] = useState(true);
  const [canEdit, setCanEdit] = useState(true);
  const [canDelete, setCanDelete] = useState(true);
  const [selected, setSelected] = useState<number[]>([]);
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (!target.closest('.action-menu')) {
        setMenuOpenId(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
      pushToast({ title: editing ? "Asset updated" : "Asset created", tone: "success" });
    } catch (e: any) {
      await dialog.alert({ title: "Save failed", message: e.message || "Unable to save asset" });
    }
  }

  async function handleDelete(id: number) {
    const confirmed = await dialog.confirm({ title: "Delete this asset?", message: "This action cannot be undone.", tone: "danger", confirmLabel: "Delete" });
    if (!confirmed) return;
    try {
      await deleteAsset(id);
      setSelected(prev => prev.filter(x => x !== id));
      await load(search);
      pushToast({ title: "Asset deleted", tone: "success" });
    } catch (e: any) {
      await dialog.alert({ title: "Delete failed", message: e.message || "Unable to delete asset" });
    }
  }

  function toggleSelect(id: number) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function toggleSelectAll() {
    if (selected.length === assets.length) {
      setSelected([]);
    } else {
      setSelected(assets.map(a => a.id));
    }
  }

  async function handleBulkDelete() {
    if (selected.length === 0) return;
    const confirmed = await dialog.confirm({ title: `Delete ${selected.length} selected asset(s)?`, message: "This action cannot be undone.", tone: "danger", confirmLabel: "Delete" });
    if (!confirmed) return;
    let successCount = 0;
    let errorMessages: string[] = [];
    for (const id of selected) {
      try {
        await deleteAsset(id);
        successCount++;
      } catch (e: any) {
        errorMessages.push(`Failed to delete asset ${id}: ${e.message || 'Unknown error'}`);
      }
    }
    if (errorMessages.length > 0) {
      await dialog.alert({ title: "Partial delete", message: `Deleted ${successCount} asset(s).\n\nErrors:\n${errorMessages.join('\n')}` });
    } else {
      pushToast({ title: `Deleted ${successCount} asset(s)`, tone: "success" });
    }
    setSelected([]);
    await load(search);
  }

  return (
    <div style={{ padding: 16 }}>
      <div className="page-shell" style={{ gap: 12 }}>
        <header className="page-header surface-card">
          <div>
            <h1 className="page-title">Assets</h1>
          </div>
          <div className="page-actions">
            <form className="search-form" onSubmit={(e) => { e.preventDefault(); load(search); }} role="search">
              <span className="search-icon" aria-hidden>🔍</span>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search assets" className="search-input" aria-label="Search assets" />
              <button type="submit" className="btn btn-secondary">Search</button>
            </form>
            <div className="action-buttons">
              <button type="button" onClick={() => load(search)} className="btn btn-ghost" aria-label="Refresh list">↻</button>
              <button type="button" onClick={openNew} className="btn btn-primary" style={{ opacity: canCreate ? 1 : 0.6, cursor: canCreate ? 'pointer' : 'not-allowed' }} disabled={!canCreate}>+ New Asset</button>
            </div>
          </div>
        </header>

        <div style={{ backgroundColor: '#fff', borderRadius: 12, boxShadow: '0 10px 24px rgba(15,23,42,0.08)', padding: 16 }}>
          {loading ? <p>Loading…</p> : error ? <p style={{ color: '#b91c1c' }}>{error}</p> : (
            <>
              {selected.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', backgroundColor: '#f3f4f6', borderRadius: 8, marginBottom: 16 }}>
                  <span style={{ fontWeight: 600 }}>{selected.length} selected</span>
                  <button onClick={handleBulkDelete} style={{ ...dangerBtn, opacity: canDelete ? 1 : 0.6, cursor: canDelete ? 'pointer' : 'not-allowed' }} disabled={!canDelete}>Delete</button>
                </div>
              )}
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ fontSize: 12, color: '#6b7280' }}>
                    <th style={{ padding: '8px 12px', width: 40, textAlign: 'center' }}>
                      <input type="checkbox" checked={selected.length === assets.length && assets.length > 0} onChange={toggleSelectAll} style={{ verticalAlign: 'middle' }} />
                    </th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Name</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Type</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Value</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Description</th>
                    <th style={{ padding: '8px 12px', textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.map(a => (
                    <tr key={a.id} style={{ fontSize: 14, color: '#111827' }}>
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                        <input type="checkbox" checked={selected.includes(a.id)} onChange={() => toggleSelect(a.id)} style={{ verticalAlign: 'middle' }} />
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'left' }}>{a.name}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'left' }}>{formatAssetType(a.type as AssetType)}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'left' }}>{a.type === 'secret' ? '••••••' : a.type === 'credential' ? (a.username || '') : a.value}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'left', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.description || ''}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                        {(canEdit || canDelete) && (
                          <ActionMenu
                            open={menuOpenId === a.id}
                            onToggle={() => setMenuOpenId(menuOpenId === a.id ? null : a.id)}
                            onClose={() => setMenuOpenId(null)}
                            actions={[
                              ...(canEdit ? [{ label: "Edit", onClick: () => openEdit(a) }] as const : []),
                              ...(canDelete ? [{ label: "Delete", tone: "danger" as const, onClick: () => handleDelete(a.id) }] as const : []),
                            ]}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                  {assets.length === 0 && (
                    <tr><td colSpan={6} style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280' }}>No assets found</td></tr>
                  )}
                </tbody>
              </table>
            </>
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
    </div>
  );
}

type MenuAction = { label: string; onClick: () => void; tone?: "danger"; disabled?: boolean };
function ActionMenu({ open, onToggle, onClose, actions }: { open: boolean; onToggle: () => void; onClose: () => void; actions: MenuAction[] }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node) && buttonRef.current && !buttonRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, onClose]);

  const menuStyle = useMemo(() => {
    if (!open || !buttonRef.current) return {};
    const rect = buttonRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const menuHeight = actions.length * 40 + 16; // estimate height
    const menuWidth = 180;

    let top = rect.bottom + 8;
    let left = rect.right - menuWidth; // align right edge

    // If not enough space below, flip above
    if (top + menuHeight > viewportHeight && rect.top - menuHeight - 8 > 0) {
      top = rect.top - menuHeight - 8;
    }

    // If not enough space on right, align left
    if (left < 0) {
      left = rect.left;
    }

    // Ensure within viewport
    if (left + menuWidth > viewportWidth) {
      left = viewportWidth - menuWidth - 8;
    }

    return { position: 'fixed' as const, top, left, zIndex: 1000 };
  }, [open, actions.length]);

  return (
    <div className="action-menu" style={{ position: "relative", display: "inline-block" }}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: "16px" }}
      >
        ⋮
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className="action-menu"
          style={{
            ...menuStyle,
            background: "#fff",
            border: "1px solid #e5e7eb",
            boxShadow: "0 8px 20px rgba(0,0,0,0.08)",
            borderRadius: 8,
            minWidth: 180,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {actions.map((a, index) => (
            <button
              key={a.label}
              role="menuitem"
              disabled={a.disabled}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "10px 12px",
                background: "transparent",
                border: "none",
                borderBottom: index < actions.length - 1 ? "1px solid #e5e7eb" : "none",
                cursor: a.disabled ? "not-allowed" : "pointer",
                color: a.tone === "danger" ? "#b91c1c" : a.disabled ? "#9ca3af" : "#111827",
                display: "block",
              }}
              onMouseEnter={(e) => {
                if (!a.disabled) {
                  e.currentTarget.style.backgroundColor = "#f9fafb";
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (!a.disabled) { a.onClick(); onClose(); }
              }}
            >
              {a.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

function AssetModal({ initial, onCancel, onSave }: { initial: Asset | null; onCancel: () => void; onSave: (v: FormValues) => void }) {
  const dialog = useDialog();
  const [form, setForm] = useState<FormValues>({
    name: initial?.name || "",
    type: (initial?.type as AssetType) || "text",
    value: initial?.value || "",
    description: initial?.description || "",
    credUser: initial?.type === 'credential' ? (initial?.username || '') : '',
    credPass: '',
  });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ value?: string }>({});

  function validateValue(next: string, type: AssetType): string | undefined {
    if (type === 'int') {
      if (!next.trim()) return 'Value is required';
      if (!/^-?\d+$/.test(next.trim())) return 'Value must be a whole number';
    }
    return undefined;
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const { name, value } = e.target as any;
    setForm(prev => {
      const next = { ...prev, [name]: value } as FormValues;
      if (name === 'type') {
        next.value = '';
        next.credUser = '';
        next.credPass = '';
        setErrors({});
      } else if (name === 'value') {
        const err = validateValue(value, next.type);
        setErrors(prevErr => ({ ...prevErr, value: err }));
      }
      return next;
    });
  }

  async function submit() {
    if (!form.name.trim()) { await dialog.alert({ title: 'Name is required', message: 'Enter a name to continue' }); return; }
    if (!form.type) { await dialog.alert({ title: 'Type is required', message: 'Select an asset type to continue' }); return; }
    const valueError = validateValue(form.value, form.type);
    if (valueError) { setErrors(prev => ({ ...prev, value: valueError })); return; }
    if (form.type === 'credential') {
      if (!(form.credUser || '').trim()) { await dialog.alert({ title: 'Username is required', message: 'Enter a username for this credential' }); return; }
      // Require password both on create and edit for credentials
      if (!(form.credPass || '').trim()) { await dialog.alert({ title: 'Password is required', message: 'Enter a password for this credential' }); return; }
    } else {
      if (!form.value.trim()) { await dialog.alert({ title: 'Value is required', message: 'Enter a value to continue' }); return; }
    }
    try {
      setSaving(true);
      await onSave(form);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', top: 112, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center' }}>
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
        maxHeight: 'calc(100vh - 112px - 32px)',
      }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 12, flexShrink: 0 }}>{initial ? 'Edit Asset' : 'New Asset'}</h2>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label>
            <div style={label}>Name</div>
            <input name="name" value={form.name} onChange={handleChange} disabled={!!initial} style={input} />
          </label>
          <label>
            <div style={label}>Type</div>
            <select name="type" value={form.type} onChange={handleChange} style={input}>
              {ASSET_TYPE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          {form.type === 'bool' ? (
            <div>
              <div style={label}>Value</div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="radio" name="boolValue" checked={form.value === 'true'} onChange={() => setForm(prev => ({ ...prev, value: 'true' }))} />
                  <span>True</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="radio" name="boolValue" checked={form.value === 'false'} onChange={() => setForm(prev => ({ ...prev, value: 'false' }))} />
                  <span>False</span>
                </label>
              </div>
            </div>
          ) : form.type === 'credential' ? (
            <div style={{ display: 'grid', gap: 16 }}>
              <label className="modal-field">
                <div style={label}>Username</div>
                <input name="credUser" value={form.credUser || ''} onChange={e => setForm(prev => ({ ...prev, credUser: e.target.value }))} style={input} />
              </label>
              <label className="modal-field">
                <div style={label}>Password</div>
                <input type="password" name="credPass" value={form.credPass || ''} onChange={e => setForm(prev => ({ ...prev, credPass: e.target.value }))} style={input} placeholder={initial ? 'Leave blank to keep current' : ''} />
              </label>
            </div>
          ) : (
            <label className="modal-field">
              <div style={label}>{form.type === 'secret' ? 'Secret value' : 'Value'}</div>
              <input
                name="value"
                value={form.value}
                onChange={handleChange}
                style={{ ...input, borderColor: errors.value ? '#dc2626' : '#e5e7eb' }}
                type={form.type === 'secret' ? 'password' : form.type === 'int' ? 'number' : 'text'}
                step={form.type === 'int' ? 1 : undefined}
              />
              {errors.value && <div style={{ color: '#dc2626', fontSize: 12, marginTop: 4 }}>{errors.value}</div>}
            </label>
          )}
          {/* isSecret checkbox removed for all types as requested */}
          <label className="modal-field">
            <div style={label}>Description</div>
            <textarea name="description" value={form.description || ''} onChange={handleChange} style={{ ...input, minHeight: 60 }} />
          </label>
        </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12, flexShrink: 0 }}>
          <button onClick={onCancel} style={secondaryBtn}>Cancel</button>
          <button onClick={submit} disabled={saving || Boolean(errors.value)} style={primaryBtn}>{saving ? 'Saving…' : 'Save'}</button>
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
