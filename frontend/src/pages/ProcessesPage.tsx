import { useEffect, useMemo, useState } from "react";
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
      const payload: any = {
        name: values.name,
        isActive: values.isActive,
      };

      if (values.packageId) {
        payload.packageId = values.packageId;
      }

      if (values.isBv) {
        payload.entrypointName = values.entrypointName;
      } else {
        payload.scriptPath = values.scriptPath;
        payload.entrypointName = null;
      }
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
                  <td style={{ padding: '6px 0', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.package?.isBvpackage ? (p.entrypointName ? `Entrypoint: ${p.entrypointName}` : 'Entrypoint: (missing)') : p.scriptPath}
                  </td>
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
    const [saving, setSaving] = useState(false);
    const [packageName, setPackageName] = useState<string | undefined>(initial?.package?.name);
    const [packageVersion, setPackageVersion] = useState<string | undefined>(initial?.package?.version);
    const [entrypointName, setEntrypointName] = useState<string | undefined>(initial?.entrypointName || undefined);

    const packageNames = useMemo(() => {
      const set = new Set<string>();
      packages.forEach((p) => set.add(p.name));
      return Array.from(set).sort((a, b) => a.localeCompare(b));
    }, [packages]);

    const versionsForSelected = useMemo(() => {
      if (!packageName) return [];
      return packages.filter((p) => p.name === packageName).map((p) => p.version).sort();
    }, [packages, packageName]);

    const selectedPackage = useMemo(() => {
      if (!packageName || !packageVersion) return undefined;
      return packages.find((p) => p.name === packageName && p.version === packageVersion);
    }, [packages, packageName, packageVersion]);

    const entrypoints = useMemo(() => selectedPackage?.entrypoints || [], [selectedPackage]);

    const [form, setForm] = useState<FormValues>({
      name: initial?.name || "",
      isActive: initial?.isActive ?? true,
      scriptPath: initial?.scriptPath || "",
      entrypointName: initial?.entrypointName || "",
      packageId: initial?.packageId ?? undefined,
      isBv: !!selectedPackage?.isBvpackage,
    });

    useEffect(() => {
      const isBv = !!selectedPackage?.isBvpackage;
      const defaultEp = entrypoints.find((e) => e.name === selectedPackage?.defaultEntrypoint)?.name || entrypoints.find((e) => e.default)?.name || entrypoints[0]?.name || "";
      setForm((prev) => ({
        ...prev,
        packageId: selectedPackage?.id,
        isBv,
        entrypointName: isBv ? (entrypointName || defaultEp || "") : "",
        scriptPath: isBv ? "" : prev.scriptPath,
      }));
      if (isBv && !entrypointName) {
        setEntrypointName(defaultEp || undefined);
      }
    }, [selectedPackage, entrypoints, entrypointName]);

    function handleNameChange(val: string) {
      setForm((prev) => ({ ...prev, name: val }));
    }

    function handleScriptPathChange(val: string) {
      setForm((prev) => ({ ...prev, scriptPath: val }));
    }

    function toggleActive() {
      setForm((prev) => ({ ...prev, isActive: !prev.isActive }));
    }

    function selectPackage(name?: string) {
      setPackageName(name || undefined);
      setPackageVersion(undefined);
      setEntrypointName(undefined);
    }

    function selectVersion(version?: string) {
      setPackageVersion(version || undefined);
      setEntrypointName(undefined);
    }

    function selectEntrypoint(ep?: string) {
      setEntrypointName(ep || undefined);
      setForm((prev) => ({ ...prev, entrypointName: ep || "" }));
    }

    async function submit() {
      if (!form.name.trim()) { alert('Name is required'); return; }
      if (selectedPackage?.isBvpackage) {
        if (!packageName || !packageVersion || !selectedPackage?.id) { alert('Package and version are required'); return; }
        if (!entrypointName) { alert('Entrypoint is required'); return; }
      } else {
        if (!form.scriptPath.trim()) { alert('Script Path is required'); return; }
      }
      try {
        setSaving(true);
        await onSave({
          ...form,
          packageId: selectedPackage?.id,
          entrypointName: selectedPackage?.isBvpackage ? entrypointName || '' : '',
          isBv: !!selectedPackage?.isBvpackage,
        });
      } finally {
        setSaving(false);
      }
    }

    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center' }}>
        <div style={{
          width: '100%',
          maxWidth: 680,
          background: '#fff',
          borderRadius: 16,
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 12 }}>{initial ? 'Edit Process' : 'New Process'}</h2>
          <div style={{ display: 'grid', gap: 12 }}>
            <label>
              <div style={label}>Name</div>
              <input name="name" value={form.name} onChange={(e) => handleNameChange(e.target.value)} style={input} />
            </label>

            <div style={{ display: 'grid', gap: 8 }}>
              <div style={label}>Package</div>
              <SearchableSelect
                options={packageNames.map((n) => ({ label: n, value: n }))}
                value={packageName}
                placeholder="Select package"
                onChange={(val) => selectPackage(val || undefined)}
              />
            </div>

            <div style={{ display: 'grid', gap: 8 }}>
              <div style={label}>Version</div>
              <SearchableSelect
                options={versionsForSelected.map((v) => ({ label: v, value: v }))}
                value={packageVersion}
                placeholder={packageName ? 'Select version' : 'Select package first'}
                disabled={!packageName}
                onChange={(val) => selectVersion(val || undefined)}
              />
            </div>

            {selectedPackage?.isBvpackage ? (
              <div style={{ display: 'grid', gap: 8 }}>
                <div style={label}>Entrypoint</div>
                <SearchableSelect
                  options={entrypoints.map((ep) => ({ label: ep.name + (ep.name === selectedPackage?.defaultEntrypoint ? ' (default)' : ''), value: ep.name }))}
                  value={entrypointName}
                  placeholder="Select entrypoint"
                  disabled={!packageVersion}
                  onChange={(val) => selectEntrypoint(val || undefined)}
                />
              </div>
            ) : (
              <label>
                <div style={label}>Script Path</div>
                <input name="scriptPath" value={form.scriptPath} onChange={(e) => handleScriptPathChange(e.target.value)} style={input} />
              </label>
            )}

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

  type SelectOption = { label: string; value: string };

  function SearchableSelect({ options, value, onChange, placeholder, disabled }: { options: SelectOption[]; value?: string; onChange: (v?: string) => void; placeholder?: string; disabled?: boolean }) {
    const [open, setOpen] = useState(false);
    const [filter, setFilter] = useState('');

    const filtered = useMemo(() => {
      const f = filter.toLowerCase();
      return options.filter((o) => o.label.toLowerCase().includes(f));
    }, [options, filter]);

    const selectedLabel = options.find((o) => o.value === value)?.label;

    function select(val: string) {
      onChange(val);
      setOpen(false);
      setFilter('');
    }

    return (
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => !disabled && setOpen((o) => !o)}
          style={{
            ...input,
            textAlign: 'left',
            cursor: disabled ? 'not-allowed' : 'pointer',
            color: selectedLabel ? '#111827' : '#6b7280',
          }}
        >
          {selectedLabel || placeholder || 'Select'}
        </button>
        {open && !disabled && (
          <div style={{ position: 'absolute', zIndex: 20, marginTop: 6, width: '100%', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 8px 20px rgba(0,0,0,0.08)', maxHeight: 260, overflow: 'hidden' }}>
            <div style={{ padding: 8 }}>
              <input
                autoFocus
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search…"
                style={{ ...input, width: '100%' }}
              />
            </div>
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              {filtered.length === 0 && <div style={{ padding: 10, color: '#6b7280', fontSize: 13 }}>No matches</div>}
              {filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => select(o.value)}
                  style={{ width: '100%', textAlign: 'left', padding: '10px 12px', background: o.value === value ? '#eff6ff' : '#fff', border: 'none', borderTop: '1px solid #f3f4f6', cursor: 'pointer' }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }
type FormValues = {
  name: string;
  packageId?: number;
  scriptPath: string;
  entrypointName: string;
  isActive: boolean;
  isBv: boolean;
};

const input: React.CSSProperties = { padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', width: '100%', maxWidth: '100%', boxSizing: 'border-box' };
const label: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 6 };
const primaryBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#2563eb', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' };
const secondaryBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#e5e7eb', color: '#111827', border: 'none', fontWeight: 600, cursor: 'pointer' };
const dangerBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#dc2626', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' };
