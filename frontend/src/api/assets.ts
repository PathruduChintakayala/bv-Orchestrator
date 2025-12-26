import type { Asset } from "../types/assets";

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

export async function fetchAssets(search?: string): Promise<Asset[]> {
  const qs = search ? `?search=${encodeURIComponent(search)}` : "";
  const res = await fetch(`/api/assets/${qs}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return toCamel(data) as Asset[];
}

// Payloads for create/update
type AssetCreatePayload = {
  name: string;
  type: "text" | "int" | "bool" | "secret" | "credential";
  value?: string;
  description?: string | null;
  username?: string;
  password?: string;
};

export async function createAsset(payload: AssetCreatePayload): Promise<Asset> {
  const res = await fetch(`/api/assets/`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(toSnake(payload as any)),
  });
  if (!res.ok) throw new Error(await res.text());
  return toCamel(await res.json()) as Asset;
}

export async function updateAsset(id: number, payload: Partial<AssetCreatePayload>): Promise<Asset> {
  const res = await fetch(`/api/assets/${id}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(toSnake(payload as any)),
  });
  if (!res.ok) throw new Error(await res.text());
  return toCamel(await res.json()) as Asset;
}

export async function deleteAsset(id: number): Promise<void> {
  const res = await fetch(`/api/assets/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
}
