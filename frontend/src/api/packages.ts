import type { Package } from "../types/package";

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
  return { Authorization: `Bearer ${token}` };
}

export async function uploadPackage(file: File, name?: string, version?: string): Promise<Package> {
  const fd = new FormData();
  fd.append("file", file);
  if (name) fd.append("name", name);
  if (version) fd.append("version", version);
  const res = await fetch(`/api/packages/upload`, {
    method: "POST",
    headers: authHeaders(),
    body: fd,
  } as any);
  if (!res.ok) throw new Error(await res.text());
  return toCamel(await res.json()) as Package;
}

export async function fetchPackages(params?: { search?: string; activeOnly?: boolean; name?: string }): Promise<Package[]> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set("search", params.search);
  if (params?.activeOnly) qs.set("active_only", "true");
  if (params?.name) qs.set("name", params.name);
  const res = await fetch(`/api/packages/${qs.toString() ? `?${qs.toString()}` : ""}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return toCamel(await res.json()) as Package[];
}

export async function updatePackage(id: number, payload: Partial<{ name: string; version: string; isActive: boolean }>): Promise<Package> {
  const res = await fetch(`/api/packages/${id}`, {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return toCamel(await res.json()) as Package;
}

export async function deletePackage(id: number): Promise<void> {
  const res = await fetch(`/api/packages/${id}`, { method: "DELETE", headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
}
