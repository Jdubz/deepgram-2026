import { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import { useWebSocket } from '../hooks/useWebSocket'
import type { Job, QueueStatus } from '../components'
import type { JobEvent } from '../types/events'

interface JobQueueContextValue {
  jobs: Job[]
  queueStatus: QueueStatus | null
  isConnected: boolean
}

const JobQueueContext = createContext<JobQueueContextValue | null>(null)

export function JobQueueProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Job[]>([])
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null)

  const updateJob = useCallback((jobId: number, updates: Partial<Job>) => {
    setJobs((prev) =>
      prev.map((job) => (job.id === jobId ? { ...job, ...updates } : job))
    )
  }, [])

  const handleMessage = useCallback((event: JobEvent) => {
    switch (event.type) {
      case 'initial_state':
        setJobs(event.jobs)
        setQueueStatus(event.status)
        break
      case 'job_created':
        setJobs((prev) => [event.job, ...prev.filter((j) => j.id !== event.job.id)])
        break
      case 'job_claimed':
        updateJob(event.jobId, { status: 'processing', started_at: event.startedAt })
        break
      case 'job_completed':
        updateJob(event.jobId, {
          status: 'completed',
          processing_time_ms: event.processingTimeMs,
          completed_at: event.completedAt,
        })
        break
      case 'job_failed':
        updateJob(event.jobId, {
          status: 'failed',
          error_message: event.errorMessage,
          completed_at: event.failedAt,
        })
        break
      case 'job_progress':
        // Progress events are for real-time display only, not persisted to job state
        break
      case 'queue_status':
        setQueueStatus(event.status)
        break
    }
  }, [updateJob])

  const { isConnected } = useWebSocket<JobEvent>({
    path: '/jobs/events',
    enabled: true,
    onMessage: handleMessage,
  })

  return (
    <JobQueueContext.Provider value={{ jobs, queueStatus, isConnected }}>
      {children}
    </JobQueueContext.Provider>
  )
}

export function useJobQueue(): JobQueueContextValue {
  const context = useContext(JobQueueContext)
  if (!context) {
    throw new Error('useJobQueue must be used within a JobQueueProvider')
  }
  return context
}
