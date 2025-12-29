import React, { useEffect, useMemo, useState } from 'react'
import { fetchLogs, type LogQuery } from '../api/logs'
import { fetchProcesses } from '../api/processes'
import { fetchMachines } from '../api/machines'
import { fetchJob } from '../api/jobs'
import { fetchJobExecutionLogs } from '../api/jobExecutionLogs'
import type { Process } from '../types/processes'
import type { Machine } from '../types/machine'
import type { LogEntry } from '../types/log'
import type { Job } from '../types/job'
import type { LogLevel } from '../types/logs'

const levels = ['ALL', 'TRACE', 'INFO', 'WARN', 'ERROR'] as const
const ranges = [
  { label: 'Last 24 hours', value: '24h' as const },
  { label: 'Last 7 days', value: '7d' as const },
  { label: 'Custom', value: 'custom' as const },
]

type Scope = 'global' | 'job'

export default function LogsView({ scope, jobExecutionId, jobId }: { scope: Scope; jobExecutionId?: string; jobId?: number }) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [processes, setProcesses] = useState<Process[]>([])
  const [machines, setMachines] = useState<Machine[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [level, setLevel] = useState<(typeof levels)[number]>('ALL')
  const [range, setRange] = useState<(typeof ranges)[number]['value']>('24h')
  const [from, setFrom] = useState<string | undefined>(undefined)
  const [to, setTo] = useState<string | undefined>(undefined)
  const [processId, setProcessId] = useState<number | undefined>(undefined)
  const [machineId, setMachineId] = useState<number | undefined>(undefined)
  const [hostIdentity, setHostIdentity] = useState<string | undefined>(undefined)
  const [limit, setLimit] = useState(50)
  const [offset, setOffset] = useState(0)
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')
  const [job, setJob] = useState<Job | null>(null)

  useEffect(() => { void loadMeta() }, [])
  useEffect(() => {
    if (scope === 'job' && jobId) {
      void loadJob(jobId)
    }
  }, [scope, jobId])
  useEffect(() => { setOffset(0); void load() }, [scope, jobExecutionId, level, range, from, to, processId, machineId, hostIdentity, limit, order, search])
  useEffect(() => {
    // update range derived values
    if (range === '24h') {
      const toDate = new Date()
      const fromDate = new Date(toDate.getTime() - 24 * 60 * 60 * 1000)
      setFrom(fromDate.toISOString())
      setTo(toDate.toISOString())
    } else if (range === '7d') {
      const toDate = new Date()
      const fromDate = new Date(toDate.getTime() - 7 * 24 * 60 * 60 * 1000)
      setFrom(fromDate.toISOString())
      setTo(toDate.toISOString())
    }
  }, [range])

  async function loadMeta() {
    try {
      const [ps, ms] = await Promise.all([fetchProcesses({ activeOnly: false }), fetchMachines()])
      setProcesses(ps)
      setMachines(ms)
    } catch (e: any) {
      console.warn('Failed to load meta', e)
    }
  }

  async function loadJob(id: number) {
    try {
      const data = await fetchJob(id)
      setJob(data)
      setProcessId(data.processId || undefined)
    } catch (e: any) {
      console.warn('Failed to load job for logs', e)
    }
  }

  async function load() {
    try {
      setLoading(true); setError(null)
      if (scope === 'global') {
        const query: LogQuery = { level, processId, machineId, hostIdentity, search: search || undefined, limit, offset, order }
        query.from = from
        query.to = to
        const res = await fetchLogs(query)
        setLogs(res.items)
        setTotal(res.total || 0)
      } else {
        if (!jobExecutionId) {
          setError('Missing job execution id')
          setLogs([])
          setTotal(0)
          return
        }
        const opts: { levels?: LogLevel[]; fromTimestamp?: string; toTimestamp?: string; limit?: number; order?: 'asc' | 'desc' } = {}
        if (level !== 'ALL') opts.levels = [level as LogLevel]
        if (from) opts.fromTimestamp = from
        if (to) opts.toTimestamp = to
        opts.limit = 5000
        opts.order = order
        const res = await fetchJobExecutionLogs(jobExecutionId, opts)
        const filtered = res.filter(r => {
          const matchesSearch = !search || r.message.toLowerCase().includes(search.toLowerCase())
          return matchesSearch
        })
        const mapped: LogEntry[] = filtered.map(r => ({
          timestamp: r.timestamp,
          level: r.level,
          message: r.message,
          processId: job?.processId,
          processName: job?.process?.name || undefined,
          machineId: job?.robot?.machineId,
          machineName: job?.robot?.name,
          hostIdentity: job?.robot?.machineInfo || undefined,
        }))
        setLogs(mapped)
        setTotal(mapped.length)
      }
    } catch (e: any) {
      const status = (e as any)?.status
      if (status === 401 || e?.message === 'Not authenticated') {
        setError('Authentication required')
      } else if (status === 403) {
        setError('You do not have permission to view logs')
      } else {
        setError(e.message || 'Failed to load logs')
      }
    } finally {
      setLoading(false)
    }
  }

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSearch(e.target.value)
    setOffset(0)
  }

  const hostOptions = useMemo(() => {
    const set = new Set<string>()
    logs.forEach(l => { if (l.hostIdentity) set.add(String(l.hostIdentity)) })
    return Array.from(set)
  }, [logs])

  function handleExport() {
    const now = new Date().toISOString().replace(/[:.]/g, '-')
    if (scope === 'global') {
      fetchLogs({ level, processId, machineId, hostIdentity, search: search || undefined, from, to, order, limit: 5000, offset: 0 })
        .then(res => exportCsv(res.items, `bv-logs-${now}.csv`))
        .catch(e => alert(e.message || 'Export failed'))
    } else {
      if (!jobExecutionId) return
      const opts: { levels?: LogLevel[]; fromTimestamp?: string; toTimestamp?: string; limit?: number; order?: 'asc' | 'desc' } = {}
      if (level !== 'ALL') opts.levels = [level as LogLevel]
      if (from) opts.fromTimestamp = from
      if (to) opts.toTimestamp = to
      opts.limit = 5000
      opts.order = order
      fetchJobExecutionLogs(jobExecutionId, opts)
        .then(res => {
          const mapped: LogEntry[] = res.map(r => ({
            timestamp: r.timestamp,
            level: r.level,
            message: r.message,
            processId: job?.processId,
            processName: job?.process?.name || undefined,
            machineId: job?.robot?.machineId,
            machineName: job?.robot?.name,
            hostIdentity: job?.robot?.machineInfo || undefined,
          }))
          exportCsv(mapped, `job_${jobExecutionId}_logs_${now}.csv`)
        })
        .catch(e => alert(e.message || 'Export failed'))
    }
  }

  function exportCsv(rows: LogEntry[], filename: string) {
    const header = ['timestamp','level','process','machine','hostIdentity','message']
    const lines = [header.join(',')]
    for (const r of rows) {
      const cols = [
        safe(r.timestamp),
        safe(r.level),
        safe(r.processName || ''),
        safe(r.machineName || ''),
        safe(r.hostIdentity || ''),
        safe(r.message || ''),
      ]
      lines.push(cols.map(csvEscape).join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  function safe(v: any) { return v === undefined || v === null ? '' : String(v) }
  function csvEscape(value: string) {
    if (value.includes('"') || value.includes(',') || value.includes('\n')) {
      return '"' + value.replace(/"/g, '""') + '"'
    }
    return value
  }

  const pageCount = Math.max(1, Math.ceil(total / limit))
  const pageIndex = Math.floor(offset / limit)

  function goPage(delta: number) {
    const nextIndex = Math.min(Math.max(0, pageIndex + delta), pageCount - 1)
    setOffset(nextIndex * limit)
  }

  const visibleLogs = scope === 'job' ? logs.slice(offset, offset + limit) : logs

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827', margin: 0 }}>Logs</h1>
          {scope === 'job' && job && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', color: '#4b5563', fontSize: 13 }}>
              <span style={{ fontWeight: 600, color: '#111827' }}>Job #{job.id}</span>
              <span>•</span>
              <span>{job.process?.name || `Process ${job.processId}`}</span>
              <span>•</span>
              <span>Started {job.startedAt ? new Date(job.startedAt).toLocaleString() : 'N/A'}</span>
            </div>
          )}
        </div>
        <button onClick={handleExport} style={primaryBtn}>Export CSV</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, background: '#fff', padding: 12, borderRadius: 12, boxShadow: '0 6px 18px rgba(0,0,0,0.05)' }}>
        <label style={label}>Search<input value={search} onChange={handleSearchChange} style={input} placeholder="Message contains" /></label>
        <label style={label}>Time range<select value={range} onChange={e => { setRange(e.target.value as any); setOffset(0) }} style={input}>
          {ranges.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select></label>
        {range === 'custom' && (
          <>
            <label style={label}>From<input type="datetime-local" value={from ? from.slice(0,16) : ''} onChange={e => { setFrom(e.target.value ? new Date(e.target.value).toISOString() : undefined); setOffset(0) }} style={input} /></label>
            <label style={label}>To<input type="datetime-local" value={to ? to.slice(0,16) : ''} onChange={e => { setTo(e.target.value ? new Date(e.target.value).toISOString() : undefined); setOffset(0) }} style={input} /></label>
          </>
        )}
        <label style={label}>Level<select value={level} onChange={e => { setLevel(e.target.value as any); setOffset(0) }} style={input}>{levels.map(l => <option key={l} value={l}>{l}</option>)}</select></label>
        <label style={label}>Process
          {scope === 'job' ? (
            <input value={job?.process?.name || `Process ${job?.processId ?? ''}`} readOnly style={{ ...input, backgroundColor: '#f9fafb' }} />
          ) : (
            <select value={processId ?? ''} onChange={e => { setProcessId(e.target.value ? Number(e.target.value) : undefined); setOffset(0) }} style={input}>
              <option value="">All</option>
              {processes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        </label>
        <label style={label}>Machine<select value={machineId ?? ''} onChange={e => { setMachineId(e.target.value ? Number(e.target.value) : undefined); setOffset(0) }} style={input}>
          <option value="">All</option>
          {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select></label>
        <label style={label}>Host Identity<select value={hostIdentity ?? ''} onChange={e => { setHostIdentity(e.target.value || undefined); setOffset(0) }} style={input}>
          <option value="">All</option>
          {hostOptions.map(h => <option key={h} value={h}>{h}</option>)}
        </select></label>
      </div>

      <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 10px 24px rgba(15,23,42,0.08)', padding: 12 }}>
        {loading ? <p>Loading…</p> : error ? <p style={{ color: '#dc2626' }}>{error}</p> : logs.length === 0 ? (
          <p style={{ color: '#6b7280', padding: 12 }}>No logs found. Try adjusting filters.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', fontSize: 12, color: '#6b7280' }}>
                <th style={{ paddingBottom: 8, cursor: 'pointer' }} onClick={() => { setOrder(order === 'desc' ? 'asc' : 'desc'); setOffset(0) }}>Time {order === 'desc' ? '↓' : '↑'}</th>
                <th style={{ paddingBottom: 8 }}>Level</th>
                <th style={{ paddingBottom: 8 }}>Process</th>
                <th style={{ paddingBottom: 8 }}>Hostname</th>
                <th style={{ paddingBottom: 8 }}>Host Identity</th>
                <th style={{ paddingBottom: 8 }}>Message</th>
              </tr>
            </thead>
            <tbody>
              {visibleLogs.map((l, idx) => (
                <tr key={`${l.timestamp}-${idx}`} style={{ fontSize: 13, color: '#111827' }}>
                  <td style={{ padding: '6px 4px', whiteSpace: 'nowrap' }}>{new Date(l.timestamp).toLocaleString()}</td>
                  <td style={{ padding: '6px 4px' }}><LevelPill level={l.level} /></td>
                  <td style={{ padding: '6px 4px' }}>{l.processName || l.processId || '—'}</td>
                  <td style={{ padding: '6px 4px' }}>{l.machineName || l.machineId || '—'}</td>
                  <td style={{ padding: '6px 4px' }}>{l.hostIdentity || '—'}</td>
                  <td style={{ padding: '6px 4px', maxWidth: 480, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.message}>{l.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
          <div style={{ color: '#6b7280', fontSize: 12 }}>Showing {visibleLogs.length} of {total}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={() => goPage(-1)} disabled={pageIndex === 0} style={secondaryBtn}>Prev</button>
            <span style={{ fontSize: 12, color: '#111827' }}>Page {pageIndex + 1} / {pageCount}</span>
            <button onClick={() => goPage(1)} disabled={pageIndex >= pageCount - 1} style={secondaryBtn}>Next</button>
            <select value={limit} onChange={e => { setLimit(Number(e.target.value)); setOffset(0) }} style={{ ...input, width: 90 }}>
              {[25,50,100,200].map(n => <option key={n} value={n}>{n} / page</option>)}
            </select>
            <button onClick={() => void load()} style={secondaryBtn}>Refresh</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function LevelPill({ level }: { level: string }) {
  const color = levelColor(level)
  return <span style={{ padding: '4px 8px', borderRadius: 8, backgroundColor: color.bg, color: color.fg, fontWeight: 700, fontSize: 11 }}>{level}</span>
}

function levelColor(level: string) {
  const upper = (level || '').toUpperCase()
  switch (upper) {
    case 'TRACE': return { bg: '#e0f2fe', fg: '#0ea5e9' }
    case 'INFO': return { bg: '#ecfdf3', fg: '#16a34a' }
    case 'WARN': return { bg: '#fff7ed', fg: '#ea580c' }
    case 'ERROR': return { bg: '#fef2f2', fg: '#dc2626' }
    default: return { bg: '#e5e7eb', fg: '#374151' }
  }
}

const primaryBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#2563eb', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' }
const secondaryBtn: React.CSSProperties = { padding: '8px 12px', borderRadius: 8, backgroundColor: '#e5e7eb', color: '#111827', border: 'none', fontWeight: 600, cursor: 'pointer' }
const label: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: '#6b7280' }
const input: React.CSSProperties = { padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', width: '100%', boxSizing: 'border-box', color: '#111827' }
