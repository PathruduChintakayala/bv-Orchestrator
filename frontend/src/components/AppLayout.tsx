import React, { useEffect, useMemo, useRef, useState } from 'react';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-root" style={{ minHeight: '100vh', backgroundColor: '#f3f4f6' }}>
      <Header />
      <main className="app-main" style={{ paddingTop: 112 }}>
        {children}
      </main>
    </div>
  );
}

function Header() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [hash, setHash] = useState(window.location.hash || '#/dashboard');
  const username = (localStorage.getItem('username') || '').trim();
  const label = username ? username[0].toUpperCase() : 'U';

  function goToDashboard() {
    window.location.hash = '#/dashboard';
  }
  function toggle() { setOpen(o => !o); }
  function logout() {
    localStorage.removeItem('token');
    // optional: also clear username
    // localStorage.removeItem('username');
    setOpen(false);
    window.location.hash = '#/logged-out';
  }

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    const onHash = () => setHash(window.location.hash || '#/dashboard');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const items = useMemo(() => ([
    { label: 'Dashboard', href: '#/dashboard', match: (h: string) => h === '#/' || h.startsWith('#/dashboard') },
    { label: 'Processes', href: '#/processes', match: (h: string) => h.startsWith('#/processes') },
    { label: 'Jobs', href: '#/jobs', match: (h: string) => h.startsWith('#/jobs') },
    { label: 'Robots', href: '#/robots', match: (h: string) => h.startsWith('#/robots') },
    { label: 'Packages', href: '#/packages', match: (h: string) => h.startsWith('#/packages') },
    { label: 'Queues', href: '#/queues', match: (h: string) => h.startsWith('#/queues') },
    { label: 'Assets', href: '#/assets', match: (h: string) => h.startsWith('#/assets') },
    { label: 'Manage Access', href: '#/manage-access', match: (h: string) => h.startsWith('#/manage-access') },
    { href: '#/audit', label: 'Audit', perm: { artifact: 'audit', op: 'view' } },
    { href: '#/settings', label: 'Settings', perm: { artifact: 'settings', op: 'view' } },
  ]), []);

  function go(href: string) {
    window.location.hash = href;
  }

  return (
    <header className="app-header" style={{ position: 'fixed', top: 0, left: 0, right: 0, backgroundColor: '#ffffff', boxShadow: '0 1px 6px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', zIndex: 10 }}>
      <div style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px' }}>
        <div className="app-header-left" onClick={goToDashboard} style={{ fontWeight: 700, fontSize: 18, color: '#111827', cursor: 'pointer' }}>
          BV Orchestrator
        </div>
        <div ref={menuRef} className="app-header-right" style={{ position: 'relative' }}>
          <button onClick={toggle} aria-label="User menu" style={{ width: 36, height: 36, borderRadius: '50%', background: '#2563eb', color: '#ffffff', fontWeight: 700, border: 'none' }}>
            {label}
          </button>
          {open && (
            <div role="menu" style={{ position: 'absolute', right: 0, marginTop: 8, background: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 8px 20px rgba(0,0,0,0.08)', borderRadius: 8, minWidth: 160, overflow: 'hidden' }}>
              <button onClick={logout} style={{ width: '100%', textAlign: 'left', padding: '10px 12px', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
      <nav aria-label="Primary" style={{ borderTop: '1px solid #eef2f7', borderBottom: '1px solid #eef2f7', padding: '8px 16px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16 }}>
          {items.filter(it => hasPermission((it as any).perm)).map(it => {
            const active = (it as any).match ? (it as any).match(hash) : hash.startsWith((it as any).href);
            return (
              <button
                key={(it as any).href}
                onClick={() => go((it as any).href)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '6px 4px',
                  fontWeight: active ? 700 : 500,
                  color: active ? '#111827' : '#374151',
                  borderBottom: active ? '2px solid #2563eb' : '2px solid transparent',
                }}
              >
                {(it as any).label}
              </button>
            );
          })}
        </div>
      </nav>
    </header>
  );
}

function hasPermission(perm?: { artifact: string; op: 'view' | 'edit' | 'create' | 'delete' }) {
  if (!perm) return true
  try {
    const raw = localStorage.getItem('currentUser')
    const user = raw ? JSON.parse(raw) : null
    if (user?.is_admin) return true
    const pm = JSON.parse(localStorage.getItem('permissions') || '{}')
    const key = `${perm.artifact}:${perm.op}`
    return !!pm[key]
  } catch {
    return true
  }
}
