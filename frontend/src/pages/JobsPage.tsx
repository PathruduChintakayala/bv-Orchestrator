import { useEffect, useMemo, useState, useRef } from "react";
import { createPortal } from "react-dom";
import type { Job, JobStatus } from "../types/job";
import { fetchJobs, createJob, cancelJob } from "../api/jobs";
import { fetchProcesses } from "../api/processes";
import { fetchRobots } from "../api/robots";
import { getProcessTypeLabel, getProcessTypeTone } from "../utils/processTypes";
import { formatDisplayTime } from "../utils/datetime";
import React from "react";

export default function JobsPage() {
  const [items, setItems] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus | "">("");
  const [processId, setProcessId] = useState<number | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [runtimeType, setRuntimeType] = useState<string>("");
  const [source, setSource] = useState<string>("");
  const [timeRange, setTimeRange] = useState<string>("24h");
  const [sortBy, setSortBy] = useState<"started" | "ended" | "status" | "process" | "id">("started");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  type FetchState<T> = { status: 'idle' | 'loading' | 'ready' | 'error'; data: T; error?: string };
  const [processesState, setProcessesState] = useState<FetchState<import('../types/processes').Process[]>>({ status: 'idle', data: [] });
  const [robotsState, setRobotsState] = useState<FetchState<import('../types/robot').Robot[]>>({ status: 'idle', data: [] });
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
    const pid = hydrateFromHash();
    load(pid);
    setProcessesState({ status: 'loading', data: [] });
    setRobotsState({ status: 'loading', data: [] });

    fetchProcesses({ activeOnly: true })
      .then((data) => setProcessesState({ status: 'ready', data }))
      .catch((e: any) => setProcessesState({ status: 'error', data: [], error: e?.message || 'Failed to load processes' }));

    fetchRobots()
      .then((data) => setRobotsState({ status: 'ready', data }))
      .catch((e: any) => setRobotsState({ status: 'error', data: [], error: e?.message || 'Failed to load robots' }));
    // Open modal if hash includes trigger flag
    try {
      const hash = window.location.hash || '#/jobs'
      const url = new URL(hash.replace('#', ''), 'http://localhost')
      const trig = url.searchParams.get('trigger')
      if (trig) setModalOpen(true)
    } catch { }
  }, []);

  async function load(nextProcessId: number | undefined = processId) {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchJobs({ status: status || undefined, processId: nextProcessId });
      setItems(data);
    } catch (e: any) {
      setError(e.message || "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }

  function hydrateFromHash(): number | undefined {
    try {
      const hash = window.location.hash || '#/automations/jobs';
      const url = new URL(hash.replace('#', ''), 'http://localhost');
      const pid = url.searchParams.get('processId');
      const src = url.searchParams.get('source');
      if (src) setSource(src);
      if (pid) {
        const num = Number(pid);
        setProcessId(num);
        return num;
      }
    } catch {/* ignore parse errors */ }
    return undefined;
  }

  function toggleSort(key: typeof sortBy) {
    if (sortBy === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(key);
      setSortDir('desc');
    }
  }

  function openNew() { setModalOpen(true); }
  function closeModal() { setModalOpen(false); }

  async function handleTrigger(values: FormValues) {
    try {
      const payload = { processId: values.processId!, robotId: values.robotId ?? null, parameters: undefined };
      await createJob(payload);
      closeModal();
      await load();
    } catch (e: any) {
      alert(e.message || "Trigger failed");
    }
  }

  async function handleCancel(id: number) {
    try {
      await cancelJob(id);
      await load();
    } catch (e: any) {
      alert(e.message || "Cancel failed");
    }
  }

  function duration(j: Job): string {
    if (j.startedAt && j.finishedAt) {
      const s = new Date(j.startedAt).getTime();
      const f = new Date(j.finishedAt).getTime();
      const ms = Math.max(0, f - s);
      const sec = Math.round(ms / 1000);
      const min = Math.floor(sec / 60);
      const rem = sec % 60;
      return `${min}m ${rem}s`;
    }
    if (j.startedAt && !j.finishedAt) return "Running";
    return "-";
  }

  function runtimeLabel(j: Job) {
    return getProcessTypeLabel(j.process?.package?.isBvpackage ?? false)
  }

  function sourceLabel(j: Job) {
    // No explicit source in API; default to Manual for now.
    return (j.parameters as any)?.source || "Manual";
  }

  function hostname(j: Job) {
    return j.hostname || j.robot?.machineName || j.robot?.machineInfo || j.robot?.name || "-";
  }

  function stateBadge(j: Job) {
    const state = j.status;
    return <span className={`job-pill state-${state}`}>{state}</span>;
  }

  function startedLabel(j: Job) {
    return formatDisplayTime(j.startedAt);
  }

  function endedLabel(j: Job) {
    return formatDisplayTime(j.finishedAt);
  }

  function resetFilters() {
    setStatus("");
    setRuntimeType("");
    setSource("");
    setTimeRange("24h");
    setSearch("");
    setProcessId(undefined);
    setPage(0);
    void load(undefined);
  }

  function applyFiltersAndSort(raw: Job[]) {
    const now = Date.now();
    const windowMs = timeRange === "24h" ? 24 * 60 * 60 * 1000 : timeRange === "7d" ? 7 * 24 * 60 * 60 * 1000 : undefined;
    const filtered = raw.filter(j => {
      if (runtimeType && runtimeLabel(j) !== runtimeType) return false;
      if (source && sourceLabel(j) !== source) return false;
      if (windowMs) {
        const created = new Date(j.createdAt).getTime();
        if (isFinite(created) && now - created > windowMs) return false;
      }
      if (search.trim()) {
        const needle = search.trim().toLowerCase();
        const hay = [j.process?.name, hostname(j), String(j.id)].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      const va = sortValue(a, sortBy);
      const vb = sortValue(b, sortBy);
      if (va === vb) return 0;
      return va > vb ? dir : -dir;
    });
    return sorted;
  }

  function sortValue(j: Job, key: typeof sortBy) {
    if (key === "started") return new Date(j.startedAt || j.createdAt).getTime();
    if (key === "ended") return new Date(j.finishedAt || 0).getTime();
    if (key === "status") return j.status;
    if (key === "process") return j.process?.name || "";
    return j.id;
  }

  const filtered = useMemo(() => applyFiltersAndSort(items), [items, runtimeType, source, search, timeRange, sortBy, sortDir]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(currentPage * pageSize, currentPage * pageSize + pageSize);

  return (
    <div style={{ padding: 16 }}>
      <div className="page-shell" style={{ gap: 12 }}>
        <div className="surface-card" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h1 className="page-title" style={{ margin: 0 }}>Jobs</h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              placeholder="Search by process, host, or job ID"
              className="search-input"
              style={{ minWidth: 240 }}
            />
            <button onClick={() => load(processId)} className="btn btn-ghost" aria-label="Refresh">↻</button>
            <button onClick={resetFilters} className="btn btn-secondary">Reset</button>
            <button onClick={() => setShowFilters(!showFilters)} className="btn btn-ghost">{showFilters ? 'Hide Filters ▾' : 'Show Filters ▸'}</button>
            <button onClick={openNew} className="btn btn-primary">Trigger Job</button>
          </div>
        </div>

        <div className="surface-card" style={{ display: showFilters ? 'grid' : 'none', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, alignItems: 'center' }}>
          <label style={label}>State
            <select value={status} onChange={e => { setStatus(e.target.value as JobStatus | ""); setPage(0); }} style={input}>
              <option value="">All</option>
              {(['pending', 'running', 'completed', 'failed', 'canceled'] as JobStatus[]).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label style={label}>Runtime type
            <select value={runtimeType} onChange={e => { setRuntimeType(e.target.value); setPage(0); }} style={input}>
              <option value="">All</option>
              <option value="RPA">RPA</option>
              <option value="Agent">Agent</option>
            </select>
          </label>
          <label style={label}>Source
            <select value={source} onChange={e => { setSource(e.target.value); setPage(0); }} style={input}>
              <option value="">All</option>
              <option value="Manual">Manual</option>
              <option value="Trigger">Trigger</option>
            </select>
          </label>
          <label style={label}>Time range
            <select value={timeRange} onChange={e => { setTimeRange(e.target.value); setPage(0); }} style={input}>
              <option value="24h">Last 24h</option>
              <option value="7d">Last 7d</option>
              <option value="all">All time</option>
            </select>
          </label>
          <label style={label}>Process filter
            <select value={processId ?? ''} onChange={e => { const v = e.target.value ? Number(e.target.value) : undefined; setProcessId(v); setPage(0); load(v); }} style={input}>
              <option value="">All processes</option>
              {processesState.data.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        </div>

        <div className="surface-card">
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          <div className="table-wrapper" role="region" aria-live="polite">
            <table className="processes-table" aria-busy={loading}>
              <thead>
                <tr>
                  <th onClick={() => toggleSort('process')} role="button">Process</th>
                  <th>Type</th>
                  <th onClick={() => toggleSort('status')} role="button">State</th>
                  <th onClick={() => toggleSort('started')} role="button">Started</th>
                  <th onClick={() => toggleSort('ended')} role="button">Ended</th>
                  <th>Duration</th>
                  <th>Runtime</th>
                  <th>Source</th>
                  <th>Hostname</th>
                  <th className="actions-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && SkeletonRows(8)}
                {!loading && visible.map(j => (
                  <tr key={j.id} className="data-row">
                    <td>
                      <div className="cell-primary">{j.process?.name || `Process ${j.processId}`}</div>
                    </td>
                    <td><Badge tone={getProcessTypeTone(j.process?.package?.isBvpackage ?? false)}>{runtimeLabel(j)}</Badge></td>
                    <td>{stateBadge(j)}</td>
                    <td className="cell-secondary">{startedLabel(j)}</td>
                    <td className="cell-secondary">{endedLabel(j)}</td>
                    <td>{duration(j)}</td>
                    <td>{runtimeLabel(j)}</td>
                    <td>{sourceLabel(j)}</td>
                    <td>{hostname(j)}</td>
                    <td className="actions-col">
                      <ActionMenu
                        open={menuOpenId === j.id}
                        onToggle={() => setMenuOpenId(menuOpenId === j.id ? null : j.id)}
                        onClose={() => setMenuOpenId(null)}
                        actions={[
                          ...(j.status === 'running' || j.status === 'pending' ? [{ label: "Stop", onClick: () => handleCancel(j.id) }] : []),
                          { label: "Restart", onClick: () => { void handleTrigger({ processId: j.processId, robotId: j.robotId ?? undefined, parameters: null }); } },
                          { label: "View logs for this job", onClick: () => { if (j.executionId) window.location.hash = `#/automations/logs?jobId=${j.id}&executionId=${j.executionId}&processId=${j.processId}`; }, disabled: !j.executionId },
                          { label: "View logs for this process", onClick: () => { window.location.hash = `#/automations/logs?processId=${j.processId}`; } },
                          { label: "Kill", tone: "danger" as const, onClick: () => { alert('Kill not implemented'); } },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
                {!loading && visible.length === 0 && (
                  <tr><td colSpan={10}>
                    <div className="empty-state">
                      <div>
                        <p className="empty-title">No jobs match these filters</p>
                        <p className="empty-body">Adjust state, time range, or search to see results.</p>
                      </div>
                      <button className="btn btn-secondary" onClick={resetFilters}>Reset filters</button>
                    </div>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
            <div style={{ color: '#6b7280', fontSize: 12 }}>Showing {visible.length} of {filtered.length}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={() => setPage(Math.max(0, currentPage - 1))} disabled={currentPage === 0} className="btn btn-ghost">Prev</button>
              <span style={{ fontSize: 12, color: '#111827' }}>Page {currentPage + 1} / {pageCount}</span>
              <button onClick={() => setPage(Math.min(pageCount - 1, currentPage + 1))} disabled={currentPage >= pageCount - 1} className="btn btn-ghost">Next</button>
              <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(0); }} style={{ ...input, width: 120 }}>
                {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n} / page</option>)}
              </select>
            </div>
          </div>
        </div>

        {modalOpen && (
          <TriggerModal processesState={processesState} robotsState={robotsState} onCancel={closeModal} onSave={handleTrigger} />
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
          <td><div className="skeleton shimmer" style={{ width: "160px" }} /></td>
          <td><div className="skeleton shimmer" style={{ width: "70px" }} /></td>
          <td><div className="skeleton shimmer" style={{ width: "90px" }} /></td>
          <td><div className="skeleton shimmer" style={{ width: "120px" }} /></td>
          <td><div className="skeleton shimmer" style={{ width: "120px" }} /></td>
          <td><div className="skeleton shimmer" style={{ width: "80px" }} /></td>
          <td><div className="skeleton shimmer" style={{ width: "70px" }} /></td>
          <td><div className="skeleton shimmer" style={{ width: "90px" }} /></td>
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
    const menuHeight = actions.length * 40 + 16;
    const menuWidth = 180;

    let top = rect.bottom + 8;
    let left = rect.right - menuWidth;

    if (top + menuHeight > viewportHeight && rect.top - menuHeight - 8 > 0) {
      top = rect.top - menuHeight - 8;
    }
    if (left < 0) left = rect.left;
    if (left + menuWidth > viewportWidth) left = viewportWidth - menuWidth - 8;

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
        className="btn btn-ghost icon-button"
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

type MenuAction = { label: string; onClick: () => void; tone?: "danger"; disabled?: boolean };

function TriggerModal({ processesState, robotsState, onCancel, onSave }: { processesState: { status: 'idle' | 'loading' | 'ready' | 'error'; data: import('../types/processes').Process[]; error?: string }; robotsState: { status: 'idle' | 'loading' | 'ready' | 'error'; data: import('../types/robot').Robot[]; error?: string }; onCancel: () => void; onSave: (v: FormValues) => void }) {
  const processes = processesState.data;
  const robots = robotsState.data;
  const [form, setForm] = useState<FormValues>({ processId: undefined, robotId: undefined });
  const [saving, setSaving] = useState(false);
  const currentProcess = useMemo(() => processes.find(p => p.id === form.processId) || null, [processes, form.processId]);

  useEffect(() => {
    if (!form.processId && processes.length > 0) {
      setForm(prev => ({ ...prev, processId: processes[0].id }));
    }
  }, [processes, form.processId]);

  function handleProcessChange(val?: number) {
    setForm(prev => ({ ...prev, processId: val }));
  }

  function handleRobotChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value
    setForm(prev => ({ ...prev, robotId: value ? Number(value) : undefined }))
  }



  async function submit() {
    if (!form.processId) {
      alert('Process is required')
      return
    }

    try {
      setSaving(true)
      await onSave({ processId: form.processId, robotId: form.robotId, parameters: null })
    } finally {
      setSaving(false)
    }
  }

  const loadingData = processesState.status === 'loading' || robotsState.status === 'loading';
  const dataError = processesState.status === 'error' ? processesState.error : robotsState.status === 'error' ? robotsState.error : null;
  const ready = processesState.status === 'ready' && robotsState.status === 'ready';
  const canSubmit = ready && !!form.processId;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center' }}>
      <div style={{ width: '100%', maxWidth: 760, background: '#fff', borderRadius: 16, boxShadow: '0 4px 16px rgba(0,0,0,0.15)', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 12 }}>Trigger Job</h2>

        {loadingData && (
          <div style={{ fontSize: 14, color: '#6b7280' }}>Loading processes and robots…</div>
        )}

        {dataError && (
          <div style={{ fontSize: 14, color: '#b91c1c' }}>Failed to load required data. {dataError}</div>
        )}

        {ready && (
          <div style={{ display: 'grid', gap: 12 }}>
            {processes.length === 0 && (
              <div style={{ fontSize: 14, color: '#6b7280' }}>No processes available. Please create a process first.</div>
            )}

            <div style={{ display: 'grid', gap: 8 }}>
              <div style={label}>Process</div>
              <SearchableSelect
                options={processes.map((p) => ({ label: p.name, value: String(p.id) }))}
                value={form.processId ? String(form.processId) : undefined}
                placeholder={processes.length ? 'Select process' : 'No processes'}
                onChange={(val) => handleProcessChange(val ? Number(val) : undefined)}
                disabled={processes.length === 0}
              />
              {currentProcess && (
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  {currentProcess.package?.name ? `${currentProcess.package.name} ${currentProcess.package.version || ''}`.trim() : 'Legacy process'}
                  {currentProcess.entrypointName ? ` • Entrypoint: ${currentProcess.entrypointName}` : currentProcess.scriptPath ? ` • Script: ${currentProcess.scriptPath}` : ''}
                </div>
              )}
            </div>

            <label>
              <div style={label}>Robot (optional)</div>
              <select name="robotId" value={form.robotId ?? ''} onChange={handleRobotChange} style={input}>
                <option value="">Any available (unassigned)</option>
                {robots.map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </label>

          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button onClick={onCancel} style={secondaryBtn}>Cancel</button>
          <button onClick={submit} disabled={saving || !canSubmit} style={primaryBtn}>{saving ? 'Triggering...' : 'Trigger'}</button>
        </div>
      </div>
    </div>
  );
}

type FormValues = {
  processId?: number;
  robotId?: number;
  parameters?: null;
};

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

const input: React.CSSProperties = { padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', width: '100%', maxWidth: '100%', boxSizing: 'border-box' };
const label: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 6 };
const primaryBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#2563eb', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' };
const secondaryBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#e5e7eb', color: '#111827', border: 'none', fontWeight: 600, cursor: 'pointer' };
