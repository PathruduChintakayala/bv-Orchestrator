import { useEffect, useMemo, useState, useRef } from "react";
import type { ChangeEvent } from "react";
import { createPortal } from "react-dom";
import type { Package } from "../types/package";
import { fetchPackages, uploadPackage, deletePackage, downloadPackageVersion } from "../api/packages";
import { formatDisplayTime } from "../utils/datetime";

export default function PackagesPage() {
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [versionsModal, setVersionsModal] = useState<string | null>(null); // package name
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) { window.location.hash = "#/"; return; }
    load();
  }, []);

  async function load(s?: string) {
    try {
      setLoading(true);
      setError(null);
      const pkgData = await fetchPackages(s ? { search: s } : undefined);
      setPackages(pkgData);
    } catch (e: any) {
      setError(e.message || "Failed to load packages");
    } finally {
      setLoading(false);
    }
  }

  function openUpload() { setUploadOpen(true); }
  function closeUpload() { setUploadOpen(false); }

  function openVersions(name: string) {
    setVersionsModal(name);
    setSelectedIds(new Set());
  }
  function closeVersions() {
    setVersionsModal(null);
    setSelectedIds(new Set());
  }

  async function handleUpload(values: UploadValues) {
    try {
      await uploadPackage(values.file!);
      closeUpload();
      await load(search);
    } catch (e: any) {
      alert(e.message || "Upload failed");
    }
  }

  const grouped = useMemo(() => {
    const byName: Record<string, Package[]> = {};
    packages.forEach(p => {
      byName[p.name] = byName[p.name] || [];
      byName[p.name].push(p);
    });
    return Object.entries(byName).map(([name, versions]) => {
      const latest = versions.reduce((acc, cur) => new Date(cur.updatedAt) > new Date(acc.updatedAt) ? cur : acc, versions[0]);
      const isBv = versions.some(v => v.isBvpackage);
      return {
        name,
        typeLabel: isBv ? "BV Package" : "Legacy ZIP",
        totalVersions: versions.length,
        updatedAt: latest.updatedAt,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [packages]);

  function versionsFor(name: string | null): Package[] {
    if (!name) return [];
    return packages.filter(p => p.name === name).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  function isActiveVersion(p: Package): boolean {
    // Backend now computes is_active based on live process associations; trust it here.
    return Boolean(p.isActive);
  }

  function toggleSelect(id: number, active: boolean) {
    if (active) return; // never allow selecting active versions
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function deleteSingle(p: Package, active: boolean) {
    if (active) { alert("Cannot delete an active version"); return; }
    if (!confirm(`Delete version ${p.version} of ${p.name}?`)) return;
    try {
      await deletePackage(p.id);
      await load(search);
    } catch (e: any) {
      alert(e.message || "Delete failed");
    }
  }

  async function bulkDelete(name: string) {
    const versions = versionsFor(name);
    const inactive = versions.filter(v => !isActiveVersion(v) && selectedIds.has(v.id));
    if (inactive.length === 0) {
      if (selectedIds.size > 0) {
        alert("Selected versions are active and cannot be deleted.");
      } else {
        alert("Select at least one inactive version to delete.");
      }
      return;
    }
    if (!confirm(`Delete ${inactive.length} inactive version(s)?`)) return;
    let hadError = false;
    for (const v of inactive) {
      try {
        await deletePackage(v.id);
      } catch (e: any) {
        hadError = true;
        alert(e.message || `Failed to delete ${v.version}`);
      }
    }
    setSelectedIds(new Set());
    await load(search);
    if (hadError) {
      alert("Some versions could not be deleted.");
    }
  }

  async function deleteAllInactive(name: string) {
    const versions = versionsFor(name);
    const inactive = versions.filter(v => !isActiveVersion(v));
    if (inactive.length === 0) {
      alert("No inactive versions to delete.");
      return;
    }
    if (!confirm(`Delete all ${inactive.length} inactive version(s)?`)) return;
    let hadError = false;
    for (const v of inactive) {
      try {
        await deletePackage(v.id);
      } catch (e: any) {
        hadError = true;
        alert(e.message || `Failed to delete ${v.version}`);
      }
    }
    setSelectedIds(new Set());
    await load(search);
    if (hadError) {
      alert("Some versions could not be deleted.");
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <div className="page-shell" style={{ gap: 12 }}>
        <header className="page-header surface-card">
          <div>
            <h1 className="page-title">Packages</h1>
          </div>
          <div className="page-actions">
            <form
              className="search-form"
              onSubmit={(e) => { e.preventDefault(); const term = search.trim(); setSearch(term); void load(term); }}
              role="search"
            >
              <span className="search-icon" aria-hidden>🔍</span>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search packages"
                className="search-input"
                aria-label="Search packages"
              />
              <button type="submit" className="btn btn-secondary">Search</button>
            </form>
            <div className="action-buttons">
              <button type="button" onClick={() => load(search)} className="btn btn-ghost" aria-label="Refresh list">↻</button>
              <button type="button" onClick={openUpload} className="btn btn-primary">⬆ Upload Package</button>
            </div>
          </div>
        </header>

        <div style={{ backgroundColor: '#fff', borderRadius: 12, boxShadow: '0 10px 24px rgba(15,23,42,0.08)', padding: 16 }}>
          {loading ? <p>Loading…</p> : error ? <p style={{ color: '#b91c1c' }}>{error}</p> : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', fontSize: 12, color: '#6b7280' }}>
                  <th style={{ paddingBottom: 8 }}>Package Name</th>
                  <th style={{ paddingBottom: 8 }}>Type</th>
                  <th style={{ paddingBottom: 8 }}>Total Versions</th>
                  <th style={{ paddingBottom: 8 }}>Updated</th>
                  <th style={{ paddingBottom: 8 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map(row => (
                  <tr key={row.name} style={{ fontSize: 14, color: '#111827' }}>
                    <td style={{ padding: '6px 0' }}>{row.name}</td>
                    <td style={{ padding: '6px 0' }}>{row.typeLabel}</td>
                    <td style={{ padding: '6px 0' }}>{row.totalVersions}</td>
                    <td style={{ padding: '6px 0' }}>{formatDisplayTime(row.updatedAt)}</td>
                    <td style={{ padding: '6px 0' }}>
                      <button style={primaryBtn} onClick={() => openVersions(row.name)}>View Versions</button>
                    </td>
                  </tr>
                ))}
                {grouped.length === 0 && (
                  <tr><td colSpan={5} style={{ paddingTop: 12, color: '#6b7280' }}>No packages found</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {uploadOpen && (
          <UploadModal onCancel={closeUpload} onSave={handleUpload} />
        )}

        {versionsModal && (
          <VersionsModal
            packageName={versionsModal}
            versions={versionsFor(versionsModal)}
            isActive={isActiveVersion}
            onClose={closeVersions}
            onDelete={deleteSingle}
            selectedIds={selectedIds}
            onToggle={toggleSelect}
            onBulkDelete={bulkDelete}
            onDeleteInactive={deleteAllInactive}
          />
        )}
      </div>
    </div>
  );
}

function VersionsModal({
  packageName,
  versions,
  isActive,
  onClose,
  onDelete,
  selectedIds,
  onToggle,
  onBulkDelete,
  onDeleteInactive,
}: {
  packageName: string;
  versions: Package[];
  isActive: (p: Package) => boolean;
  onClose: () => void;
  onDelete: (p: Package, active: boolean) => Promise<void>;
  selectedIds: Set<number>;
  onToggle: (id: number, active: boolean) => void;
  onBulkDelete: (name: string) => Promise<void>;
  onDeleteInactive: (name: string) => Promise<void>;
}) {
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);

  async function handleDownload(p: Package) {
    const filename = `${p.name}-${p.version}.bvpackage`;
    try {
      await downloadPackageVersion({ packageId: p.id, version: p.version, filename });
    } catch (e: any) {
      alert(e.message || "Download failed");
    }
  }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center', zIndex: 20 }}>
      <div style={{ width: '100%', maxWidth: 900, background: '#fff', borderRadius: 16, boxShadow: '0 12px 30px rgba(0,0,0,0.18)', padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Versions for {packageName}</h2>
            <div style={{ color: '#6b7280', fontSize: 13 }}>Manage versions. Active versions cannot be deleted.</div>
          </div>
          <button onClick={onClose} style={{ ...secondaryBtn, padding: '8px 12px' }}>Close</button>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button style={primaryBtn} onClick={() => onBulkDelete(packageName)}>Bulk Delete Selected</button>
          <button style={dangerBtn} onClick={() => onDeleteInactive(packageName)}>Delete All Inactive Versions</button>
          <div style={{ color: '#6b7280', fontSize: 12 }}>
            Active versions are detected from Jobs that reference the same package name + version.
          </div>
        </div>

        <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', fontSize: 12, color: '#6b7280' }}>
                <th style={{ paddingBottom: 8 }}></th>
                <th style={{ paddingBottom: 8 }}>Version</th>
                <th style={{ paddingBottom: 8 }}>Active</th>
                <th style={{ paddingBottom: 8 }}>Updated</th>
                <th style={{ paddingBottom: 8 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {versions.map(v => {
                const active = isActive(v);
                const disabled = active;
                const canDownload = Boolean(v.downloadAvailable ?? v.isBvpackage);
                return (
                  <tr key={v.id} style={{ fontSize: 14, color: '#111827' }}>
                    <td style={{ padding: '6px 0', width: 36 }}>
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={selectedIds.has(v.id) && !disabled}
                        onChange={() => onToggle(v.id, active)}
                      />
                    </td>
                    <td style={{ padding: '6px 0' }}>{v.version}</td>
                    <td style={{ padding: '6px 0', color: active ? '#2563eb' : '#059669', fontWeight: 600 }}>
                      {active ? 'Yes' : 'No'}
                    </td>
                    <td style={{ padding: '6px 0' }}>{formatDisplayTime(v.updatedAt)}</td>
                    <td style={{ padding: '6px 0' }}>
                      <ActionMenu
                        open={menuOpenId === v.id}
                        onToggle={() => setMenuOpenId(menuOpenId === v.id ? null : v.id)}
                        onClose={() => setMenuOpenId(null)}
                        actions={[
                          { label: "Download", onClick: () => handleDownload(v), disabled: !canDownload },
                          { label: "Delete", tone: "danger" as const, onClick: () => onDelete(v, active), disabled: disabled },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
              {versions.length === 0 && (
                <tr><td colSpan={5} style={{ paddingTop: 12, color: '#6b7280' }}>No versions found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function UploadModal({ onCancel, onSave }: { onCancel: () => void; onSave: (v: UploadValues) => void }) {
  const [form, setForm] = useState<UploadValues>({ file: null });
  const [saving, setSaving] = useState(false);

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files && e.target.files[0] ? e.target.files[0] : null;
    setForm(prev => ({ ...prev, file: f }));
  }

  function validate(): string | null {
    if (!form.file) return 'Package file is required';
    if (!form.file.name.toLowerCase().endsWith('.bvpackage')) return 'File must be a .bvpackage';
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
            <div style={label}>BV Package File (.bvpackage)</div>
            <input type="file" accept=".bvpackage" onChange={onFile} style={input} />
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
};

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

const input: React.CSSProperties = { padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', width: '100%', maxWidth: '100%', boxSizing: 'border-box' };
const label: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 6 };
const primaryBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#2563eb', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' };
const secondaryBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#e5e7eb', color: '#111827', border: 'none', fontWeight: 600, cursor: 'pointer' };
const dangerBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#dc2626', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' };
