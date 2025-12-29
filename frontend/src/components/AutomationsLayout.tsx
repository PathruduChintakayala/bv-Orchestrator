import React from 'react'

const tabs = [
  { key: 'processes', label: 'Processes', href: '#/automations/processes' },
  { key: 'jobs', label: 'Jobs', href: '#/automations/jobs' },
  { key: 'triggers', label: 'Triggers', href: '#/automations/triggers' },
  { key: 'logs', label: 'Logs', href: '#/automations/logs' },
]

export default function AutomationsLayout({ active, children }: { active: 'processes' | 'jobs' | 'triggers' | 'logs'; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 6px rgba(0,0,0,0.08)', padding: '10px 12px' }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {tabs.map(t => {
            const isActive = t.key === active
            return (
              <button
                key={t.key}
                onClick={() => { window.location.hash = t.href }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '8px 12px',
                  borderRadius: 10,
                  fontWeight: isActive ? 700 : 500,
                  color: isActive ? '#111827' : '#4b5563',
                  borderBottom: isActive ? '2px solid #2563eb' : '2px solid transparent',
                }}
              >
                {t.label}
              </button>
            )
          })}
        </div>
      </div>
      <div>{children}</div>
    </div>
  )
}
