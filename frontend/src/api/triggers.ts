import type { Trigger } from "../types/trigger";

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

export async function fetchTriggers(): Promise<Trigger[]> {
  const res = await fetch(`/api/triggers/`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  return toCamel(await res.json()) as Trigger[];
}

export async function enableTrigger(id: string): Promise<Trigger> {
  const res = await fetch(`/api/triggers/${id}/enable`, { method: "POST", headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  return toCamel(await res.json()) as Trigger;
}

export async function disableTrigger(id: string): Promise<Trigger> {
  const res = await fetch(`/api/triggers/${id}/disable`, { method: "POST", headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  return toCamel(await res.json()) as Trigger;
}

export async function updateTrigger(id: string, payload: {
  name?: string;
  type?: 'TIME' | 'QUEUE';
  processId?: number;
  enabled?: boolean;
  robotId?: number | null;
  cronExpression?: string | null;
  timezone?: string | null;
  queueId?: number | null;
  batchSize?: number | null;
  pollingInterval?: number | null;
}): Promise<Trigger> {
  const body: any = {};
  if (payload.name !== undefined) body.name = payload.name;
  if (payload.type !== undefined) body.type = payload.type;
  if (payload.processId !== undefined) body.process_id = payload.processId;
  if (payload.enabled !== undefined) body.enabled = payload.enabled;
  if (payload.robotId !== undefined) body.robot_id = payload.robotId;
  if (payload.cronExpression !== undefined) body.cron_expression = payload.cronExpression;
  if (payload.timezone !== undefined) body.timezone = payload.timezone;
  if (payload.queueId !== undefined) body.queue_id = payload.queueId;
  if (payload.batchSize !== undefined) body.batch_size = payload.batchSize;
  if (payload.pollingInterval !== undefined) body.polling_interval = payload.pollingInterval;
  const res = await fetch(`/api/triggers/${id}`, { method: "PUT", headers: authHeaders(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await readError(res));
  return toCamel(await res.json()) as Trigger;
}

export async function deleteTrigger(id: string): Promise<void> {
  const res = await fetch(`/api/triggers/${id}`, { method: "DELETE", headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
}

export async function createTrigger(payload: {
  name: string;
  type: 'TIME' | 'QUEUE';
  processId: number;
  enabled?: boolean;
  robotId?: number | null;
  cronExpression?: string | null;
  timezone?: string | null;
  queueId?: number | null;
  batchSize?: number | null;
  pollingInterval?: number | null;
}): Promise<Trigger> {
  const body: any = {
    name: payload.name,
    type: payload.type,
    process_id: payload.processId,
    enabled: payload.enabled ?? true,
    robot_id: payload.robotId ?? null,
    cron_expression: payload.cronExpression ?? null,
    timezone: payload.timezone ?? null,
    queue_id: payload.queueId ?? null,
    batch_size: payload.batchSize ?? null,
    polling_interval: payload.pollingInterval ?? null,
  };
  const res = await fetch(`/api/triggers/`, { method: "POST", headers: authHeaders(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await readError(res));
  return toCamel(await res.json()) as Trigger;
}
