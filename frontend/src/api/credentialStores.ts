import type { CredentialStore } from "../types/credentialStore";

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

export async function fetchCredentialStores(): Promise<CredentialStore[]> {
  const res = await fetch(`/api/credential-stores/`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return toCamel(data) as CredentialStore[];
}
