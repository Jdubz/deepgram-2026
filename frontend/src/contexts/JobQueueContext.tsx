import { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import { useWebSocket } from '../hooks/useWebSocket'
import type { Job, QueueStatus } from '../components'

// Event types from the server
interface JobCreatedEvent {
  type: 'job_created'
  job: Job
}

interface JobClaimedEvent {
  type: 'job_claimed'
  jobId: number
  jobType: string
  provider: string
  startedAt: string
}

interface JobProgressEvent {
  type: 'job_progress'
  jobId: number
  tokenCount: number
  elapsedMs: number
}

interface JobCompletedEvent {
  type: 'job_completed'
  jobId: number
  processingTimeMs: number
  confidence: number | null
  completedAt: string
}

interface JobFailedEvent {
  type: 'job_failed'
  jobId: number
  errorMessage: string
  failedAt: string
}

interface QueueStatusEvent {
  type: 'queue_status'
  status: QueueStatus
}

interface InitialStateEvent {
  type: 'initial_state'
  jobs: Job[]
  status: QueueStatus
}

type JobEvent =
  | JobCreatedEvent
  | JobClaimedEvent
  | JobProgressEvent
  | JobCompletedEvent
  | JobFailedEvent
  | QueueStatusEvent
  | InitialStateEvent

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
          completed_at: new Date().toISOString(),
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
