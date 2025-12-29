export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  processId?: number | null;
  processName?: string | null;
  machineId?: number | null;
  machineName?: string | null;
  hostIdentity?: string | null;
}
