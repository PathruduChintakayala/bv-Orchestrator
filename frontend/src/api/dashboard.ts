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
  return toCamel(data) as DashboardOverview;
}
