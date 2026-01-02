export type RobotStatus = "online" | "offline";

export interface Robot {
  id: number;
  name: string;
  status: RobotStatus;
  machineId?: number | null;
  machineName?: string | null;
  machineInfo?: string | null;
  lastHeartbeat?: string | null;
  currentJobId?: number | null;
  createdAt: string;
  updatedAt: string;
}
