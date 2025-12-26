import React from "react";

export default function SettingsPage() {
  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827' }}>Settings</h1>
      </div>
      <div style={{ backgroundColor: '#fff', borderRadius: 12, boxShadow: '0 10px 24px rgba(15,23,42,0.08)', padding: 16 }}>
        <p style={{ color: '#374151', fontSize: 14 }}>
          Global application settings will be configured here.
        </p>
        {/* Future: General (app name, theme), Security (password policy, session timeout), Integrations (API keys, webhooks). */}
      </div>
    </div>
  );
}
