import { useRef, useCallback } from 'react'
import { useWebSocket, type ConnectionState } from './useWebSocket'
import type { Job, QueueStatus } from '../components'
import type { JobEvent } from '../types/events'

export interface UseJobEventsOptions {
  onInitialState?: (jobs: Job[], status: QueueStatus) => void
  onJobCreated?: (job: Job) => void
  onJobClaimed?: (jobId: number, startedAt: string) => void
  onJobProgress?: (jobId: number, tokenCount: number, elapsedMs: number) => void
  onJobCompleted?: (jobId: number, processingTimeMs: number, completedAt: string) => void
  onJobFailed?: (jobId: number, errorMessage: string) => void
  onQueueStatus?: (status: QueueStatus) => void
  enabled?: boolean
}

export interface UseJobEventsResult {
  isConnected: boolean
  connectionState: ConnectionState
}

export function useJobEvents(options: UseJobEventsOptions): UseJobEventsResult {
  const { enabled = true } = options

  // Store callbacks in refs to avoid reconnection on callback changes
  const callbacksRef = useRef(options)
  callbacksRef.current = options

  const handleMessage = useCallback((event: JobEvent) => {
    const callbacks = callbacksRef.current

    switch (event.type) {
      case 'initial_state':
        callbacks.onInitialState?.(event.jobs, event.status)
        break
      case 'job_created':
        callbacks.onJobCreated?.(event.job)
        break
      case 'job_claimed':
        callbacks.onJobClaimed?.(event.jobId, event.startedAt)
        break
      case 'job_progress':
        callbacks.onJobProgress?.(event.jobId, event.tokenCount, event.elapsedMs)
        break
      case 'job_completed':
        callbacks.onJobCompleted?.(event.jobId, event.processingTimeMs, event.completedAt)
        break
      case 'job_failed':
        callbacks.onJobFailed?.(event.jobId, event.errorMessage)
        break
      case 'queue_status':
        callbacks.onQueueStatus?.(event.status)
        break
    }
  }, [])

  const { isConnected, connectionState } = useWebSocket<JobEvent>({
    path: '/jobs/events',
    enabled,
    onMessage: handleMessage,
  })

  return {
    isConnected,
    connectionState,
  }
}
