import { useEffect, useMemo, useState, type Dispatch, type SetStateAction, type CSSProperties } from 'react'
import type { Trigger } from '../types/trigger'
import type { Process } from '../types/processes'
import type { Queue } from '../types/queue'
import type { Robot } from '../types/robot'
import { fetchTriggers, enableTrigger, disableTrigger, createTrigger } from '../api/triggers'
import { fetchProcesses } from '../api/processes'
import { fetchQueues } from '../api/queues'
import { fetchRobots } from '../api/robots'

export default function TriggersPage() {
  const [items, setItems] = useState<Trigger[]>([])
  const [processes, setProcesses] = useState<Process[]>([])
  const [queues, setQueues] = useState<Queue[]>([])
  const [robots, setRobots] = useState<Robot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  const emptyForm: FormValues = {
    name: '',
    type: 'TIME',
    processId: 0,
    robotId: null,
    timezone: 'UTC',
    frequency: 'DAILY',
    minuteEvery: 5,
    hourEvery: 1,
    minuteAt: 0,
    dailyEvery: 1,
    timeOfDay: '09:00',
    daysOfWeek: ['MON'],
    dayOfMonth: 1,
    monthsInterval: 1,
    weekNumber: '1',
    cronExpression: '',
    queueId: 0,
    batchSize: 1,
    pollingInterval: 30,
  }
  const [form, setForm] = useState<FormValues>(emptyForm)

  useEffect(() => { void load() }, [])

  async function load() {
    try {
      setLoading(true); setError(null)
      const [ts, ps, qs, rs] = await Promise.all([
        fetchTriggers(),
        fetchProcesses({ activeOnly: false }),
        fetchQueues({ search: '' }),
        fetchRobots(),
      ])
      setItems(ts)
      setProcesses(ps)
      setQueues(qs)
      setRobots(rs)
      if (!processes.length && ps.length) {
        setForm(f => ({ ...f, processId: ps[0].id }))
      }
      if (!queues.length && qs.length) {
        setForm(f => ({ ...f, queueId: qs[0].id }))
      }
      if (!robots.length && rs.length) {
        setForm(f => ({ ...f, robotId: rs[0].id }))
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load triggers')
    } finally {
      setLoading(false)
    }
  }

  const processNameById = useMemo(() => {
    const m = new Map<number, string>()
    processes.forEach(p => m.set(p.id, p.name))
    return m
  }, [processes])

  const queueNameById = useMemo(() => {
    const m = new Map<number, string>()
    queues.forEach(q => m.set(q.id, q.name))
    return m
  }, [queues])

  async function toggleTrigger(t: Trigger, nextEnabled: boolean) {
    try {
      setToggling(t.id)
      if (nextEnabled) {
        await enableTrigger(t.id)
      } else {
        await disableTrigger(t.id)
      }
      await load()
    } catch (e: any) {
      alert(e.message || 'Action failed')
    } finally {
      setToggling(null)
    }
  }

  async function handleCreate() {
    const cronResult = buildCron(form)
    const errs = validate(form, cronResult)
    if (Object.keys(errs).length > 0) {
      alert('Fix the highlighted fields before saving')
      return
    }
    try {
      await createTrigger({
        name: form.name.trim(),
        type: form.type,
        processId: form.processId,
        cronExpression: form.type === 'TIME' ? cronResult.cron : null,
        timezone: form.type === 'TIME' ? (form.timezone || 'UTC') : null,
        robotId: form.robotId || undefined,
        queueId: form.type === 'QUEUE' ? form.queueId : null,
        batchSize: form.type === 'QUEUE' ? form.batchSize : null,
        pollingInterval: form.type === 'QUEUE' ? form.pollingInterval : null,
      })
      setModalOpen(false)
      setForm(emptyForm)
      await load()
    } catch (e: any) {
      alert(e.message || 'Create failed')
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827' }}>Triggers</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => void load()} style={secondaryBtn}>Refresh</button>
          <button onClick={() => { setForm(emptyForm); setModalOpen(true) }} style={primaryBtn}>New Trigger</button>
        </div>
      </div>

      <div style={{ backgroundColor: '#fff', borderRadius: 12, boxShadow: '0 10px 24px rgba(15,23,42,0.08)', padding: 16 }}>
        {loading ? <p>Loading...</p> : error ? <p style={{ color: '#b91c1c' }}>{error}</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', fontSize: 12, color: '#6b7280' }}>
                <th style={{ paddingBottom: 8 }}>Name</th>
                <th style={{ paddingBottom: 8 }}>Type</th>
                <th style={{ paddingBottom: 8 }}>Process</th>
                <th style={{ paddingBottom: 8 }}>Schedule / Queue</th>
                <th style={{ paddingBottom: 8 }}>Last fired</th>
                <th style={{ paddingBottom: 8 }}>Next fire</th>
                <th style={{ paddingBottom: 8 }}>Enabled</th>
                <th style={{ paddingBottom: 8 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(t => (
                <tr key={t.id} style={{ fontSize: 14, color: '#111827' }}>
                  <td style={{ padding: '6px 0' }}>{t.name}</td>
                  <td style={{ padding: '6px 0' }}>{t.type}</td>
                  <td style={{ padding: '6px 0' }}>{processNameById.get(t.processId) || `Process ${t.processId}`}</td>
                  <td style={{ padding: '6px 0' }}>
                    {t.type === 'TIME'
                      ? (t.cronExpression ? `${t.cronExpression} ${t.timezone || ''}`.trim() : '—')
                      : (t.queueId ? `${queueNameById.get(t.queueId) || `Queue ${t.queueId}`} (batch ${t.batchSize ?? 1}, every ${t.pollingInterval ?? 30}s)` : '—')
                    }
                  </td>
                  <td style={{ padding: '6px 0' }}>{t.lastFiredAt ? new Date(t.lastFiredAt).toLocaleString() : '—'}</td>
                  <td style={{ padding: '6px 0' }}>{t.nextFireAt ? new Date(t.nextFireAt).toLocaleString() : '—'}</td>
                  <td style={{ padding: '6px 0' }}>{t.enabled ? 'Yes' : 'No'}</td>
                  <td style={{ padding: '6px 0' }}>
                    <button
                      onClick={() => void toggleTrigger(t, !t.enabled)}
                      disabled={toggling === t.id}
                      style={t.enabled ? secondaryBtn : primaryBtn}
                    >
                      {toggling === t.id ? 'Working...' : t.enabled ? 'Disable' : 'Enable'}
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={8} style={{ paddingTop: 12, color: '#6b7280' }}>No triggers found</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {modalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'grid', placeItems: 'center', zIndex: 20 }}>
          <div style={{ width: '100%', maxWidth: 720, background: '#fff', borderRadius: 16, boxShadow: '0 12px 40px rgba(0,0,0,0.18)', padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>New Trigger</h2>
            <TriggerForm
              form={form}
              setForm={setForm}
              processes={processes}
              queues={queues}
              robots={robots}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button onClick={() => { setModalOpen(false); setForm(emptyForm) }} style={secondaryBtn}>Cancel</button>
              <button onClick={() => void handleCreate()} style={{ ...primaryBtn, opacity: Object.keys(validate(form, buildCron(form))).length ? 0.6 : 1 }} disabled={Object.keys(validate(form, buildCron(form))).length > 0}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TriggerForm({ form, setForm, processes, queues, robots }: { form: FormValues; setForm: Dispatch<SetStateAction<FormValues>>; processes: Process[]; queues: Queue[]; robots: Robot[]; }) {
  const cronResult = useMemo(() => buildCron(form), [form])
  const errors = useMemo(() => validate(form, cronResult), [form, cronResult])

  const toggleWeekday = (day: Weekday) => {
    setForm(f => {
      const has = f.daysOfWeek.includes(day)
      const next = has ? f.daysOfWeek.filter(d => d !== day) : [...f.daysOfWeek, day]
      return { ...f, daysOfWeek: next }
    })
  }

  const timeHint = (field: 'timeOfDay' | 'minuteAt') => errors[field] ? { borderColor: '#dc2626' } : undefined

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
      <label style={label}>
        <div>Name</div>
        <input style={{ ...input, ...(errors.name ? { borderColor: '#dc2626' } : {}) }} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        {errors.name && <span style={errorText}>{errors.name}</span>}
      </label>
      <label style={label}>
        <div>Type</div>
        <select
          style={input}
          value={form.type}
          onChange={e => setForm(f => ({ ...f, type: e.target.value as FormValues['type'], frequency: e.target.value === 'TIME' ? f.frequency : f.frequency, cronExpression: e.target.value === 'TIME' ? f.cronExpression : '', queueId: e.target.value === 'QUEUE' ? f.queueId : f.queueId }))}
        >
          <option value="TIME">TIME</option>
          <option value="QUEUE">QUEUE</option>
        </select>
      </label>
      <label style={label}>
        <div>Process</div>
        <select style={{ ...input, ...(errors.processId ? { borderColor: '#dc2626' } : {}) }} value={form.processId} onChange={e => setForm(f => ({ ...f, processId: Number(e.target.value) }))}>
          <option value={0}>Select process</option>
          {processes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {errors.processId && <span style={errorText}>{errors.processId}</span>}
      </label>
      <label style={label}>
        <div>Robot (optional)</div>
        <select style={input} value={form.robotId ?? ''} onChange={e => setForm(f => ({ ...f, robotId: e.target.value ? Number(e.target.value) : null }))}>
          <option value="">Any available</option>
          {robots.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </label>

      {form.type === 'TIME' && (
        <>
          <label style={label}>
            <div>Timezone</div>
            <input style={{ ...input, ...(errors.timezone ? { borderColor: '#dc2626' } : {}) }} value={form.timezone} onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))} />
            {errors.timezone && <span style={errorText}>{errors.timezone}</span>}
          </label>
          <label style={label}>
            <div>Frequency</div>
            <select
              style={input}
              value={form.frequency}
              onChange={e => {
                const freq = e.target.value as Frequency
                setForm(f => ({
                  ...f,
                  frequency: freq,
                  cronExpression: freq === 'ADVANCED' ? f.cronExpression : '',
                }))
              }}
            >
              {FREQUENCY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>

          {form.frequency === 'MINUTE' && (
            <>
              <label style={label}>
                <div>Repeat every (minutes)</div>
                <input style={{ ...input, ...(errors.minuteEvery ? { borderColor: '#dc2626' } : {}) }} type="number" min={1} value={form.minuteEvery} onChange={e => setForm(f => ({ ...f, minuteEvery: Number(e.target.value) || 1 }))} />
                {errors.minuteEvery && <span style={errorText}>{errors.minuteEvery}</span>}
              </label>
            </>
          )}

          {form.frequency === 'HOURLY' && (
            <>
              <label style={label}>
                <div>Repeat every (hours)</div>
                <input style={{ ...input, ...(errors.hourEvery ? { borderColor: '#dc2626' } : {}) }} type="number" min={1} value={form.hourEvery} onChange={e => setForm(f => ({ ...f, hourEvery: Number(e.target.value) || 1 }))} />
                {errors.hourEvery && <span style={errorText}>{errors.hourEvery}</span>}
              </label>
              <label style={label}>
                <div>At minute</div>
                <input style={{ ...input, ...timeHint('minuteAt') }} type="number" min={0} max={59} value={form.minuteAt} onChange={e => setForm(f => ({ ...f, minuteAt: Number(e.target.value) || 0 }))} />
                {errors.minuteAt && <span style={errorText}>{errors.minuteAt}</span>}
              </label>
            </>
          )}

          {form.frequency === 'DAILY' && (
            <>
              <label style={label}>
                <div>Repeat every (days)</div>
                <input style={{ ...input, ...(errors.dailyEvery ? { borderColor: '#dc2626' } : {}) }} type="number" min={1} value={form.dailyEvery ?? 1} onChange={e => setForm(f => ({ ...f, dailyEvery: Number(e.target.value) || 1 }))} />
                {errors.dailyEvery && <span style={errorText}>{errors.dailyEvery}</span>}
              </label>
              <label style={label}>
                <div>At time</div>
                <input style={{ ...input, ...timeHint('timeOfDay') }} type="time" value={form.timeOfDay} onChange={e => setForm(f => ({ ...f, timeOfDay: e.target.value }))} />
                {errors.timeOfDay && <span style={errorText}>{errors.timeOfDay}</span>}
              </label>
            </>
          )}

          {form.frequency === 'WEEKLY' && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 12, color: '#6b7280' }}>Weekdays</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {WEEKDAYS.map(d => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleWeekday(d)}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 8,
                        border: '1px solid #e5e7eb',
                        background: form.daysOfWeek.includes(d) ? '#2563eb' : '#fff',
                        color: form.daysOfWeek.includes(d) ? '#fff' : '#111827',
                        cursor: 'pointer',
                      }}
                    >
                      {d}
                    </button>
                  ))}
                </div>
                {errors.daysOfWeek && <span style={errorText}>{errors.daysOfWeek}</span>}
              </div>
              <label style={label}>
                <div>At time</div>
                <input style={{ ...input, ...timeHint('timeOfDay') }} type="time" value={form.timeOfDay} onChange={e => setForm(f => ({ ...f, timeOfDay: e.target.value }))} />
                {errors.timeOfDay && <span style={errorText}>{errors.timeOfDay}</span>}
              </label>
            </>
          )}

          {form.frequency === 'MONTHLY_DAY' && (
            <>
              <label style={label}>
                <div>Day of month</div>
                <input style={{ ...input, ...(errors.dayOfMonth ? { borderColor: '#dc2626' } : {}) }} type="number" min={1} max={31} value={form.dayOfMonth} onChange={e => setForm(f => ({ ...f, dayOfMonth: Number(e.target.value) || 1 }))} />
                {errors.dayOfMonth && <span style={errorText}>{errors.dayOfMonth}</span>}
              </label>
              <label style={label}>
                <div>Repeat every (months)</div>
                <input style={{ ...input, ...(errors.monthsInterval ? { borderColor: '#dc2626' } : {}) }} type="number" min={1} value={form.monthsInterval} onChange={e => setForm(f => ({ ...f, monthsInterval: Number(e.target.value) || 1 }))} />
                {errors.monthsInterval && <span style={errorText}>{errors.monthsInterval}</span>}
              </label>
              <label style={label}>
                <div>At time</div>
                <input style={{ ...input, ...timeHint('timeOfDay') }} type="time" value={form.timeOfDay} onChange={e => setForm(f => ({ ...f, timeOfDay: e.target.value }))} />
                {errors.timeOfDay && <span style={errorText}>{errors.timeOfDay}</span>}
              </label>
            </>
          )}

          {form.frequency === 'MONTHLY_WEEKDAY' && (
            <>
              <label style={label}>
                <div>Weekday</div>
                <select style={{ ...input, ...(errors.daysOfWeek ? { borderColor: '#dc2626' } : {}) }} value={form.daysOfWeek[0] || ''} onChange={e => setForm(f => ({ ...f, daysOfWeek: e.target.value ? [e.target.value as Weekday] : [] }))}>
                  <option value="">Select</option>
                  {WEEKDAYS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
                {errors.daysOfWeek && <span style={errorText}>{errors.daysOfWeek}</span>}
              </label>
              <label style={label}>
                <div>Week number</div>
                <select style={input} value={form.weekNumber} onChange={e => setForm(f => ({ ...f, weekNumber: e.target.value as WeekNumber }))}>
                  <option value="1">1st</option>
                  <option value="2">2nd</option>
                  <option value="3">3rd</option>
                  <option value="4">4th</option>
                  <option value="L">Last</option>
                </select>
              </label>
              <label style={label}>
                <div>Repeat every (months)</div>
                <input style={{ ...input, ...(errors.monthsInterval ? { borderColor: '#dc2626' } : {}) }} type="number" min={1} value={form.monthsInterval} onChange={e => setForm(f => ({ ...f, monthsInterval: Number(e.target.value) || 1 }))} />
                {errors.monthsInterval && <span style={errorText}>{errors.monthsInterval}</span>}
              </label>
              <label style={label}>
                <div>At time</div>
                <input style={{ ...input, ...timeHint('timeOfDay') }} type="time" value={form.timeOfDay} onChange={e => setForm(f => ({ ...f, timeOfDay: e.target.value }))} />
                {errors.timeOfDay && <span style={errorText}>{errors.timeOfDay}</span>}
              </label>
            </>
          )}

          {form.frequency === 'ADVANCED' && (
            <label style={label}>
              <div>Cron expression</div>
              <input style={{ ...input, ...(errors.cronExpression ? { borderColor: '#dc2626' } : {}) }} value={form.cronExpression} placeholder="*/5 * * * *" onChange={e => setForm(f => ({ ...f, cronExpression: e.target.value }))} />
              {errors.cronExpression && <span style={errorText}>{errors.cronExpression}</span>}
            </label>
          )}

          {form.frequency !== 'ADVANCED' && (
            <div style={{ gridColumn: '1 / -1', fontSize: 12, color: '#6b7280' }}>
              Cron preview: <span style={{ fontWeight: 600, color: '#111827' }}>{cronResult.cron || '—'}</span>
              {cronResult.error && <span style={{ ...errorText, marginLeft: 8 }}>{cronResult.error}</span>}
            </div>
          )}
        </>
      )}

      {form.type === 'QUEUE' && (
        <>
          <label style={label}>
            <div>Queue</div>
            <select style={{ ...input, ...(errors.queueId ? { borderColor: '#dc2626' } : {}) }} value={form.queueId} onChange={e => setForm(f => ({ ...f, queueId: Number(e.target.value) }))}>
              <option value={0}>Select queue</option>
              {queues.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}
            </select>
            {errors.queueId && <span style={errorText}>{errors.queueId}</span>}
          </label>
          <label style={label}>
            <div>Batch size</div>
            <input style={{ ...input, ...(errors.batchSize ? { borderColor: '#dc2626' } : {}) }} type="number" min={1} value={form.batchSize ?? 1} onChange={e => setForm(f => ({ ...f, batchSize: Number(e.target.value) || 1 }))} />
            {errors.batchSize && <span style={errorText}>{errors.batchSize}</span>}
          </label>
          <label style={label}>
            <div>Polling interval (seconds)</div>
            <input style={{ ...input, ...(errors.pollingInterval ? { borderColor: '#dc2626' } : {}) }} type="number" min={1} value={form.pollingInterval ?? 30} onChange={e => setForm(f => ({ ...f, pollingInterval: Number(e.target.value) || 30 }))} />
            {errors.pollingInterval && <span style={errorText}>{errors.pollingInterval}</span>}
          </label>
        </>
      )}
    </div>
  )
}

type Weekday = 'SUN' | 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT'
type WeekNumber = '1' | '2' | '3' | '4' | 'L'
type Frequency = 'MINUTE' | 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY_DAY' | 'MONTHLY_WEEKDAY' | 'ADVANCED'

type FormValues = {
  name: string
  type: 'TIME' | 'QUEUE'
  processId: number
  robotId: number | null
  timezone: string
  frequency: Frequency
  minuteEvery: number
  hourEvery: number
  minuteAt: number
  dailyEvery?: number
  timeOfDay: string
  daysOfWeek: Weekday[]
  dayOfMonth: number
  monthsInterval: number
  weekNumber: WeekNumber
  cronExpression: string
  queueId: number
  batchSize: number
  pollingInterval: number
}

const FREQUENCY_OPTIONS: { value: Frequency; label: string }[] = [
  { value: 'MINUTE', label: 'Minute by minute' },
  { value: 'HOURLY', label: 'Hourly' },
  { value: 'DAILY', label: 'Daily' },
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'MONTHLY_DAY', label: 'Monthly (day of month)' },
  { value: 'MONTHLY_WEEKDAY', label: 'Monthly (day of week)' },
  { value: 'ADVANCED', label: 'Advanced (cron)' },
]

const WEEKDAYS: Weekday[] = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

function parseTime(value: string): { hour: number; minute: number } | null {
  if (!value || typeof value !== 'string') return null
  const [h, m] = value.split(':').map(v => Number(v))
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  if (h < 0 || h > 23 || m < 0 || m > 59) return null
  return { hour: h, minute: m }
}

function buildCron(form: FormValues): { cron: string | null; error?: string } {
  if (form.type !== 'TIME') return { cron: null }
  switch (form.frequency) {
    case 'MINUTE': {
      if (form.minuteEvery < 1) return { cron: null, error: 'Minutes must be >=1' }
      return { cron: `*/${form.minuteEvery} * * * *` }
    }
    case 'HOURLY': {
      if (form.hourEvery < 1) return { cron: null, error: 'Hours must be >=1' }
      if (form.minuteAt < 0 || form.minuteAt > 59) return { cron: null, error: 'Minute must be 0-59' }
      return { cron: `${form.minuteAt} */${form.hourEvery} * * *` }
    }
    case 'DAILY': {
      const t = parseTime(form.timeOfDay)
      if (!t) return { cron: null, error: 'Invalid time' }
      const every = form.dailyEvery && form.dailyEvery > 0 ? form.dailyEvery : 1
      return { cron: `${t.minute} ${t.hour} */${every} * *` }
    }
    case 'WEEKLY': {
      const t = parseTime(form.timeOfDay)
      if (!t) return { cron: null, error: 'Invalid time' }
      if (!form.daysOfWeek.length) return { cron: null, error: 'Select at least one day' }
      const days = form.daysOfWeek.join(',')
      return { cron: `${t.minute} ${t.hour} * * ${days}` }
    }
    case 'MONTHLY_DAY': {
      const t = parseTime(form.timeOfDay)
      if (!t) return { cron: null, error: 'Invalid time' }
      if (form.dayOfMonth < 1 || form.dayOfMonth > 31) return { cron: null, error: 'Day must be 1-31' }
      const months = form.monthsInterval > 0 ? form.monthsInterval : 1
      return { cron: `${t.minute} ${t.hour} ${form.dayOfMonth} */${months} *` }
    }
    case 'MONTHLY_WEEKDAY': {
      const t = parseTime(form.timeOfDay)
      if (!t) return { cron: null, error: 'Invalid time' }
      if (!form.daysOfWeek.length) return { cron: null, error: 'Pick a weekday' }
      const dow = form.daysOfWeek[0]
      const suffix = form.weekNumber === 'L' ? 'L' : `#${form.weekNumber}`
      const months = form.monthsInterval > 0 ? form.monthsInterval : 1
      // Using #/#L syntax for nth or last weekday of month
      return { cron: `${t.minute} ${t.hour} * */${months} ${dow}${suffix}` }
    }
    case 'ADVANCED': {
      const cron = (form.cronExpression || '').trim()
      if (!cron) return { cron: null, error: 'Cron is required' }
      return { cron }
    }
    default:
      return { cron: null, error: 'Select a frequency' }
  }
}

function validate(form: FormValues, cronResult: { cron: string | null; error?: string }): Record<string, string> {
  const errs: Record<string, string> = {}
  if (!form.name.trim()) errs.name = 'Name is required'
  if (!form.processId) errs.processId = 'Process is required'
  if (form.type === 'TIME') {
    if (!form.timezone.trim()) errs.timezone = 'Timezone is required'
    if (cronResult.error || !cronResult.cron) errs.cronExpression = cronResult.error || 'Cron is required'
    switch (form.frequency) {
      case 'MINUTE':
        if (form.minuteEvery < 1) errs.minuteEvery = 'Must be >=1'
        break
      case 'HOURLY':
        if (form.hourEvery < 1) errs.hourEvery = 'Must be >=1'
        if (form.minuteAt < 0 || form.minuteAt > 59) errs.minuteAt = '0-59 only'
        break
      case 'DAILY':
        if (!parseTime(form.timeOfDay)) errs.timeOfDay = 'Pick a valid time'
        if (!form.dailyEvery || form.dailyEvery < 1) errs.dailyEvery = 'Must be >=1'
        break
      case 'WEEKLY':
        if (!parseTime(form.timeOfDay)) errs.timeOfDay = 'Pick a valid time'
        if (!form.daysOfWeek.length) errs.daysOfWeek = 'Pick at least one day'
        break
      case 'MONTHLY_DAY':
        if (!parseTime(form.timeOfDay)) errs.timeOfDay = 'Pick a valid time'
        if (form.dayOfMonth < 1 || form.dayOfMonth > 31) errs.dayOfMonth = '1-31 only'
        if (form.monthsInterval < 1) errs.monthsInterval = 'Must be >=1'
        break
      case 'MONTHLY_WEEKDAY':
        if (!parseTime(form.timeOfDay)) errs.timeOfDay = 'Pick a valid time'
        if (!form.daysOfWeek.length) errs.daysOfWeek = 'Pick a weekday'
        if (form.monthsInterval < 1) errs.monthsInterval = 'Must be >=1'
        break
      case 'ADVANCED':
        if (!form.cronExpression.trim()) errs.cronExpression = 'Cron is required'
        break
      default:
        break
    }
  }
  if (form.type === 'QUEUE') {
    if (!form.queueId) errs.queueId = 'Queue is required'
    if (form.batchSize < 1) errs.batchSize = 'Must be >=1'
    if (form.pollingInterval < 1) errs.pollingInterval = 'Must be >=1'
  }
  return errs
}

const primaryBtn: CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#2563eb', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' }
const secondaryBtn: CSSProperties = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#e5e7eb', color: '#111827', border: 'none', fontWeight: 600, cursor: 'pointer' }
const label: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: '#6b7280' }
const input: CSSProperties = { padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', width: '100%', boxSizing: 'border-box', color: '#111827' }
const errorText: CSSProperties = { color: '#dc2626', fontSize: 12 }
