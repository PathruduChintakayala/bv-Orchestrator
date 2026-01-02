import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Machine, MachineMode, MachineStatus } from "../types/machine";
import type { Robot } from "../types/robot";
import { createMachine, deleteMachine, fetchMachines, getMachine } from "../api/machines";
import { fetchRobots } from "../api/robots";

export default function MachinesPage() {
  const [items, setItems] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const [addOpen, setAddOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selected, setSelected] = useState<Machine | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchMachines();
      setItems(data);
    } catch (e: any) {
      setError(e.message || "Failed to load machines");
    } finally {
      setLoading(false);
    }
  }

  function openAdd() {
    setAddOpen(true);
  }
  function closeAdd() {
    setAddOpen(false);
  }

  async function openDetails(m: Machine) {
    try {
      setError(null);
      const fresh = await getMachine(m.id);
      setSelected(fresh);
      setDetailsOpen(true);
    } catch (e: any) {
      setError(e.message || "Failed to load machine details");
    }
  }
  function closeDetails() {
    setDetailsOpen(false);
    setSelected(null);
  }

  async function handleCreate(values: { name: string; mode: MachineMode }) {
    // Machine key must only be shown once (creation-time response)
    const created = await createMachine({ name: values.name, mode: values.mode });
    return created;
  }

  async function handleDelete(m: Machine) {
    if (m.robotCount > 0) return;
    if (!confirm("Delete this machine?")) return;
    try {
      await deleteMachine(m.id);
      await load();
    } catch (e: any) {
      alert(e.message || "Delete failed");
    }
  }

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter((m) => {
      const name = (m.name || "").toLowerCase();
      const mode = (m.mode || "").toLowerCase();
      const status = (m.status || "").toLowerCase();
      return name.includes(term) || mode.includes(term) || status.includes(term);
    });
  }, [items, search]);

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "#111827" }}>Machines</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search machines…"
            style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #e5e7eb" }}
          />
          <button onClick={() => setSearch(searchInput)} style={secondaryBtn}>Search</button>
          <button onClick={load} style={secondaryBtn}>Refresh</button>
          <button onClick={openAdd} style={primaryBtn}>Add Machine</button>
        </div>
      </div>

      <div style={{ backgroundColor: "#fff", borderRadius: 12, boxShadow: "0 10px 24px rgba(15,23,42,0.08)", padding: 16 }}>
        {loading ? (
          <p>Loading…</p>
        ) : error ? (
          <p style={{ color: "#b91c1c" }}>{error}</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", fontSize: 12, color: "#6b7280" }}>
                <th style={{ paddingBottom: 8 }}>Machine Name</th>
                <th style={{ paddingBottom: 8 }}>Mode</th>
                <th style={{ paddingBottom: 8 }}>Status</th>
                <th style={{ paddingBottom: 8 }}>Robots</th>
                <th style={{ paddingBottom: 8 }}>Last Seen</th>
                <th style={{ paddingBottom: 8 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((m) => (
                <MachineRow
                  key={m.id}
                  machine={m}
                  onOpen={() => openDetails(m)}
                  onDelete={() => handleDelete(m)}
                />
              ))}
              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ paddingTop: 12, color: "#6b7280" }}>
                    No machines found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {addOpen && (
        <AddMachineModal
          onCancel={closeAdd}
          onCreated={async (created) => {
            // Do not persist machineKey in list state; reload from server list.
            await load();
            return created;
          }}
          onCreate={handleCreate}
        />
      )}

      {detailsOpen && selected && (
        <MachineDetailsModal
          machine={selected}
          onClose={closeDetails}
          onDeleted={async () => {
            closeDetails();
            await load();
          }}
        />
      )}
    </div>
  );
}

function MachineRow({
  machine,
  onOpen,
  onDelete,
}: {
  machine: Machine;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const modeLabel = machine.mode === "runner" ? "Runner (Service)" : "Development";
  const deleteDisabled = machine.robotCount > 0;

  return (
    <tr
      style={{ fontSize: 14, color: "#111827", cursor: "pointer" }}
      onClick={() => {
        if (!open) onOpen();
      }}
    >
      <td style={{ padding: "6px 0" }}>{machine.name}</td>
      <td style={{ padding: "6px 0" }}>{modeLabel}</td>
      <td style={{ padding: "6px 0" }}>{renderStatusBadge(machine.status)}</td>
      <td style={{ padding: "6px 0" }}>{machine.robotCount}</td>
      <td style={{ padding: "6px 0" }}>{machine.lastSeenAt ? new Date(machine.lastSeenAt).toLocaleString() : "—"}</td>
      <td style={{ padding: "6px 0" }} onClick={(e) => e.stopPropagation()}>
        <div ref={menuRef} style={{ position: "relative", display: "inline-block" }}>
          <button
            style={secondaryBtn}
            onClick={() => setOpen((v) => !v)}
            aria-label="Actions"
          >
            Actions
          </button>
          {open && (
            <div
              role="menu"
              style={{
                position: "absolute",
                right: 0,
                marginTop: 8,
                background: "#fff",
                border: "1px solid #e5e7eb",
                boxShadow: "0 8px 20px rgba(0,0,0,0.08)",
                borderRadius: 8,
                minWidth: 180,
                overflow: "hidden",
                zIndex: 5,
              }}
            >
              <button
                onClick={() => {
                  setOpen(false);
                  onOpen();
                }}
                style={menuItemBtn}
              >
                View Details
              </button>
              <button
                onClick={() => {
                  if (deleteDisabled) return;
                  setOpen(false);
                  onDelete();
                }}
                style={{
                  ...menuItemBtn,
                  color: deleteDisabled ? "#9ca3af" : "#b91c1c",
                  cursor: deleteDisabled ? "not-allowed" : "pointer",
                }}
                title={deleteDisabled ? "Machine cannot be deleted while robots exist" : "Delete machine"}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

function AddMachineModal({
  onCancel,
  onCreate,
  onCreated,
}: {
  onCancel: () => void;
  onCreate: (v: { name: string; mode: MachineMode }) => Promise<Machine>;
  onCreated: (created: Machine) => Promise<Machine>;
}) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<MachineMode>("dev");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const canSubmit = useMemo(() => name.trim().length > 0 && !saving, [name, saving]);

  async function submit() {
    if (!name.trim()) return;
    try {
      setSaving(true);
      setError(null);
      const created = await onCreate({ name: name.trim(), mode });
      await onCreated(created);

      if (mode === "runner") {
        setCreatedKey(created.machineKey || "");
        return;
      }

      onCancel();
    } catch (e: any) {
      setError(e.message || "Create failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "grid", placeItems: "center" }}>
      <div style={{ width: "100%", maxWidth: 600, background: "#fff", borderRadius: 16, boxShadow: "0 4px 16px rgba(0,0,0,0.15)", padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "#111827", marginBottom: 12 }}>Add Machine</h2>

        {createdKey !== null ? (
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ fontSize: 14, color: "#111827", fontWeight: 600 }}>Machine Key</div>
            <div style={{ padding: 12, borderRadius: 8, border: "1px solid #e5e7eb", background: "#f9fafb", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace" }}>
              {createdKey || "(no key returned)"}
            </div>
            <div style={{ fontSize: 12, color: "#b45309" }}>
              Copy this key now. You will not be able to view it again.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button onClick={onCancel} style={primaryBtn}>Done</button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gap: 10 }}>
              <label>
                <div style={label}>Machine Name</div>
                <input value={name} onChange={(e) => setName(e.target.value)} style={input} />
              </label>

              <label>
                <div style={label}>Mode</div>
                <select value={mode} onChange={(e) => setMode(e.target.value as MachineMode)} style={input}>
                  <option value="dev">Development</option>
                  <option value="runner">Runner (Service)</option>
                </select>
              </label>

              {mode === "dev" ? (
                <div style={{ fontSize: 12, color: "#6b7280" }}>
                  Development machines are connected using SDK authentication.
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "#6b7280" }}>
                  Runner machines will return a one-time machine key on creation.
                </div>
              )}

              {error && <div style={{ fontSize: 12, color: "#b91c1c" }}>{error}</div>}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button onClick={onCancel} style={secondaryBtn}>Cancel</button>
              <button onClick={submit} disabled={!canSubmit} style={{ ...primaryBtn, opacity: canSubmit ? 1 : 0.6 }}>
                {saving ? "Creating…" : "Create"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MachineDetailsModal({
  machine,
  onClose,
  onDeleted,
}: {
  machine: Machine;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const [robots, setRobots] = useState<Robot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, [machine.id]);

  async function load() {
    try {
      setLoading(true);
      setError(null);
      const all = await fetchRobots();
      const filtered = all.filter((r) => (r.machineId ?? null) === machine.id);
      setRobots(filtered);
    } catch (e: any) {
      setError(e.message || "Failed to load robots");
    } finally {
      setLoading(false);
    }
  }

  const modeLabel = machine.mode === "runner" ? "Runner (Service)" : "Development";
  const canCreateRobot = machine.status === "connected";
  const deleteDisabled = machine.robotCount > 0;

  async function doDelete() {
    if (deleteDisabled) return;
    if (!confirm("Delete this machine?")) return;
    try {
      await deleteMachine(machine.id);
      await onDeleted();
    } catch (e: any) {
      alert(e.message || "Delete failed");
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "grid", placeItems: "center" }}>
      <div style={{ width: "100%", maxWidth: 900, background: "#fff", borderRadius: 16, boxShadow: "0 4px 16px rgba(0,0,0,0.15)", padding: 24, display: "flex", flexDirection: "column", gap: 16, maxHeight: "85vh", overflow: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#111827" }}>Machine Details</h2>
          <button onClick={onClose} style={secondaryBtn}>Close</button>
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>Machine Information</div>
          <div style={{ fontSize: 14, color: "#111827" }}><span style={{ color: "#6b7280" }}>Name:</span> {machine.name}</div>
          <div style={{ fontSize: 14, color: "#111827" }}><span style={{ color: "#6b7280" }}>Mode:</span> {modeLabel}</div>
          <div style={{ fontSize: 14, color: "#111827" }}><span style={{ color: "#6b7280" }}>Status:</span> {renderStatusBadge(machine.status)}</div>
          <div style={{ fontSize: 14, color: "#111827" }}><span style={{ color: "#6b7280" }}>Created At:</span> {machine.createdAt ? new Date(machine.createdAt).toLocaleString() : "—"}</div>
          <div style={{ fontSize: 14, color: "#111827" }}><span style={{ color: "#6b7280" }}>Last Seen:</span> {machine.lastSeenAt ? new Date(machine.lastSeenAt).toLocaleString() : "—"}</div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            style={{ ...primaryBtn, opacity: canCreateRobot ? 1 : 0.6 }}
            disabled={!canCreateRobot}
            title={!canCreateRobot ? "Machine must be connected" : "Create a robot"}
            onClick={() => {
              window.location.hash = "#/robots";
            }}
          >
            Create Robot
          </button>

          <button
            style={{ ...dangerBtn, opacity: deleteDisabled ? 0.6 : 1 }}
            disabled={deleteDisabled}
            title={deleteDisabled ? "Machine cannot be deleted while robots exist" : "Delete machine"}
            onClick={doDelete}
          >
            Delete Machine
          </button>
        </div>

        <div style={{ backgroundColor: "#fff", borderRadius: 12, boxShadow: "0 10px 24px rgba(15,23,42,0.08)", padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>Robots on this Machine</div>
            <button onClick={load} style={secondaryBtn}>Refresh</button>
          </div>

          {loading ? (
            <p>Loading…</p>
          ) : error ? (
            <p style={{ color: "#b91c1c" }}>{error}</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", fontSize: 12, color: "#6b7280" }}>
                  <th style={{ paddingBottom: 8 }}>Name</th>
                  <th style={{ paddingBottom: 8 }}>Status</th>
                  <th style={{ paddingBottom: 8 }}>Last heartbeat</th>
                  <th style={{ paddingBottom: 8 }}>Current job</th>
                </tr>
              </thead>
              <tbody>
                {robots.map((r) => (
                  <tr
                    key={r.id}
                    style={{ fontSize: 14, color: "#111827", cursor: "pointer" }}
                    onClick={() => {
                      window.location.hash = "#/robots";
                    }}
                    title="Open Robots"
                  >
                    <td style={{ padding: "6px 0" }}>{r.name}</td>
                    <td style={{ padding: "6px 0" }}>
                      <span
                        style={{
                          padding: "4px 8px",
                          borderRadius: 999,
                          backgroundColor: r.status === "online" ? "#dcfce7" : "#e5e7eb",
                          color: r.status === "online" ? "#166534" : "#374151",
                        }}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td style={{ padding: "6px 0" }}>{r.lastHeartbeat ? new Date(r.lastHeartbeat).toLocaleString() : "—"}</td>
                    <td style={{ padding: "6px 0" }}>{r.currentJobId ?? "—"}</td>
                  </tr>
                ))}
                {robots.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ paddingTop: 12, color: "#6b7280" }}>
                      No robots found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function renderStatusBadge(status: MachineStatus) {
  const bg = status === "connected" ? "#dcfce7" : "#e5e7eb";
  const fg = status === "connected" ? "#166534" : "#374151";
  return (
    <span style={{ padding: "4px 8px", borderRadius: 999, backgroundColor: bg, color: fg }}>
      {status === "connected" ? "connected" : "disconnected"}
    </span>
  );
}

const input: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  width: "100%",
  maxWidth: "100%",
  boxSizing: "border-box",
};
const label: React.CSSProperties = { fontSize: 12, color: "#6b7280", marginBottom: 6 };
const primaryBtn: React.CSSProperties = { padding: "10px 14px", borderRadius: 8, backgroundColor: "#2563eb", color: "#fff", border: "none", fontWeight: 600, cursor: "pointer" };
const secondaryBtn: React.CSSProperties = { padding: "10px 14px", borderRadius: 8, backgroundColor: "#e5e7eb", color: "#111827", border: "none", fontWeight: 600, cursor: "pointer" };
const dangerBtn: React.CSSProperties = { padding: "10px 14px", borderRadius: 8, backgroundColor: "#dc2626", color: "#fff", border: "none", fontWeight: 600, cursor: "pointer" };

const menuItemBtn: React.CSSProperties = {
  width: "100%",
  textAlign: "left",
  padding: "10px 12px",
  background: "transparent",
  border: "none",
  cursor: "pointer",
};
