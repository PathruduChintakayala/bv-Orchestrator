import { useEffect, useState } from "react";
import { fetchDashboardOverview } from "../api/dashboard";
import type { DashboardOverview } from "../types/dashboard";

export default function DashboardPage() {
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboardOverview()
      .then(setData)
      .catch((e) => setError(e.message || "Error"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Centered><Card><h2>Loading dashboard…</h2></Card></Centered>;
  if (error) return <Centered><Card><h2>Error</h2><p style={{color:'#b91c1c'}}>{error}</p><a href="#/" style={{color:'#2563eb'}}>Go to Login</a></Card></Centered>;
  if (!data) return null;

  return (
    <div style={{ padding: 16 }}>
      <div className="page-shell" style={{ gap: 12 }}>
        <div className="surface-card" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h1 className="page-title" style={{ margin: 0 }}>Dashboard</h1>
          </div>
        </div>

        <SummaryTiles data={data} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          <JobStatusPanel counts={data.jobStatusCounts} />
          <JobHistoryPanel history={data.jobHistory24h} />
        </div>

        <TransactionsPanel />

        <RecentJobsPanel jobs={data.recentJobs} />
      </div>
    </div>
  );
}



function JobHistoryPanel({ history = { total: 0, success: 0, failed: 0, stopped: 0 } }: { history?: DashboardOverview['jobHistory24h'] }) {
  const safe = history || { total: 0, success: 0, failed: 0, stopped: 0 };
  const legend = [
    { key: 'success', label: 'Success', value: safe.success, color: '#16a34a' },
    { key: 'failed', label: 'Failed', value: safe.failed, color: '#dc2626' },
    { key: 'stopped', label: 'Stopped', value: safe.stopped, color: '#f59e0b' },
  ];
  const segments = legend.filter(s => (s.value ?? 0) > 0);

  const total = safe.total ?? 0;
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  const arcs = segments.map(seg => {
    const frac = total > 0 ? seg.value / total : 0;
    const len = frac * circumference;
    const arc = { ...seg, offset, length: len };
    offset += len;
    return arc;
  });

  return (
    <div style={{ backgroundColor: '#fff', borderRadius: 12, boxShadow: '0 10px 24px rgba(15,23,42,0.08)', padding: 16, minHeight: 240 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 12 }}>Job History (Last 24h)</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', alignItems: 'center', gap: 12 }}>
        <div style={{ position: 'relative', width: 140, height: 140 }}>
          <svg width="140" height="140" viewBox="0 0 200 200">
            <g transform="translate(100,100)">
              <circle r={radius} fill="#f9fafb" stroke="#e5e7eb" strokeWidth={24} />
              {arcs.map((seg) => (
                <circle
                  key={seg.key}
                  r={radius}
                  fill="transparent"
                  stroke={seg.color}
                  strokeWidth={24}
                  strokeDasharray={`${seg.length} ${circumference - seg.length}`}
                  strokeDashoffset={-seg.offset}
                  transform="rotate(-90)"
                  style={{ transition: 'stroke-dasharray 0.3s ease, stroke 0.3s ease' }}
                />
              ))}
              <text x="0" y="-6" textAnchor="middle" style={{ fontSize: 22, fontWeight: 700, fill: '#111827' }}>{total}</text>
              <text x="0" y="16" textAnchor="middle" style={{ fontSize: 12, fill: '#6b7280' }}>jobs</text>
            </g>
          </svg>
          {total === 0 && (
            <div style={{ position: 'absolute', bottom: -4, width: '100%', textAlign: 'center', fontSize: 12, color: '#6b7280' }}>
              No jobs in the last 24h
            </div>
          )}
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          {legend.map(seg => {
            const zero = (seg.value ?? 0) === 0;
            return (
              <div key={seg.key} style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: zero ? 0.4 : 1 }}>
                <span style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: seg.color }} />
                <span style={{ fontWeight: 600, color: '#111827' }}>{seg.label}</span>
                <span style={{ color: '#6b7280' }}>{seg.value ?? 0}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  );
}

function SummaryTiles({ data }: { data: DashboardOverview }) {
  const tiles = [
    { label: 'Processes', value: data.summary.totalProcesses, sub: `Active ${data.summary.activeProcesses}`, href: '#/processes', icon: '🧭' },
    { label: 'Assets', value: data.summary.totalAssets, href: '#/assets', icon: '💾' },
    { label: 'Queues', value: data.summary.totalQueues, href: '#/queues', icon: '📦' },
    { label: 'Triggers', value: data.summary.totalTriggers, href: '#/automations/triggers', icon: '⏰' },
    { label: 'Accounts', value: data.summary.totalAccounts, href: '#/access/users', icon: '👤' },
    { label: 'Machines', value: data.summary.totalMachines, href: '#/machines', icon: '🖥️' },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
      {tiles.map(tile => (
        <button
          key={tile.label}
          onClick={() => { window.location.hash = tile.href; }}
          style={{
            textAlign: 'left',
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 12,
            padding: '12px 14px',
            boxShadow: '0 10px 24px rgba(15,23,42,0.06)',
            cursor: 'pointer',
            display: 'grid',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#6b7280', fontWeight: 600 }}>
            <span>{tile.icon}</span>
            <span>{tile.label}</span>
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#111827' }}>{tile.value}</div>
          {tile.sub && <div style={{ fontSize: 12, color: '#6b7280' }}>{tile.sub}</div>}
        </button>
      ))}
    </div>
  );
}

function RecentJobsPanel({ jobs }: { jobs: DashboardOverview['recentJobs'] }) {
  const statusColor = (s: string) => s === 'running' ? '#2563eb' : s === 'completed' ? '#16a34a' : s === 'failed' ? '#dc2626' : '#f59e0b';
  return (
    <div style={{ backgroundColor: '#fff', borderRadius: 12, boxShadow: '0 10px 24px rgba(15,23,42,0.08)', padding: 16 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 12 }}>Recent Jobs</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', fontSize: 12, color: '#6b7280' }}>
            <th style={{ paddingBottom: 8 }}>ID</th>
            <th style={{ paddingBottom: 8 }}>Process</th>
            <th style={{ paddingBottom: 8 }}>Robot</th>
            <th style={{ paddingBottom: 8 }}>Status</th>
            <th style={{ paddingBottom: 8 }}>Created</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id} style={{ fontSize: 14, color: '#111827' }}>
              <td style={{ padding: '6px 0' }}>{j.id}</td>
              <td style={{ padding: '6px 0' }}>{j.processName}</td>
              <td style={{ padding: '6px 0' }}>{j.robotName ?? '—'}</td>
              <td style={{ padding: '6px 0', color: statusColor(j.status) }}>{j.status}</td>
              <td style={{ padding: '6px 0' }}>{j.createdAt}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
        <button style={secondaryBtn} onClick={() => { window.location.hash = '#/jobs?trigger=1' }}>Trigger Job</button>
        <button style={primaryBtn} onClick={() => { window.location.hash = '#/processes' }}>View All Processes</button>
      </div>
    </div>
  );
}

function JobStatusPanel({ counts = { running: 0, pending: 0, stopping: 0, terminating: 0, suspended: 0, resumed: 0 } }: { counts?: DashboardOverview['jobStatusCounts'] }) {
  const items = [
    { key: 'running', label: 'Running', color: '#2563eb' },
    { key: 'pending', label: 'Pending', color: '#6b7280' },
    { key: 'stopping', label: 'Stopping', color: '#f59e0b' },
    { key: 'terminating', label: 'Terminating', color: '#b91c1c' },
    { key: 'suspended', label: 'Suspended', color: '#a855f7' },
    { key: 'resumed', label: 'Resumed', color: '#16a34a' },
  ];
  return (
    <div style={{ backgroundColor: '#fff', borderRadius: 12, boxShadow: '0 10px 24px rgba(15,23,42,0.08)', padding: 16 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 12 }}>Jobs Status</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
        {items.map(item => (
          <div key={item.key} style={{ padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: item.color }} />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontWeight: 700, color: '#111827' }}>{(counts as any)[item.key] ?? 0}</span>
              <span style={{ fontSize: 12, color: '#6b7280' }}>{item.label}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TransactionsPanel() {
  return (
    <div style={{ backgroundColor: '#fff', borderRadius: 12, boxShadow: '0 10px 24px rgba(15,23,42,0.08)', padding: 16 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 8 }}>Transactions</h2>
      <div style={{ color: '#6b7280', marginBottom: 12 }}>Selected range: Last 24 hours</div>
      <div style={{ padding: '14px', border: '1px dashed #e5e7eb', borderRadius: 10, color: '#6b7280', textAlign: 'center' }}>
        No transaction data yet.
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', width: '100%', display: 'grid', placeItems: 'center', backgroundColor: '#f3f4f6', padding: 24 }}>
      {children}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ width: '100%', maxWidth: 480, padding: '24px 20px', borderRadius: 16, backgroundColor: '#fff', boxShadow: '0 18px 45px rgba(15,23,42,0.12)' }}>
      {children}
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 8,
  backgroundColor: '#2563eb',
  color: '#fff',
  border: 'none',
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryBtn: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 8,
  backgroundColor: '#e5e7eb',
  color: '#111827',
  border: 'none',
  fontWeight: 600,
  cursor: 'pointer',
};
