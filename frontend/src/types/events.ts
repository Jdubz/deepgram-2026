import type { Job, QueueStatus } from '../components'

// Event types from the server for job queue WebSocket messages

export interface JobCreatedEvent {
  type: 'job_created'
  job: Job
}

export interface JobClaimedEvent {
  type: 'job_claimed'
  jobId: number
  jobType: string
  provider: string
  startedAt: string
}

export interface JobProgressEvent {
  type: 'job_progress'
  jobId: number
  tokenCount: number
  elapsedMs: number
}

export interface JobCompletedEvent {
  type: 'job_completed'
  jobId: number
  processingTimeMs: number
  confidence: number | null
  completedAt: string
}

export interface JobFailedEvent {
  type: 'job_failed'
  jobId: number
  errorMessage: string
  failedAt: string
}

export interface QueueStatusEvent {
  type: 'queue_status'
  status: QueueStatus
}

export interface InitialStateEvent {
  type: 'initial_state'
  jobs: Job[]
  status: QueueStatus
}

export type JobEvent =
  | JobCreatedEvent
  | JobClaimedEvent
  | JobProgressEvent
  | JobCompletedEvent
  | JobFailedEvent
  | QueueStatusEvent
  | InitialStateEvent
