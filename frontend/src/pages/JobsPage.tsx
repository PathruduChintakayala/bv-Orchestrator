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
  const [processes, setProcesses] = useState<import('../types/processes').Process[]>([]);
  const [robots, setRobots] = useState<import('../types/robot').Robot[]>([]);

  useEffect(() => {
    load();
    fetchProcesses({ activeOnly: true }).then(setProcesses).catch(()=>{});
    fetchRobots().then(setRobots).catch(()=>{});
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
      const payload = { processId: values.processId!, robotId: values.robotId ?? null, parameters: values.parameters || undefined };
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
          <button onClick={openNew} style={primaryBtn}>Trigger Job</button>
        </div>
      </div>

      <div style={{ backgroundColor: '#fff', borderRadius: 12, boxShadow: '0 10px 24px rgba(15,23,42,0.08)', padding: 16 }}>
        {loading ? <p>Loading...</p> : error ? <p style={{color:'#b91c1c'}}>{error}</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', fontSize: 12, color: '#6b7280' }}>
                <th style={{ paddingBottom: 8 }}>ID</th>
                <th style={{ paddingBottom: 8 }}>Process</th>
                <th style={{ paddingBottom: 8 }}>Package</th>
                <th style={{ paddingBottom: 8 }}>Robot</th>
                <th style={{ paddingBottom: 8 }}>Status</th>
                <th style={{ paddingBottom: 8 }}>Created</th>
                <th style={{ paddingBottom: 8 }}>Duration</th>
                <th style={{ paddingBottom: 8 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(j => (
                <tr key={j.id} style={{ fontSize: 14, color: '#111827' }}>
                  <td style={{ padding: '6px 0' }}>{j.id}</td>
                  <td style={{ padding: '6px 0' }}>{j.process?.name ?? j.processId}</td>
                  <td style={{ padding: '6px 0' }}>{j.process?.package ? `${j.process.package.name} (${j.process.package.version})` : '-'}</td>
                  <td style={{ padding: '6px 0' }}>{j.robot?.name ?? 'Unassigned'}</td>
                  <td style={{ padding: '6px 0' }}>{j.status}</td>
                  <td style={{ padding: '6px 0' }}>{new Date(j.createdAt).toLocaleString()}</td>
                  <td style={{ padding: '6px 0' }}>{duration(j)}</td>
                  <td style={{ padding: '6px 0' }}>
                    {(j.status === 'pending' || j.status === 'running') && (
                      <button style={dangerBtn} onClick={()=>handleCancel(j.id)}>Cancel</button>
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
        <TriggerModal processes={processes} robots={robots} onCancel={closeModal} onSave={handleTrigger} />
      )}
    </div>
  );
}

function TriggerModal({ processes, robots, onCancel, onSave }: { processes: import('../types/processes').Process[]; robots: import('../types/robot').Robot[]; onCancel: () => void; onSave: (v: FormValues) => void }) {
  const [form, setForm] = useState<FormValues>({ processId: undefined, robotId: undefined, parametersText: '' });
  const [saving, setSaving] = useState(false);

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const name = (e.target as any).name as string;
    const value = (e.target as any).value as string;
    const isIdField = name === 'processId' || name === 'robotId';
    setForm(prev => ({ ...prev, [name]: isIdField ? (value ? Number(value) : undefined) : value }));
  }

  function parseParams(): Record<string, unknown> | undefined {
    const t = (form.parametersText || '').trim();
    if (!t) return undefined;
    try {
      return JSON.parse(t);
    } catch {
      alert('Parameters must be valid JSON');
      return undefined;
    }
  }

  async function submit() {
    if (!form.processId) {
      alert('Process is required');
      return;
    }
    const params = parseParams();
    if (form.parametersText && !params) return;
    try {
      setSaving(true);
      await onSave({ processId: form.processId, robotId: form.robotId, parameters: params });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center' }}>
      <div style={{ width: '100%', maxWidth: 640, background: '#fff', borderRadius: 16, boxShadow: '0 4px 16px rgba(0,0,0,0.15)', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 12 }}>Trigger Job</h2>
        <div style={{ display: 'grid', gap: 10 }}>
          <label>
            <div style={label}>Process</div>
            <select name="processId" value={form.processId ?? ''} onChange={handleChange} style={input}>
              <option value="">Select a process</option>
              {processes.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label>
            <div style={label}>Robot (optional)</div>
            <select name="robotId" value={form.robotId ?? ''} onChange={handleChange} style={input}>
              <option value="">Any available (unassigned)</option>
              {robots.map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </label>
          <label>
            <div style={label}>Parameters (JSON, optional)</div>
            <textarea name="parametersText" value={form.parametersText || ''} onChange={handleChange} style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', width: '100%', maxWidth: '100%', boxSizing: 'border-box', minHeight: 100 }} placeholder='e.g. {"invoiceId":123}' />
          </label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button onClick={onCancel} style={secondaryBtn}>Cancel</button>
          <button onClick={submit} disabled={saving} style={primaryBtn}>{saving ? 'Triggering...' : 'Trigger'}</button>
        </div>
      </div>
    </div>
  );
}

type FormValues = {
  processId?: number;
  robotId?: number;
  parameters?: Record<string, unknown>;
  parametersText?: string;
};

const input: React.CSSProperties = { padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', width: '100%', maxWidth: '100%', boxSizing: 'border-box' };
const label: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 6 };
const primaryBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#2563eb', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' };
const secondaryBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#e5e7eb', color: '#111827', border: 'none', fontWeight: 600, cursor: 'pointer' };
const dangerBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#dc2626', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' };
