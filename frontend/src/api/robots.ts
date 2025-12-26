import type { Robot, RobotStatus } from "../types/robot";

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

function authHeaders() {
  const token = localStorage.getItem("token");
  if (!token) throw new Error("Not authenticated");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export async function fetchRobots(params?: { search?: string; status?: RobotStatus }): Promise<Robot[]> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set("search", params.search);
  if (params?.status) qs.set("status", params.status);
  const res = await fetch(`/api/robots/${qs.toString() ? `?${qs.toString()}` : ""}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return toCamel(await res.json()) as Robot[];
}

export async function createRobot(payload: { name: string; machineInfo?: string }): Promise<Robot> {
  const res = await fetch(`/api/robots/`, { method: "POST", headers: authHeaders(), body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(await res.text());
  return toCamel(await res.json()) as Robot;
}

export async function updateRobot(id: number, payload: { status?: RobotStatus; machineInfo?: string | null }): Promise<Robot> {
  const res = await fetch(`/api/robots/${id}`, { method: "PUT", headers: authHeaders(), body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(await res.text());
  return toCamel(await res.json()) as Robot;
}

export async function deleteRobot(id: number): Promise<void> {
  const res = await fetch(`/api/robots/${id}`, { method: "DELETE", headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
}
