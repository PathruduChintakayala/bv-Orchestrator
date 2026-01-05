import type { DashboardOverview } from "../types/dashboard";

function toCamel<T extends Record<string, any>>(obj: T): any {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(toCamel);
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
      toCamel(v as any),
    ])
  );
}

export async function fetchDashboardOverview(): Promise<DashboardOverview> {
  const token = localStorage.getItem("token");
  if (!token) throw new Error("Not authenticated");
  const res = await fetch("/api/dashboard/overview", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Failed to fetch dashboard");
  }
  const data = await res.json();
  const history =
    (data as any).job_history_24h ||
    (data as any).jobHistory_24h ||
    (data as any).jobHistory24h ||
    (data as any).job_history24h ||
    { total: 0, success: 0, failed: 0, stopped: 0 };
  const statusCounts =
    (data as any).job_status_counts ||
    (data as any).jobStatusCounts ||
    { running: 0, pending: 0, stopping: 0, terminating: 0, suspended: 0, resumed: 0 };

  const camel = toCamel(data) as DashboardOverview;
  return {
    ...camel,
    jobHistory24h: history && typeof history === 'object' ? {
      total: Number(history.total || 0),
      success: Number(history.success || 0),
      failed: Number(history.failed || 0),
      stopped: Number(history.stopped || 0),
    } : { total: 0, success: 0, failed: 0, stopped: 0 },
    jobStatusCounts: {
      running: Number(statusCounts.running || 0),
      pending: Number(statusCounts.pending || 0),
      stopping: Number(statusCounts.stopping || 0),
      terminating: Number(statusCounts.terminating || 0),
      suspended: Number(statusCounts.suspended || 0),
      resumed: Number(statusCounts.resumed || 0),
    },
  };
}
