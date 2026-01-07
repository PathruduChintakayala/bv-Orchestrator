import { useEffect, useState, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import type { Robot } from "../types/robot";
import { fetchRobots, deleteRobot, createRobot, updateRobot } from "../api/robots";
import { formatDisplayTime } from "../utils/datetime";
import { fetchMachines } from "../api/machines";
import type { Machine } from "../types/machine";
import { useDialog } from "../components/DialogProvider";
import { useToast } from "../components/ToastProvider";

export default function RobotsPage() {
  const dialog = useDialog();
  const { pushToast } = useToast();
  const [items, setItems] = useState<Robot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Robot | null>(null);
  const [search, setSearch] = useState("");
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);

  useEffect(() => {
    load();
  }, []);

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
        const updatePayload: any = {};
        if (values.name !== undefined && values.name !== editing.name) {
          updatePayload.name = values.name;
        }
        const u = (values.credentialUsername || '').trim();
        const p = (values.credentialPassword || '').trim();
        if (u || p) {
          if (!u || !p) {
            await dialog.alert({ title: 'Credentials incomplete', message: 'Provide both username and password, or leave both empty' });
            return;
          }
          updatePayload.credential = { username: u, password: p };
        }
        // machineInfo is optional, only send if provided
        if (values.machineInfo !== undefined) {
          updatePayload.machineInfo = values.machineInfo || null;
        }
        await updateRobot(editing.id, updatePayload);
      } else {
        const u = (values.credentialUsername || '').trim();
        const p = (values.credentialPassword || '').trim();
        await createRobot({
          name: values.name,
          machineId: values.machineId ?? undefined,
          machineInfo: values.machineInfo || undefined,  // Optional
          credential: u && p ? { username: u, password: p } : undefined,
        });
      }
      closeModal();
      await load(search);
      pushToast({ title: editing ? 'Robot updated' : 'Robot created', tone: 'success' });
    } catch (e: any) {
      await dialog.alert({ title: "Save failed", message: e.message || "Unable to save robot" });
    }
  }

  async function handleDelete(id: number) {
    const confirmed = await dialog.confirm({ title: "Delete this robot?", message: "This action cannot be undone.", tone: "danger", confirmLabel: "Delete" });
    if (!confirmed) return;
    try {
      await deleteRobot(id);
      await load(search);
      pushToast({ title: "Robot deleted", tone: "success" });
    } catch (e: any) {
      await dialog.alert({ title: "Delete failed", message: e.message || "Unable to delete robot" });
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <div className="page-shell" style={{ gap: 12 }}>
        <header className="page-header surface-card">
          <div>
            <h1 className="page-title">Robots</h1>
          </div>
          <div className="page-actions">
            <form className="search-form" onSubmit={(e) => { e.preventDefault(); load(search); }} role="search">
              <span className="search-icon" aria-hidden>🔍</span>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search robots" className="search-input" aria-label="Search robots" />
              <button type="submit" className="btn btn-secondary">Search</button>
            </form>
            <div className="action-buttons">
              <button type="button" onClick={() => load(search)} className="btn btn-ghost" aria-label="Refresh list" disabled={loading}>↻</button>
              <button type="button" onClick={openNew} className="btn btn-primary">+ New Robot</button>
            </div>
          </div>
        </header>

        <div style={{ backgroundColor: '#fff', borderRadius: 12, boxShadow: '0 10px 24px rgba(15,23,42,0.08)', padding: 16 }}>
          {loading ? <p>Loading…</p> : error ? <p style={{ color: '#b91c1c' }}>{error}</p> : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ fontSize: 12, color: '#6b7280' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Name</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Status</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Last heartbeat</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Current job</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Machine</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map(r => (
                  <tr key={r.id} style={{ fontSize: 14, color: '#111827' }}>
                    <td style={{ padding: '8px 12px', textAlign: 'left' }}>{r.name}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'left' }}>
                      <span style={{ padding: '4px 8px', borderRadius: 999, backgroundColor: r.status === 'online' ? '#dcfce7' : '#e5e7eb', color: r.status === 'online' ? '#166534' : '#374151' }}>{r.status}</span>
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'left' }}>{formatDisplayTime(r.lastHeartbeat)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'left' }}>{r.currentJobId ?? '—'}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'left', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.machineName ?? '—'}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                      <ActionMenu
                        open={menuOpenId === r.id}
                        onToggle={() => setMenuOpenId(menuOpenId === r.id ? null : r.id)}
                        onClose={() => setMenuOpenId(null)}
                        actions={[
                          { label: "Edit", onClick: () => openEdit(r) },
                          { label: "Delete", tone: "danger" as const, onClick: () => handleDelete(r.id) },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280' }}>No robots found</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {modalOpen && (
          <RobotModal initial={editing} onCancel={closeModal} onSave={handleSave} />
        )}
      </div>
    </div>
  );
}

function RobotModal({ initial, onCancel, onSave }: { initial: Robot | null; onCancel: () => void; onSave: (v: FormValues) => void }) {
  const dialog = useDialog();
  const [form, setForm] = useState<FormValues>({
    name: initial?.name || "",
    machineInfo: initial?.machineInfo || "",
    machineId: initial?.machineId ?? null,
    credentialUsername: initial?.username || "",
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
    if (!initial && !form.name.trim()) { await dialog.alert({ title: 'Name is required', message: 'Enter a name to continue' }); return; }
    if (initial && !form.name.trim()) { await dialog.alert({ title: 'Name is required', message: 'Enter a name to continue' }); return; }
    if (!initial) {
      const u = (form.credentialUsername || '').trim();
      const p = (form.credentialPassword || '').trim();
      if ((u && !p) || (!u && p)) {
        await dialog.alert({ title: 'Credentials incomplete', message: 'Provide both username and password, or leave both empty' });
        return;
      }
    }
    if (initial) {
      const u = (form.credentialUsername || '').trim();
      const p = (form.credentialPassword || '').trim();
      if ((u && !p) || (!u && p)) {
        await dialog.alert({ title: 'Credentials incomplete', message: 'Provide both username and password, or leave both empty' });
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
    <div style={{ position: 'fixed', top: 112, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center' }}>
      <div style={{ width: '100%', maxWidth: 600, maxHeight: 'calc(100vh - 112px - 32px)', background: '#fff', borderRadius: 16, boxShadow: '0 4px 16px rgba(0,0,0,0.15)', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 12, flexShrink: 0 }}>{initial ? 'Edit Robot' : 'New Robot'}</h2>
        <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label>
            <div style={label}>Name</div>
            <input name="name" value={form.name} onChange={handleChange} style={input} />
          </label>
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
            <div style={label}>Machine Info <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 'normal' }}>(optional)</span></div>
            <input name="machineInfo" value={form.machineInfo || ''} onChange={handleChange} style={input} />
          </label>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Unattended credentials {initial ? '(leave password blank to keep current)' : '(optional)'}</div>
          <label>
            <div style={label}>Username</div>
            <input name="credentialUsername" value={form.credentialUsername || ''} onChange={handleChange} style={input} />
          </label>
          <label>
            <div style={label}>Password</div>
            <input name="credentialPassword" type="password" value={form.credentialPassword || ''} onChange={handleChange} style={input} placeholder={initial ? 'Leave blank to keep current' : ''} />
          </label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12, flexShrink: 0 }}>
          <button onClick={onCancel} style={secondaryBtn}>Cancel</button>
          <button onClick={submit} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
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
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: "16px" }}
      >
        ⋮
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className="action-menu"
          role="menu"
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
                if (!a.disabled) {
                  a.onClick();
                  onClose();
                }
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

type FormValues = {
  name: string;
  machineId?: number | null;
  machineInfo?: string | null;
  credentialUsername?: string;
  credentialPassword?: string;
};

const input: React.CSSProperties = { padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', width: '100%', maxWidth: '100%', boxSizing: 'border-box' };
const label: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 6 };
const primaryBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#2563eb', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' };
const secondaryBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#e5e7eb', color: '#111827', border: 'none', fontWeight: 600, cursor: 'pointer' };
