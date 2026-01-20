import { useEffect, useRef, useState, useCallback } from 'react'
import type { Job, QueueStatus } from '../components'

type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error'

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

  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected')
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const shouldReconnectRef = useRef(true)

  // Store callbacks in refs to avoid reconnection on callback changes
  const callbacksRef = useRef(options)
  callbacksRef.current = options

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return
    }

    // Build WebSocket URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const wsUrl = `${protocol}//${host}/jobs/events`

    setConnectionState('connecting')

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      console.log('[useJobEvents] Connected')
      setConnectionState('connected')
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as JobEvent
        const callbacks = callbacksRef.current

        switch (data.type) {
          case 'initial_state':
            callbacks.onInitialState?.(data.jobs, data.status)
            break
          case 'job_created':
            callbacks.onJobCreated?.(data.job)
            break
          case 'job_claimed':
            callbacks.onJobClaimed?.(data.jobId, data.startedAt)
            break
          case 'job_progress':
            callbacks.onJobProgress?.(data.jobId, data.tokenCount, data.elapsedMs)
            break
          case 'job_completed':
            callbacks.onJobCompleted?.(data.jobId, data.processingTimeMs, data.completedAt)
            break
          case 'job_failed':
            callbacks.onJobFailed?.(data.jobId, data.errorMessage)
            break
          case 'queue_status':
            callbacks.onQueueStatus?.(data.status)
            break
        }
      } catch (err) {
        console.error('[useJobEvents] Error parsing message:', err)
      }
    }

    ws.onclose = () => {
      console.log('[useJobEvents] Disconnected')
      setConnectionState('disconnected')
      wsRef.current = null

      // Auto-reconnect if not intentionally closed
      if (shouldReconnectRef.current) {
        reconnectTimeoutRef.current = window.setTimeout(() => {
          console.log('[useJobEvents] Reconnecting...')
          connect()
        }, 3000)
      }
    }

    ws.onerror = (err) => {
      console.error('[useJobEvents] Error:', err)
      setConnectionState('error')
    }
  }, [])

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    setConnectionState('disconnected')
  }, [])

  useEffect(() => {
    if (enabled) {
      shouldReconnectRef.current = true
      connect()
    } else {
      disconnect()
    }

    return () => {
      disconnect()
    }
  }, [enabled, connect, disconnect])

  return {
    isConnected: connectionState === 'connected',
    connectionState,
  }
}
