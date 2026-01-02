export type LogLevel = "TRACE" | "INFO" | "WARN" | "ERROR";

export interface JobLogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  host_name?: string | null;
  host_identity?: string | null;
}
