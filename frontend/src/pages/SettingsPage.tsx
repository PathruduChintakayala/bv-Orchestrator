export default function SettingsPage() {
  return (
    <div style={{ padding: 16 }}>
      <div className="page-shell" style={{ gap: 12 }}>
        <div className="surface-card" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h1 className="page-title" style={{ margin: 0 }}>Settings</h1>
          </div>
        </div>
        <div style={{ backgroundColor: '#fff', borderRadius: 12, boxShadow: '0 10px 24px rgba(15,23,42,0.08)', padding: 16 }}>
          <p style={{ color: '#374151', fontSize: 14 }}>
            Global application settings will be configured here.
          </p>
          {/* Future: General (app name, theme), Security (password policy, session timeout), Integrations (API keys, webhooks). */}
        </div>
      </div>
    </div>
  );
}
