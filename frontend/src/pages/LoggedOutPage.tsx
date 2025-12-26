export default function LoggedOutPage() {
  function goLogin() { window.location.hash = '#/'; }
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', backgroundColor: '#f3f4f6', padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 10px 24px rgba(15,23,42,0.08)', padding: 24, width: '100%', maxWidth: 480 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', marginBottom: 8 }}>Logged out successfully</h1>
        <p style={{ color: '#374151', marginBottom: 16 }}>You have been logged out of BV Orchestrator.</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={goLogin} style={{ padding: '10px 14px', borderRadius: 8, backgroundColor: '#2563eb', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' }}>Back to Login</button>
        </div>
      </div>
    </div>
  );
}
