import { useMemo } from 'react'
import LogsView from '../components/LogsView'

export default function LogsPage() {
  const params = useMemo(() => {
    try {
      const hash = window.location.hash || '#/automations/logs'
      const url = new URL(hash.replace('#',''), 'http://localhost')
      const jobId = url.searchParams.get('jobId')
      const executionId = url.searchParams.get('executionId')
      const processId = url.searchParams.get('processId')
      return {
        jobId: jobId ? Number(jobId) : undefined,
        executionId: executionId || undefined,
        processId: processId ? Number(processId) : undefined,
      }
    } catch {
      return { jobId: undefined, executionId: undefined, processId: undefined }
    }
  }, [])

  if (params.jobId && params.executionId) {
    return <LogsView scope="job" jobExecutionId={params.executionId} jobId={params.jobId} initialProcessId={params.processId} />
  }

  return <LogsView scope="global" initialProcessId={params.processId} />
}
