import { useEffect, useMemo, useState, type CSSProperties } from "react"
import type { Trigger } from "../types/trigger"
import type { Process } from "../types/processes"
import type { Queue } from "../types/queue"
import type { Robot } from "../types/robot"
import { fetchTriggers, enableTrigger, disableTrigger, deleteTrigger } from "../api/triggers"
import { fetchProcesses } from "../api/processes"
import { fetchQueues } from "../api/queues"
import { fetchRobots } from "../api/robots"
import { createJob } from "../api/jobs"
import TriggerModal from "../components/TriggerModal"

const primaryBtn: CSSProperties = { padding: "10px 14px", borderRadius: 8, backgroundColor: "#2563eb", color: "#fff", border: "none", fontWeight: 600, cursor: "pointer" }
const secondaryBtn: CSSProperties = { padding: "10px 14px", borderRadius: 8, backgroundColor: "#e5e7eb", color: "#111827", border: "none", fontWeight: 600, cursor: "pointer" }

export default function TriggersPage() {
  const [items, setItems] = useState<Trigger[]>([])
  const [processes, setProcesses] = useState<Process[]>([])
  const [queues, setQueues] = useState<Queue[]>([])
  const [robots, setRobots] = useState<Robot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Trigger | null>(null)
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [search, setSearch] = useState("")

  useEffect(() => { void load() }, [])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as HTMLElement
      if (!target.closest('.action-menu')) {
        setMenuOpenId(null)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  async function load() {
    try {
      setLoading(true); setError(null)
      const [ts, ps, qs, rs] = await Promise.all([
        fetchTriggers(),
        fetchProcesses({ activeOnly: false }),
        fetchQueues({ search: "" }),
        fetchRobots(),
      ])
      setItems(ts)
      setProcesses(ps)
      setQueues(qs)
      setRobots(rs)
    } catch (e: any) {
      setError(e.message || "Failed to load triggers")
    } finally {
      setLoading(false)
    }
  }

  const processNameById = useMemo(() => {
    const m = new Map<number, string>()
    processes.forEach(p => m.set(p.id, p.name))
    return m
  }, [processes])

  const filtered = items.filter(t => t.name.toLowerCase().includes(search.toLowerCase()) || processNameById.get(t.processId)?.toLowerCase().includes(search.toLowerCase()))

  async function toggleTrigger(t: Trigger, nextEnabled: boolean) {
    try {
      setToggling(t.id)
      if (nextEnabled) {
        await enableTrigger(t.id)
      } else {
        await disableTrigger(t.id)
      }
      await load()
    } catch (e: any) {
      alert(e.message || "Action failed")
    } finally {
      setToggling(null)
    }
  }

  async function handleRunNow(t: Trigger) {
    try {
      await createJob({ processId: t.processId, robotId: t.robotId ?? null, parameters: { source: 'Trigger', triggerId: t.id } })
      alert('Job started from trigger')
    } catch (e: any) {
      alert(e.message || 'Run failed')
    }
  }

  function handleEdit(t: Trigger) {
    setEditing(t)
    setModalOpen(true)
  }

  async function handleDelete(t: Trigger) {
    if (!confirm('Delete this trigger?')) return
    try {
      await deleteTrigger(t.id)
      await load()
    } catch (e: any) {
      alert(e.message || 'Delete failed')
    }
  }

  function handleViewJobs(t: Trigger) {
    window.location.hash = `#/automations/jobs?processId=${t.processId}&source=Trigger`
  }

  return (
    <div style={{ padding: 16 }}>
      <div className="page-shell" style={{ gap: 12 }}>
        <div className="surface-card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "#111827", margin: 0 }}>Triggers</h1>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search triggers by name or process"
              style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", width: 250 }}
            />
            <button onClick={() => void load()} title="Refresh" style={{ ...secondaryBtn, padding: "10px", fontSize: "16px" }}>↻</button>
            <button onClick={() => setModalOpen(true)} style={primaryBtn}>New Trigger</button>
          </div>
        </div>

        <div className="surface-card" style={{ padding: 16 }}>
        {loading ? <p>Loading...</p> : error ? <p style={{ color: "#b91c1c" }}>{error}</p> : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Process</th>
                <th>Last fired</th>
                <th>Next fire</th>
                <th>Enabled</th>
                <th data-type="actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{t.type}</td>
                  <td>{processNameById.get(t.processId) || `Process ${t.processId}`}</td>
                  <td>{t.lastFiredAt ? new Date(t.lastFiredAt).toLocaleString() : "—"}</td>
                  <td>{t.nextFireAt ? new Date(t.nextFireAt).toLocaleString() : "—"}</td>
                  <td>{t.enabled ? "Yes" : "No"}</td>
                  <td data-type="actions">
                    <button onClick={() => void handleRunNow(t)} className="btn btn-ghost icon-button" title="Run trigger" aria-label="Run trigger">
                      ▶
                    </button>
                    <ActionMenu
                      open={menuOpenId === t.id}
                      onToggle={() => setMenuOpenId(menuOpenId === t.id ? null : t.id)}
                      onClose={() => setMenuOpenId(null)}
                      actions={[
                        { label: "Edit", onClick: () => handleEdit(t) },
                        { label: t.enabled ? "Disable" : "Enable", onClick: () => void toggleTrigger(t, !t.enabled) },
                        { label: "View Jobs", onClick: () => handleViewJobs(t) },
                        { label: "Remove", tone: "danger", onClick: () => void handleDelete(t) },
                      ]}
                    />
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} style={{ paddingTop: 12, color: "#6b7280" }}>No triggers found</td></tr>
              )}
            </tbody>
          </table>
        )}
        </div>

        <TriggerModal
          open={modalOpen}
          onClose={() => { setModalOpen(false); setEditing(null) }}
          onCreated={() => load()}
          processes={processes}
          queues={queues}
          robots={robots}
          trigger={editing}
        />
      </div>
    </div>
  )
}

type MenuAction = { label: string; onClick: () => void; tone?: "danger" }
function ActionMenu({ open, onToggle, onClose, actions }: { open: boolean; onToggle: () => void; onClose: () => void; actions: MenuAction[] }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="action-menu">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onToggle}
        className="btn btn-ghost icon-button"
      >
        ⋮
      </button>
      {open && (
        <div className="menu-panel" role="menu">
          {actions.map((a) => (
            <button
              key={a.label}
              role="menuitem"
              className={`menu-item ${a.tone === "danger" ? "danger" : ""}`}
              onClick={() => { a.onClick(); onClose(); }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
