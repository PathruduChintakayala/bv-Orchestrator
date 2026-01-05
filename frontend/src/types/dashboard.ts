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
  totalAssets: number;
  totalQueues: number;
  totalTriggers: number;
  totalAccounts: number;
  totalMachines: number;
}

export interface JobHistory24h {
  total: number;
  success: number;
  failed: number;
  stopped: number;
}

export interface DashboardOverview {
  summary: DashboardSummary;
  robots: Robot[];
  recentJobs: JobSummary[];
  jobHistory24h: JobHistory24h;
  jobStatusCounts: JobStatusCounts;
}

export interface JobStatusCounts {
  running: number;
  pending: number;
  stopping: number;
  terminating: number;
  suspended: number;
  resumed: number;
}
