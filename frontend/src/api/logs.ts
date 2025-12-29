import type { LogEntry } from "../types/log";
import { authHeaders, toCamel, readError } from "./utils";

export type LogQuery = {
  from?: string;
  to?: string;
  level?: string;
  processId?: number;
  machineId?: number;
  hostIdentity?: string;
  search?: string;
  limit?: number;
  offset?: number;
  order?: "asc" | "desc";
};

export async function fetchLogs(params: LogQuery): Promise<{ items: LogEntry[]; total: number; limit: number; offset: number; order: string }> {
  const qs = new URLSearchParams();
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.level && params.level !== "ALL") qs.set("level", params.level);
  if (params.processId) qs.set("process_id", String(params.processId));
  if (params.machineId) qs.set("machine_id", String(params.machineId));
  if (params.hostIdentity) qs.set("host_identity", params.hostIdentity);
  if (params.search) qs.set("search", params.search);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.offset) qs.set("offset", String(params.offset));
  if (params.order) qs.set("order", params.order);
  const res = await fetch(`/api/logs${qs.toString() ? `?${qs.toString()}` : ""}`, { headers: authHeaders() });
  if (!res.ok) {
    const err: any = new Error(await readError(res));
    err.status = res.status;
    throw err;
  }
  return toCamel(await res.json()) as { items: LogEntry[]; total: number; limit: number; offset: number; order: string };
}
