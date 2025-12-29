import React from "react";
import LogsView from "../components/LogsView";

export default function JobLogsPage({ jobId, executionId }: { jobId: number; executionId: string }) {
  return <LogsView scope="job" jobExecutionId={executionId} jobId={jobId} />;
}
