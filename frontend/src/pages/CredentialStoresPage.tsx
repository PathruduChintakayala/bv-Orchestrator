import { useEffect, useState } from "react";
import { fetchCredentialStores } from "../api/credentialStores";
import type { CredentialStore } from "../types/credentialStore";

export default function CredentialStoresPage() {
  const [stores, setStores] = useState<CredentialStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchCredentialStores();
      setStores(data);
    } catch (e: any) {
      setError(e.message || "Failed to load credential stores");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div style={{ padding: 16 }}>
      <div className="page-shell" style={{ gap: 12 }}>
        <header className="page-header surface-card">
          <div>
            <h1 className="page-title">Credential Stores</h1>
          </div>
          <div className="page-actions">
            <div className="action-buttons">
              <button type="button" onClick={load} className="btn btn-ghost" aria-label="Refresh list">↻</button>
              <button type="button" className="btn btn-secondary" disabled aria-label="Add credential store (coming soon)">Add Store (coming soon)</button>
            </div>
          </div>
        </header>

        <div className="surface-card">
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          {loading ? (
            <p>Loading…</p>
          ) : (
            <table className="processes-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Type</th>
                  <th scope="col">Status</th>
                  <th scope="col">Default</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {stores.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>{humanizeType(s.type)}</td>
                    <td>
                      <span className="badge">{s.statusLabel || (s.isActive ? "Active" : "Inactive")}</span>
                      {s.type !== "INTERNAL_DB" && <span style={{ marginLeft: 8, color: "#6b7280" }}>Coming soon</span>}
                    </td>
                    <td>{s.isDefault ? <span className="badge badge-success">Default</span> : ""}</td>
                    <td>
                      {s.isDefault ? (
                        <span style={{ color: "#6b7280" }}>Managed</span>
                      ) : (
                        <button className="btn btn-ghost" disabled aria-label="Edit credential store">Coming soon</button>
                      )}
                    </td>
                  </tr>
                ))}
                {stores.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: "12px 0", color: "#6b7280" }}>No credential stores found</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function humanizeType(t: CredentialStore["type"]): string {
  if (t === "INTERNAL_DB") return "Orchestrator Database";
  if (t === "AZURE_KEY_VAULT") return "Azure Key Vault";
  if (t === "CYBERARK") return "CyberArk";
  if (t === "AWS_SECRETS_MANAGER") return "AWS Secrets Manager";
  if (t === "HASHICORP_VAULT") return "HashiCorp Vault";
  return t;
}
