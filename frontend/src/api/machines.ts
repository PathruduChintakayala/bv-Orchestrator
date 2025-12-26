import type { Machine } from "../types/machine";

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

export async function fetchMachines(): Promise<Machine[]> {
  const res = await fetch(`/api/machines`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return toCamel(await res.json()) as Machine[];
}

export async function getMachine(id: number): Promise<Machine> {
  const res = await fetch(`/api/machines/${id}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return toCamel(await res.json()) as Machine;
}

export async function createMachine(payload: { name: string; mode: "dev" | "runner" }): Promise<Machine> {
  const res = await fetch(`/api/machines`, { method: "POST", headers: authHeaders(), body: JSON.stringify(toSnake(payload as any)) });
  if (!res.ok) throw new Error(await res.text());
  return toCamel(await res.json()) as Machine;
}

export async function deleteMachine(id: number): Promise<void> {
  const res = await fetch(`/api/machines/${id}`, { method: "DELETE", headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
}
