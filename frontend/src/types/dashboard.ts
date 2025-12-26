export type JobStatus = "pending" | "running" | "completed" | "failed";

export interface Robot {
  id: number;
  name: string;
  status: "online" | "offline";
  lastHeartbeat: string | null;
  currentJobId?: number | null;
  currentProcessName?: string | null;
}

export interface JobSummary {
  id: number;
  processName: string;
  robotName: string | null;
  status: JobStatus;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationSeconds?: number | null;
}

export interface DashboardSummary {
  totalRobots: number;
  onlineRobots: number;
  offlineRobots: number;
  jobsTodayTotal: number;
  jobsTodaySuccess: number;
  jobsTodayFailed: number;
  runningJobs: number;
  totalProcesses: number;
  activeProcesses: number;
}

export interface DashboardOverview {
  summary: DashboardSummary;
  robots: Robot[];
  recentJobs: JobSummary[];
}
