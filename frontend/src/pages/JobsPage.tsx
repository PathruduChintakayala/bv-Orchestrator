import { useEffect, useMemo, useState } from "react";
import type { Job, JobStatus } from "../types/job";
import { fetchJobs, createJob, cancelJob } from "../api/jobs";
import { fetchProcesses } from "../api/processes";
import { fetchRobots } from "../api/robots";

export default function JobsPage() {
  const [items, setItems] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus | "">("");
  const [modalOpen, setModalOpen] = useState(false);
  type FetchState<T> = { status: 'idle' | 'loading' | 'ready' | 'error'; data: T; error?: string };
  const [processesState, setProcessesState] = useState<FetchState<import('../types/processes').Process[]>>({ status: 'idle', data: [] });
  const [robotsState, setRobotsState] = useState<FetchState<import('../types/robot').Robot[]>>({ status: 'idle', data: [] });

  useEffect(() => {
    load();
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
      const url = new URL(hash.replace('#',''), 'http://localhost')
      const trig = url.searchParams.get('trigger')
      if (trig) setModalOpen(true)
    } catch {}
  }, []);

  async function load() {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchJobs(status ? { status } : undefined);
      setItems(data);
    } catch (e: any) {
      setError(e.message || "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }

  function openNew() { setModalOpen(true); }
  function closeModal() { setModalOpen(false); }

  async function handleTrigger(values: FormValues) {
    try {
      const payload = { processId: values.processId!, robotId: values.robotId ?? null, parameters: null };
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
    return "-";
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827' }}>Jobs</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={status} onChange={e=>setStatus(e.target.value as JobStatus | "")} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb' }}>
            <option value="">All statuses</option>
            {(['pending','running','completed','failed','canceled'] as JobStatus[]).map(s=> <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={load} style={secondaryBtn}>Apply</button>
          <button onClick={load} title="Refresh" style={{ ...secondaryBtn, padding: '10px', fontSize: '16px' }}>↻</button>
          <button onClick={openNew} style={primaryBtn}>Trigger Job</button>
        </div>
      </div>

      <div style={{ backgroundColor: '#fff', borderRadius: 12, boxShadow: '0 10px 24px rgba(15,23,42,0.08)', padding: 16 }}>
        {loading ? <p>Loading...</p> : error ? <p style={{color:'#b91c1c'}}>{error}</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', fontSize: 12, color: '#6b7280' }}>
                <th data-align="right" style={{ paddingBottom: 8 }}>ID</th>
                <th style={{ paddingBottom: 8 }}>Process</th>
                <th style={{ paddingBottom: 8 }}>Package</th>
                <th style={{ paddingBottom: 8 }}>Robot</th>
                <th style={{ paddingBottom: 8 }}>Status</th>
                <th style={{ paddingBottom: 8 }}>Created</th>
                <th style={{ paddingBottom: 8 }}>Duration</th>
                <th data-type="actions" style={{ paddingBottom: 8 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(j => (
                <tr key={j.id} style={{ fontSize: 14, color: '#111827' }}>
                  <td data-align="right" style={{ padding: '6px 0' }}>{j.id}</td>
                  <td style={{ padding: '6px 0' }}>{j.process?.name ?? j.processId}</td>
                  <td style={{ padding: '6px 0' }}>
                    {(() => {
                      const name = j.packageName ?? j.process?.package?.name;
                      const version = j.packageVersion ?? j.process?.package?.version;
                      const header = name && version ? `${name} (${version})` : (name || '-');
                      const exec = j.entrypointName
                        ? `Entrypoint: ${j.entrypointName}`
                        : (j.process?.scriptPath ? `Script: ${j.process.scriptPath}` : null);
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <div>{header}</div>
                          {exec && <div style={{ fontSize: 12, color: '#6b7280' }}>{exec}</div>}
                        </div>
                      );
                    })()}
                  </td>
                  <td style={{ padding: '6px 0' }}>{j.robot?.name ?? 'Unassigned'}</td>
                  <td style={{ padding: '6px 0' }}>{j.status}</td>
                  <td style={{ padding: '6px 0' }}>{new Date(j.createdAt).toLocaleString()}</td>
                  <td style={{ padding: '6px 0' }}>{duration(j)}</td>
                  <td data-type="actions" style={{ padding: '6px 0' }}>
                    {(j.status === 'pending' || j.status === 'running') && (
                      <button style={dangerBtn} onClick={()=>handleCancel(j.id)}>Cancel</button>
                    )}
                    {j.executionId && (
                      <button
                        style={{ ...secondaryBtn, marginLeft: 8 }}
                        onClick={() => { window.location.hash = `#/jobs/${j.id}/logs/${j.executionId}`; }}
                      >
                        View Logs
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={8} style={{ paddingTop: 12, color: '#6b7280' }}>No jobs found</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {modalOpen && (
        <TriggerModal processesState={processesState} robotsState={robotsState} onCancel={closeModal} onSave={handleTrigger} />
      )}
    </div>
  );
}

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
const dangerBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#dc2626', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' };
