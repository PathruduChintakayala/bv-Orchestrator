import type { JobLogEntry, LogLevel } from "../types/logs";
import { toCamel, authHeaders, readError } from "./utils";

export async function fetchJobExecutionLogs(
  executionId: string,
  opts?: { levels?: LogLevel[]; fromTimestamp?: string; limit?: number; order?: "asc" | "desc" }
): Promise<JobLogEntry[]> {
  if (!executionId) throw new Error("executionId is required");
  const qs = new URLSearchParams();
  if (opts?.levels?.length) {
    for (const lvl of opts.levels) qs.append("level", lvl);
  }
  if (opts?.fromTimestamp) qs.set("fromTimestamp", opts.fromTimestamp);
  if (opts?.limit) qs.set("limit", String(opts.limit));
  if (opts?.order) qs.set("order", opts.order);

  const res = await fetch(`/api/job-executions/${encodeURIComponent(executionId)}/logs${qs.toString() ? `?${qs.toString()}` : ""}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return toCamel(data) as JobLogEntry[];
}
