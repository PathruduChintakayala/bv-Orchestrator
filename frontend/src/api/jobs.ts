import type { Job, JobStatus } from "../types/job";
import { authHeaders, readError, toCamel } from "./utils";

export async function fetchJobs(params?: { status?: JobStatus; processId?: number; robotId?: number }): Promise<Job[]> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.processId) qs.set("process_id", String(params.processId));
  if (params?.robotId) qs.set("robot_id", String(params.robotId));
  const res = await fetch(`/api/jobs/${qs.toString() ? `?${qs.toString()}` : ""}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  return toCamel(await res.json()) as Job[];
}

export async function fetchJob(id: number): Promise<Job> {
  const res = await fetch(`/api/jobs/${id}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  return toCamel(await res.json()) as Job;
}

export async function createJob(payload: { processId: number; robotId?: number | null; parameters?: Record<string, unknown> }): Promise<Job> {
  // convert to snake keys for API
  const snake = {
    process_id: payload.processId,
    robot_id: payload.robotId ?? null,
    parameters: payload.parameters ?? undefined,
  };
  const res = await fetch(`/api/jobs/`, { method: "POST", headers: authHeaders(), body: JSON.stringify(snake) });
  if (!res.ok) throw new Error(await readError(res));
  return toCamel(await res.json()) as Job;
}

export async function updateJob(id: number, payload: Partial<{ status: JobStatus; robotId: number | null; result: Record<string, unknown> | null; errorMessage: string | null }>): Promise<Job> {
  const snake: any = {};
  if (payload.status) snake.status = payload.status;
  if (payload.robotId !== undefined) snake.robot_id = payload.robotId;
  if (payload.result !== undefined) snake.result = payload.result;
  if (payload.errorMessage !== undefined) snake.error_message = payload.errorMessage;
  const res = await fetch(`/api/jobs/${id}`, { method: "PUT", headers: authHeaders(), body: JSON.stringify(snake) });
  if (!res.ok) throw new Error(await readError(res));
  return toCamel(await res.json()) as Job;
}

export async function cancelJob(id: number): Promise<Job> {
  const res = await fetch(`/api/jobs/${id}/cancel`, { method: "POST", headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  return toCamel(await res.json()) as Job;
}
