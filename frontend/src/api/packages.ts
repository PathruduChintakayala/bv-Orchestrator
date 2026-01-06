import type { Package } from "../types/package";
import type { EntrypointParameter } from "../types/entrypoint";

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

async function readError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.detail === "string") return parsed.detail;
  } catch {
    // ignore
  }
  return text;
}

export async function uploadPackage(file: File): Promise<Package> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`/api/packages/upload`, {
    method: "POST",
    headers: authHeaders(),
    body: fd,
  } as any);
  if (!res.ok) throw new Error(await readError(res));
  return toCamel(await res.json()) as Package;
}

export async function fetchPackages(params?: { search?: string; activeOnly?: boolean; name?: string; type?: "rpa" | "agent" }): Promise<Package[]> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set("search", params.search);
  if (params?.activeOnly) qs.set("active_only", "true");
  if (params?.name) qs.set("name", params.name);
  if (params?.type) qs.set("type", params.type);
  const res = await fetch(`/api/packages/${qs.toString() ? `?${qs.toString()}` : ""}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  return toCamel(await res.json()) as Package[];
}

export async function updatePackage(id: number, payload: Partial<{ name: string; version: string; isActive: boolean }>): Promise<Package> {
  const res = await fetch(`/api/packages/${id}`, {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await readError(res));
  return toCamel(await res.json()) as Package;
}

export async function deletePackage(id: number): Promise<void> {
  const res = await fetch(`/api/packages/${id}`, { method: "DELETE", headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
}

export async function downloadPackageVersion(params: { packageId: number; version: string; filename?: string }): Promise<void> {
  const { packageId, version, filename } = params;
  const res = await fetch(`/api/packages/${packageId}/versions/${encodeURIComponent(version)}/download`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || `package-${packageId}-${version}.bvpackage`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

export async function fetchEntrypointSignature(packageId: number, entrypointName: string): Promise<EntrypointParameter[]> {
  const res = await fetch(`/api/packages/${packageId}/entrypoints/${encodeURIComponent(entrypointName)}/signature`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  const params = (data?.parameters || []) as EntrypointParameter[];
  return params.map((p) => ({ ...p }));
}
