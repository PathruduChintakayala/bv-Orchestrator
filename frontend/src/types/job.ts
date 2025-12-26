import type { Robot } from "./robot";
import type { Process } from "./processes";

export type JobStatus = "pending" | "running" | "completed" | "failed" | "canceled";

export interface Job {
  id: number;
  processId: number;
  packageId?: number | null;
  robotId?: number | null;
  status: JobStatus;
  parameters?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  errorMessage?: string | null;
  logsPath?: string | null;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  process?: Process | null;
  robot?: Robot | null;
}
