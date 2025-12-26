import { useEffect, useMemo, useState } from "react";
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

  const longestRunningMinutes = useMemo(() => {
    if (!data) return null;
    const running = data.recentJobs.filter((j) => j.status === "running" && j.startedAt);
    if (running.length === 0) return null;
    const now = Date.now();
    const durations = running.map((j) => {
      const start = new Date(j.startedAt as string).getTime();
      return Math.max(0, Math.round((now - start) / 60000));
    });
    return Math.max(...durations);
  }, [data]);

  if (loading) return <Centered><Card><h2>Loading dashboard…</h2></Card></Centered>;
  if (error) return <Centered><Card><h2>Error</h2><p style={{color:'#b91c1c'}}>{error}</p><a href="#/" style={{color:'#2563eb'}}>Go to Login</a></Card></Centered>;
  if (!data) return null;

  return (
    <div style={{ padding: 24 }}>
      <Header />
      <SummaryRow data={data} longestRunningMinutes={longestRunningMinutes} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <RobotsPanel robots={data.robots} />
        <RecentJobsPanel jobs={data.recentJobs} />
      </div>
    </div>
  );
}

function Header() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827' }}>Dashboard</h1>
    </div>
  );
}

function SummaryRow({ data, longestRunningMinutes }: { data: DashboardOverview; longestRunningMinutes: number | null }) {
  const card = (title: string, main: string, sub?: string) => (
    <div style={{ backgroundColor: '#fff', borderRadius: 12, boxShadow: '0 10px 24px rgba(15,23,42,0.08)', padding: 16 }}>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: '#111827' }}>{main}</div>
      {sub && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{sub}</div>}
    </div>
  );
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
      {card('Total Robots', String(data.summary.totalRobots), `Online: ${data.summary.onlineRobots} / Offline: ${data.summary.offlineRobots}`)}
      {card('Jobs Today', String(data.summary.jobsTodayTotal), `Success: ${data.summary.jobsTodaySuccess} / Fail: ${data.summary.jobsTodayFailed}`)}
      {card('Running Jobs', String(data.summary.runningJobs), `Longest running: ${longestRunningMinutes ?? '–'} min`)}
      {card('Processes', String(data.summary.totalProcesses), `Active: ${data.summary.activeProcesses}`)}
    </div>
  );
}

function RobotsPanel({ robots }: { robots: DashboardOverview['robots'] }) {
  return (
    <div style={{ backgroundColor: '#fff', borderRadius: 12, boxShadow: '0 10px 24px rgba(15,23,42,0.08)', padding: 16 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 12 }}>Robots Status</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', fontSize: 12, color: '#6b7280' }}>
            <th style={{ paddingBottom: 8 }}>Name</th>
            <th style={{ paddingBottom: 8 }}>Status</th>
            <th style={{ paddingBottom: 8 }}>Last Heartbeat</th>
          </tr>
        </thead>
        <tbody>
          {robots.map((r) => (
            <tr key={r.id} style={{ fontSize: 14, color: '#111827' }}>
              <td style={{ padding: '6px 0' }}>{r.name}</td>
              <td style={{ padding: '6px 0' }}>
                <span style={{ padding: '4px 8px', borderRadius: 999, backgroundColor: r.status === 'online' ? '#dcfce7' : '#fee2e2', color: r.status === 'online' ? '#166534' : '#991b1b' }}>
                  {r.status}
                </span>
              </td>
              <td style={{ padding: '6px 0' }}>{r.lastHeartbeat ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
        <button style={secondaryBtn} onClick={() => { window.location.hash = '#/jobs?trigger=1' }}>Trigger Job</button>
        <button style={primaryBtn} onClick={() => { window.location.hash = '#/jobs' }}>View All Jobs</button>
      </div>
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
