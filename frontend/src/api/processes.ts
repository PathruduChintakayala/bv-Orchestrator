import type { Process } from "../types/processes";

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

function toSnake<T extends Record<string, any>>(obj: T): any {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(toSnake);
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase()),
      toSnake(v as any),
    ])
  );
}

function authHeaders() {
  const token = localStorage.getItem("token");
  if (!token) throw new Error("Not authenticated");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export async function fetchProcesses(params?: { search?: string; activeOnly?: boolean }): Promise<Process[]> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set("search", params.search);
  if (params?.activeOnly) qs.set("active_only", "true");
  const res = await fetch(`/api/processes/${qs.toString() ? `?${qs.toString()}` : ""}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return toCamel(await res.json()) as Process[];
}

export async function fetchProcess(id: number): Promise<Process> {
  const res = await fetch(`/api/processes/${id}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return toCamel(await res.json()) as Process;
}

export async function createProcess(payload: { name: string; description?: string; scriptPath: string; isActive: boolean }): Promise<Process> {
  const res = await fetch(`/api/processes/`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(toSnake(payload as any)),
  });
  if (!res.ok) throw new Error(await res.text());
  return toCamel(await res.json()) as Process;
}

export async function updateProcess(
  id: number,
  payload: Partial<{ name: string; description?: string; scriptPath: string; isActive: boolean }>
): Promise<Process> {
  const res = await fetch(`/api/processes/${id}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(toSnake(payload as any)),
  });
  if (!res.ok) throw new Error(await res.text());
  return toCamel(await res.json()) as Process;
}

export async function deleteProcess(id: number): Promise<void> {
  const res = await fetch(`/api/processes/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
}
