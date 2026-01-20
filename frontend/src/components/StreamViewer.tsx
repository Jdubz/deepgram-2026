import { useState, useRef, useCallback, useEffect } from 'react'
import { TranscriptDisplay, TranscriptEntry } from './TranscriptDisplay'

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

interface ServerMessage {
  type: string
  speaker?: number | null
  text?: string
  confidence?: number
  isFinal?: boolean
  timestamp?: number
  isLive?: boolean
  viewerCount?: number
  message?: string
}

interface StreamViewerProps {
  isActive?: boolean
}

export function StreamViewer({ isActive = true }: StreamViewerProps) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [isLive, setIsLive] = useState(false)
  const [viewerCount, setViewerCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [entries, setEntries] = useState<TranscriptEntry[]>([])
  const [autoScroll, setAutoScroll] = useState(true)
  const [hasBeenActive, setHasBeenActive] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const entryIdRef = useRef(0)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const shouldReconnectRef = useRef(true)
  const isMountedRef = useRef(true)

  const getWebSocketUrl = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}/stream/watch`
  }, [])

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return
    }

    shouldReconnectRef.current = true
    setStatus('connecting')
    setError(null)

    const ws = new WebSocket(getWebSocketUrl())
    wsRef.current = ws

    ws.onopen = () => {
      if (isMountedRef.current) {
        setStatus('connected')
      }
    }

    ws.onmessage = (event) => {
      if (!isMountedRef.current) return

      const message: ServerMessage = JSON.parse(event.data)

      switch (message.type) {
        case 'transcript':
          if (message.text) {
            const entry: TranscriptEntry = {
              id: `entry-${entryIdRef.current++}`,
              speaker: message.speaker ?? null,
              text: message.text,
              confidence: message.confidence || 0,
              isFinal: message.isFinal || false,
              timestamp: message.timestamp || Date.now(),
            }

            setEntries((prev) => {
              // For interim results, replace the last non-final entry from same speaker
              if (!entry.isFinal && prev.length > 0) {
                const lastEntry = prev[prev.length - 1]
                if (!lastEntry.isFinal && lastEntry.speaker === entry.speaker) {
                  return [...prev.slice(0, -1), entry]
                }
              }
              return [...prev, entry]
            })
          }
          break

        case 'status':
          if (message.isLive !== undefined) {
            setIsLive(message.isLive)
          }
          if (message.viewerCount !== undefined) {
            setViewerCount(message.viewerCount)
          }
          break

        case 'session_started':
          setIsLive(true)
          setEntries([]) // Clear previous session
          break

        case 'session_ended':
          setIsLive(false)
          break

        case 'error':
          setError(message.message || 'Server error')
          break
      }
    }

    ws.onerror = () => {
      if (isMountedRef.current) {
        setError('Connection error')
        setStatus('error')
      }
    }

    ws.onclose = () => {
      if (!isMountedRef.current) return

      setStatus('disconnected')
      wsRef.current = null

      // Only auto-reconnect if not manually disconnected
      if (shouldReconnectRef.current) {
        reconnectTimeoutRef.current = window.setTimeout(() => {
          if (isMountedRef.current && shouldReconnectRef.current) {
            connect()
          }
        }, 3000)
      }
    }
  }, [getWebSocketUrl])

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

    setStatus('disconnected')
  }, [])

  // Track when tab becomes active
  useEffect(() => {
    if (isActive && !hasBeenActive) {
      setHasBeenActive(true)
    }
  }, [isActive, hasBeenActive])

  // Connect only after tab has been visited
  useEffect(() => {
    isMountedRef.current = true

    // Only connect if tab has been visited at least once
    if (hasBeenActive) {
      shouldReconnectRef.current = true
      connect()
    }

    return () => {
      isMountedRef.current = false
      shouldReconnectRef.current = false
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [connect, hasBeenActive])

  const getStatusDisplay = () => {
    if (status !== 'connected') {
      switch (status) {
        case 'disconnected':
          return { text: 'Disconnected', color: '#666' }
        case 'connecting':
          return { text: 'Connecting...', color: '#ff9800' }
        case 'error':
          return { text: 'Error', color: '#f44336' }
      }
    }
    return isLive
      ? { text: 'Live', color: '#4caf50' }
      : { text: 'Waiting for stream', color: '#ff9800' }
  }

  const statusDisplay = getStatusDisplay()

  return (
    <section style={{ marginTop: '20px', padding: '20px', border: '1px solid #ddd', borderRadius: '8px' }}>
      <h2>Live Interview Transcription</h2>

      {/* Status and viewer count */}
      <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 12px',
            borderRadius: '16px',
            background: statusDisplay.color + '20',
            color: statusDisplay.color,
            fontWeight: 500,
          }}
        >
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: statusDisplay.color,
              animation: isLive ? 'pulse 2s infinite' : undefined,
            }}
          />
          {statusDisplay.text}
        </span>

        {status === 'connected' && (
          <span style={{ color: '#666', fontSize: '14px' }}>
            {viewerCount} viewer{viewerCount !== 1 ? 's' : ''} watching
          </span>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            Auto-scroll
          </label>

          {status === 'disconnected' || status === 'error' ? (
            <button
              onClick={connect}
              style={{
                padding: '6px 12px',
                background: '#1976d2',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Reconnect
            </button>
          ) : (
            <button
              onClick={disconnect}
              style={{
                padding: '6px 12px',
                background: '#666',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Disconnect
            </button>
          )}
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div
          style={{
            padding: '12px',
            marginBottom: '16px',
            background: '#ffebee',
            color: '#c62828',
            borderRadius: '4px',
          }}
        >
          {error}
        </div>
      )}

      {/* Waiting message */}
      {status === 'connected' && !isLive && entries.length === 0 && (
        <div
          style={{
            padding: '24px',
            textAlign: 'center',
            color: '#666',
            background: '#fafafa',
            borderRadius: '8px',
            border: '1px dashed #ddd',
          }}
        >
          <div style={{ fontSize: '18px', marginBottom: '8px' }}>Waiting for broadcast to start...</div>
          <div style={{ fontSize: '14px' }}>The transcript will appear here when the host begins streaming.</div>
        </div>
      )}

      {/* Transcript display */}
      {entries.length > 0 && (
        <TranscriptDisplay
          entries={entries}
          autoScroll={autoScroll}
          showInterim={true}
          maxHeight="500px"
        />
      )}

      {/* Session ended message */}
      {!isLive && entries.length > 0 && (
        <div
          style={{
            marginTop: '12px',
            padding: '12px',
            background: '#fff3e0',
            color: '#e65100',
            borderRadius: '4px',
            textAlign: 'center',
          }}
        >
          Stream ended. Transcript preserved above.
        </div>
      )}

      {/* CSS for pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </section>
  )
}
