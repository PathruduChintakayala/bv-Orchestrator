export type LogLevel = "TRACE" | "INFO" | "WARN" | "ERROR";

export interface JobLogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
}
