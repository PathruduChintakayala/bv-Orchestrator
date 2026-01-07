import React, { useEffect, useMemo, useState, useRef } from "react";
import { createPortal } from "react-dom";
import type { Process } from "../types/processes";
import { fetchProcesses, createProcess, updateProcess, deleteProcess, upgradeProcessToLatest } from "../api/processes";
import { fetchPackages } from "../api/packages";
import TriggerModal from "../components/TriggerModal";
import { getProcessTypeLabel, getProcessTypeTone } from "../utils/processTypes";
import { useDialog } from "../components/DialogProvider";
import { useToast } from "../components/ToastProvider";

export default function ProcessesPage() {
  const dialog = useDialog();
  const { pushToast } = useToast();
  const [items, setItems] = useState<Process[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Process | null>(null);
  const [packages, setPackages] = useState<import('../types/package').Package[]>([]);
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  const [pendingSearch, setPendingSearch] = useState("");
  const [triggerModalOpen, setTriggerModalOpen] = useState(false);
  const [triggerProcessId, setTriggerProcessId] = useState<number | null>(null);
  const [selected, setSelected] = useState<number[]>([]);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) { window.location.hash = "#/"; return; }
    load();
    // preload active packages for selection
    fetchPackages().then(setPackages).catch(() => { });
  }, []);

  // Context menu click-outside is handled within ActionMenu via portal, so no global listener here.

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

  function handleSearchSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    setSearch(pendingSearch.trim());
    load(pendingSearch.trim());
  }

  async function handleSave(values: FormValues) {
    try {
      const payload: any = {
        name: values.name,
        description: values.description,
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
      pushToast({ title: editing ? "Process updated" : "Process created", tone: "success" });
    } catch (e: any) {
      await dialog.alert({ title: "Save failed", message: e.message || "Unable to save process" });
    }
  }

  async function handleDelete(id: number) {
    const confirmed = await dialog.confirm({ title: "Delete this process?", message: "This action cannot be undone.", tone: "danger", confirmLabel: "Delete" });
    if (!confirmed) return;
    try {
      await deleteProcess(id);
      await load(search);
      pushToast({ title: "Process deleted", tone: "success" });
    } catch (e: any) {
      await dialog.alert({ title: "Delete failed", message: e.message || "Unable to delete process" });
    }
  }

  function toggleSelect(id: number) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function toggleSelectAll() {
    if (selected.length === items.length) {
      setSelected([])
    } else {
      setSelected(items.map(it => it.id))
    }
  }

  async function handleBulkDelete() {
    if (selected.length === 0) return
    const confirmed = await dialog.confirm({
      title: `Delete ${selected.length} selected process(es)?`,
      message: "This action cannot be undone.",
      tone: "danger",
      confirmLabel: "Delete",
    });
    if (!confirmed) return
    let successCount = 0
    let errorMessages: string[] = []
    for (const id of selected) {
      try {
        await deleteProcess(id)
        successCount++
      } catch (e: any) {
        errorMessages.push(`Failed to delete process ${id}: ${e.message || 'Unknown error'}`)
      }
    }
    if (errorMessages.length > 0) {
      await dialog.alert({ title: "Partial delete", message: `Deleted ${successCount} process(es).\n\nErrors:\n${errorMessages.join('\n')}` })
    } else {
      pushToast({ title: `Deleted ${successCount} process(es)`, tone: "success" })
    }
    setSelected([])
    await load(search)
  }

  function typeLabel(p: Process) {
    return getProcessTypeLabel(p.type)
  }

  function entrypointLabel(p: Process) {
    if (p.package?.isBvpackage) {
      if (p.entrypointName) {
        // Remove file extension
        return p.entrypointName.replace(/\.[^/.]+$/, "");
      }
      return "Entrypoint missing";
    }
    if (p.scriptPath) {
      // Extract filename and remove extension
      const filename = p.scriptPath.split(/[/\\]/).pop() || p.scriptPath;
      return filename.replace(/\.[^/.]+$/, "");
    }
    return "Script not set";
  }

  function lastUpdated(p: Process) {
    try { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(p.updatedAt)); }
    catch { return p.updatedAt; }
  }

  function goToJobsTrigger(processId: number) {
    window.location.hash = `#/automations/jobs?processId=${processId}&trigger=true`;
  }

  function goToJobs(processId: number) {
    window.location.hash = `#/automations/jobs?processId=${processId}`;
  }

  function openTriggerForProcess(processId: number) {
    // Open the shared "New Trigger" modal without leaving Processes
    setTriggerProcessId(processId);
    setTriggerModalOpen(true);
  }

  function goToLogs(processId: number) {
    window.location.hash = `#/automations/logs?processId=${processId}`;
  }

  async function handleUpgradeToLatest(p: Process) {
    if (!p.upgradeAvailable || !p.package?.version || !p.latestVersion) return;
    const confirmed = await dialog.confirm({
      title: `Upgrade ${p.name}?`,
      message: `Upgrade from ${p.package.version} to ${p.latestVersion}?`,
      tone: "danger",
      confirmLabel: "Upgrade",
    });
    if (!confirmed) return;
    try {
      await upgradeProcessToLatest(p.id);
      await load(search);
      pushToast({ title: `Upgraded to ${p.latestVersion}`, tone: "success" });
    } catch (e: any) {
      await dialog.alert({ title: "Upgrade failed", message: e.message || "Unable to upgrade process" });
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <div className="page-shell processes-shell" style={{ gap: 12 }}>
        <header className="page-header surface-card">
          <div>
            <h1 className="page-title">Processes</h1>
          </div>
          <div className="page-actions">
            <form className="search-form" onSubmit={handleSearchSubmit} role="search">
              <span className="search-icon" aria-hidden>🔍</span>
              <input
                value={pendingSearch}
                onChange={(e) => setPendingSearch(e.target.value)}
                placeholder="Search processes"
                className="search-input"
                aria-label="Search processes"
              />
              <button type="submit" className="btn btn-secondary">Search</button>
            </form>
            <div className="action-buttons">
              <button onClick={() => load(search)} className="btn btn-ghost" aria-label="Refresh list">↻</button>
              <button onClick={openNew} className="btn btn-primary">+ New Process</button>
            </div>
          </div>
        </header>

        <div className="surface-card">
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          {selected.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', backgroundColor: '#f3f4f6', borderRadius: 8, marginBottom: 16 }}>
              <span style={{ fontWeight: 600 }}>{selected.length} selected</span>
              <button onClick={handleBulkDelete} style={dangerBtn}>Delete</button>
            </div>
          )}
          <div className="table-wrapper" role="region" aria-live="polite">
            <table className="processes-table" aria-busy={loading}>
              <thead>
                <tr>
                  <th style={{ width: 40 }}>
                    <input type="checkbox" checked={selected.length === items.length && items.length > 0} onChange={toggleSelectAll} />
                  </th>
                  <th scope="col">Name</th>
                  <th scope="col">Type</th>
                  <th scope="col">Version</th>
                  <th scope="col">Entry Point</th>
                  <th scope="col">Description</th>
                  <th scope="col">Last Updated</th>
                  <th scope="col" className="actions-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && SkeletonRows(6)}
                {!loading && items.map((p) => (
                  <tr key={p.id} className="data-row">
                    <td>
                      <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggleSelect(p.id)} />
                    </td>
                    <td>
                      <div className="cell-primary">{p.name}</div>
                    </td>
                    <td><Badge tone={getProcessTypeTone(p.type)}>{typeLabel(p)}</Badge></td>
                    <td>
                      <span className="mono" title={p.package?.version || "N/A"}>{p.package?.version || "N/A"}</span>
                      {p.upgradeAvailable && p.latestVersion && (
                        <span title="Newer version available" style={{ marginLeft: 6, color: '#2563eb' }}>⬆</span>
                      )}
                    </td>
                    <td>
                      <div className="cell-primary truncate" title={entrypointLabel(p)}>{entrypointLabel(p)}</div>
                    </td>
                    <td>
                      <div className="cell-primary truncate" title={p.description || undefined}>{p.description || ""}</div>
                    </td>
                    <td>{lastUpdated(p)}</td>
                    <td className="actions-col">
                      <button onClick={() => goToJobsTrigger(p.id)} className="btn btn-ghost icon-button" title="Run job" aria-label="Run job">
                        ▶
                      </button>
                      <ActionMenu
                        open={menuOpenId === p.id}
                        onToggle={() => setMenuOpenId(menuOpenId === p.id ? null : p.id)}
                        onClose={() => setMenuOpenId(null)}
                        actions={[
                          { label: "Edit", onClick: () => openEdit(p) },
                          { label: "View Jobs", onClick: () => goToJobs(p.id) },
                          { label: "Upgrade to latest version", onClick: () => handleUpgradeToLatest(p), disabled: !p.upgradeAvailable },
                          { label: "Add Trigger", onClick: () => openTriggerForProcess(p.id) },
                          { label: "View Logs", onClick: () => goToLogs(p.id) },
                          { label: "Delete", tone: "danger", onClick: () => handleDelete(p.id) },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
                {!loading && items.length === 0 && (
                  <tr>
                    <td colSpan={8}>
                      <div className="empty-state">
                        <div>
                          <p className="empty-title">No processes yet</p>
                          <p className="empty-body">Create your first process to orchestrate robots and jobs.</p>
                        </div>
                        <button onClick={openNew} className="btn btn-primary">Create process</button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {triggerModalOpen && (
          <TriggerModal
            open={triggerModalOpen}
            onClose={() => { setTriggerModalOpen(false); setTriggerProcessId(null); }}
            onCreated={() => { setTriggerProcessId(null); }}
            defaultProcessId={triggerProcessId ?? undefined}
            lockProcess
            processes={items}
          />
        )}

        {modalOpen && (
          <ProcessModal
            initial={editing || null}
            onCancel={closeModal}
            onSave={handleSave}
            packages={packages}
          />
        )}
      </div>
    </div>
  );
}

function SkeletonRows(count: number) {
  return (
    <>
      {Array.from({ length: count }).map((_, idx) => (
        <tr key={`s-${idx}`} className="skeleton-row">
          <td><div className="skeleton shimmer" style={{ width: "140px" }} /></td>
          <td><div className="skeleton shimmer" style={{ width: "72px" }} /></td>
          <td><div className="skeleton shimmer" style={{ width: "48px" }} /></td>
          <td><div className="skeleton shimmer" style={{ width: "180px" }} /></td>
          <td><div className="skeleton shimmer" style={{ width: "120px" }} /></td>
          <td><div className="skeleton shimmer" style={{ width: "120px" }} /></td>
          <td className="actions-col"><div className="skeleton shimmer" style={{ width: "32px", marginLeft: "auto" }} /></td>
        </tr>
      ))}
    </>
  );
}

function Badge({ tone = "slate", children }: { tone?: "slate" | "blue"; children: React.ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
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

function ProcessModal({ initial, onCancel, onSave, packages }: { initial: Process | null; onCancel: () => void; onSave: (v: FormValues) => void; packages: import('../types/package').Package[] }) {
  const dialog = useDialog();
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
    scriptPath: initial?.scriptPath || "",
    entrypointName: initial?.entrypointName || "",
    packageId: initial?.packageId ?? undefined,
    isBv: !!selectedPackage?.isBvpackage,
    description: initial?.description || "",
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

  function handleDescriptionChange(val: string) {
    setForm((prev) => ({ ...prev, description: val }));
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
    if (!form.name.trim()) { await dialog.alert({ title: 'Name is required', message: 'Enter a name to continue' }); return; }
    if (selectedPackage?.isBvpackage) {
      if (!packageName || !packageVersion || !selectedPackage?.id) { await dialog.alert({ title: 'Package and version are required', message: 'Select a package and version before saving' }); return; }
      if (!entrypointName) { await dialog.alert({ title: 'Entrypoint is required', message: 'Select an entrypoint before saving' }); return; }
    } else {
      if (!form.scriptPath.trim()) { await dialog.alert({ title: 'Script Path is required', message: 'Enter a script path to continue' }); return; }
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
    <div style={{ position: 'fixed', top: 112, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center' }}>
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
        maxHeight: 'calc(100vh - 112px - 32px)',
      }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 12, flexShrink: 0 }}>{initial ? 'Edit Process' : 'New Process'}</h2>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label>
            <div style={label}>Name</div>
            <input name="name" value={form.name} onChange={(e) => handleNameChange(e.target.value)} style={input} />
          </label>

          <label>
            <div style={label}>Description</div>
            <input name="description" value={form.description} onChange={(e) => handleDescriptionChange(e.target.value)} style={input} />
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

        </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12, flexShrink: 0 }}>
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
  isBv: boolean;
  description: string;
};

const input: React.CSSProperties = { padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', width: '100%', maxWidth: '100%', boxSizing: 'border-box' };
const label: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 6 };
const primaryBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#2563eb', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' };
const secondaryBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#e5e7eb', color: '#111827', border: 'none', fontWeight: 600, cursor: 'pointer' };
const dangerBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#dc2626', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' };
