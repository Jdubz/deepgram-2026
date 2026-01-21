import { useState, useRef, useCallback, useEffect } from 'react'
import { useWebSocket } from '../hooks/useWebSocket'
import { ChunkAnnotation, ChunkAnnotationData, ChunkAnnotationSkeleton, ChunkSentiment } from './ChunkAnnotation'
import { getSpeakerColor, getSpeakerLabel } from '../utils/speaker'

interface TranscriptEntry {
  id: string
  speaker: number | null
  text: string
  confidence: number
  isFinal: boolean
  timestamp: number
}

interface ChunkData {
  id: number
  index: number
  speaker: number | null
  transcript: string
  startTimeMs: number
  endTimeMs: number
  annotation: ChunkAnnotationData | null
  isAnalyzing: boolean
}

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
  sessionId?: string
  submissionId?: string
  chunk?: {
    id: number
    index: number
    speaker: number | null
    transcript: string
    startTimeMs: number
    endTimeMs: number
    willBeAnalyzed?: boolean
  }
  chunkId?: number
  topics?: Array<{ topic: string; confidence: number }>
  intents?: Array<{ intent: string; confidence: number }>
  summary?: string
  sentiment?: ChunkSentiment
}

interface StreamViewerProps {
  isActive?: boolean
  onSessionCreated?: () => void
}

export function StreamViewer({ isActive = true, onSessionCreated }: StreamViewerProps) {
  const [isLive, setIsLive] = useState(false)
  const [viewerCount, setViewerCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [entries, setEntries] = useState<TranscriptEntry[]>([])
  const [chunks, setChunks] = useState<ChunkData[]>([])
  const [autoScroll, setAutoScroll] = useState(true)
  const [hasBeenActive, setHasBeenActive] = useState(false)
  const [showAnnotations, setShowAnnotations] = useState(true)

  const entryIdRef = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)

  // Track when tab becomes active
  useEffect(() => {
    if (isActive && !hasBeenActive) {
      setHasBeenActive(true)
    }
  }, [isActive, hasBeenActive])

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [entries, chunks, autoScroll])

  const handleMessage = useCallback((message: ServerMessage) => {
    console.log('[StreamViewer] Received message:', message.type)
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
            const newText = entry.text.toLowerCase().trim()
            const newWords = newText.split(/\s+/).slice(0, 5).join(' ')

            if (entry.isFinal) {
              const filtered = prev.filter((e) => {
                if (e.isFinal) return true
                const existingText = e.text.toLowerCase().trim()
                if (newText.includes(existingText.slice(0, 30)) ||
                    existingText.includes(newWords)) {
                  return false
                }
                return true
              })
              return [...filtered, entry]
            } else {
              let lastInterimIndex = -1
              for (let i = prev.length - 1; i >= 0; i--) {
                if (!prev[i].isFinal && prev[i].speaker === entry.speaker) {
                  lastInterimIndex = i
                  break
                }
              }

              if (lastInterimIndex >= 0) {
                return [
                  ...prev.slice(0, lastInterimIndex),
                  entry,
                  ...prev.slice(lastInterimIndex + 1),
                ]
              }

              const lastFinal = [...prev].reverse().find((e) => e.isFinal)
              if (lastFinal) {
                const lastFinalText = lastFinal.text.toLowerCase().trim()
                if (lastFinalText.includes(newWords) || newText.startsWith(lastFinalText.slice(-30))) {
                  return prev
                }
              }

              return [...prev, entry]
            }
          })
        }
        break

      case 'chunk_created':
        console.log('[StreamViewer] Received chunk_created:', message.chunk)
        if (message.chunk) {
          // Only show analyzing state if the chunk will actually be analyzed
          const willBeAnalyzed = message.chunk.willBeAnalyzed !== false
          const newChunk: ChunkData = {
            id: message.chunk.id,
            index: message.chunk.index,
            speaker: message.chunk.speaker,
            transcript: message.chunk.transcript,
            startTimeMs: message.chunk.startTimeMs,
            endTimeMs: message.chunk.endTimeMs,
            annotation: null,
            isAnalyzing: willBeAnalyzed,
          }
          setChunks((prev) => {
            // Avoid duplicates (e.g., from replay + live)
            if (prev.some((c) => c.id === newChunk.id)) return prev
            return [...prev, newChunk]
          })

          // Also create a transcript entry so it displays in the main view
          // This handles both live chunks and replayed chunks from database
          const entry: TranscriptEntry = {
            id: `chunk-${message.chunk.id}`,
            speaker: message.chunk.speaker,
            text: message.chunk.transcript,
            confidence: 1,
            isFinal: true,
            timestamp: message.chunk.startTimeMs,
          }
          setEntries((prev) => {
            // Avoid duplicates
            if (prev.some((e) => e.id === entry.id)) return prev
            return [...prev, entry]
          })
        }
        break

      case 'chunk_analyzed':
        if (message.chunkId && message.topics && message.intents) {
          setChunks((prev) =>
            prev.map((chunk) =>
              chunk.id === message.chunkId
                ? {
                    ...chunk,
                    isAnalyzing: false,
                    annotation: {
                      id: message.chunkId!,
                      topics: message.topics!,
                      intents: message.intents!,
                      summary: message.summary || '',
                      sentiment: message.sentiment || null,
                    },
                  }
                : chunk
            )
          )
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
      case 'session_created':
        setIsLive(true)
        setEntries([])
        setChunks([])
        // Notify parent that a new file was created (for files list refresh)
        onSessionCreated?.()
        break

      case 'session_ended':
        setIsLive(false)
        break

      case 'error':
        setError(message.message || 'Server error')
        break

      default:
        // Log unknown message types for debugging
        console.debug('[StreamViewer] Unhandled message type:', message.type)
    }
  }, [onSessionCreated])

  const handleError = useCallback(() => {
    setError('Connection error')
  }, [])

  const { connectionState, connect, disconnect } = useWebSocket<ServerMessage>({
    path: '/stream/watch',
    enabled: true, // Always connect to receive session_created events for file list updates
    onMessage: handleMessage,
    onError: handleError,
    onOpen: () => setError(null),
  })

  const getStatusDisplay = () => {
    if (connectionState !== 'connected') {
      switch (connectionState) {
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

  // Group consecutive entries by speaker
  const groupedEntries: { speaker: number | null; entries: TranscriptEntry[] }[] = []
  for (const entry of entries) {
    const lastGroup = groupedEntries[groupedEntries.length - 1]
    if (lastGroup && lastGroup.speaker === entry.speaker) {
      lastGroup.entries.push(entry)
    } else {
      groupedEntries.push({ speaker: entry.speaker, entries: [entry] })
    }
  }

  // Match chunks to entry groups by speaker/time for alignment
  const getChunkForGroup = (groupIndex: number): ChunkData | null => {
    // Simple heuristic: match chunk index to group index
    return chunks[groupIndex] || null
  }

  const hasContent = entries.length > 0 || chunks.length > 0

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

        {connectionState === 'connected' && (
          <span style={{ color: '#666', fontSize: '14px' }}>
            {viewerCount} viewer{viewerCount !== 1 ? 's' : ''} watching
          </span>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showAnnotations}
              onChange={(e) => setShowAnnotations(e.target.checked)}
            />
            Show Analysis
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            Auto-scroll
          </label>

          {connectionState === 'disconnected' || connectionState === 'error' ? (
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
      {connectionState === 'connected' && !isLive && !hasContent && (
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

      {/* Two-column transcript + annotations display */}
      {hasContent && (
        <div
          ref={containerRef}
          style={{
            maxHeight: '500px',
            overflowY: 'auto',
            border: '1px solid #e0e0e0',
            borderRadius: '8px',
            background: '#fafafa',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: showAnnotations ? '1fr 200px' : '1fr',
              gap: '0',
            }}
          >
            {/* Transcript column */}
            <div style={{ padding: '16px' }}>
              {groupedEntries.map((group, groupIndex) => {
                const colors = getSpeakerColor(group.speaker)
                const label = getSpeakerLabel(group.speaker)
                const chunk = getChunkForGroup(groupIndex)

                return (
                  <div
                    key={groupIndex}
                    style={{
                      marginBottom: '12px',
                      padding: '12px',
                      background: colors.bg,
                      borderLeft: `3px solid ${colors.border}`,
                      borderRadius: '4px',
                    }}
                    data-chunk-id={chunk?.id}
                  >
                    <div
                      style={{
                        fontSize: '12px',
                        fontWeight: 600,
                        color: colors.text,
                        marginBottom: '4px',
                      }}
                    >
                      {label}
                    </div>
                    <div style={{ color: '#333', lineHeight: 1.5 }}>
                      {group.entries.map((entry, entryIndex) => (
                        <span
                          key={entry.id}
                          style={{
                            opacity: entry.isFinal ? 1 : 0.6,
                            fontStyle: entry.isFinal ? 'normal' : 'italic',
                          }}
                        >
                          {entry.text}
                          {entryIndex < group.entries.length - 1 ? ' ' : ''}
                        </span>
                      ))}
                      {group.entries.some((e) => !e.isFinal) && (
                        <span
                          style={{
                            display: 'inline-block',
                            width: '8px',
                            height: '16px',
                            background: colors.border,
                            marginLeft: '2px',
                            animation: 'blink 1s infinite',
                          }}
                        />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Annotations column */}
            {showAnnotations && (
              <div
                style={{
                  borderLeft: '1px solid #e0e0e0',
                  background: '#fff',
                }}
              >
                <div
                  style={{
                    padding: '8px 12px',
                    borderBottom: '1px solid #e0e0e0',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: '#666',
                    position: 'sticky',
                    top: 0,
                    background: '#fff',
                  }}
                >
                  Analysis
                </div>
                {chunks.length === 0 && groupedEntries.length > 0 && (
                  <div style={{ padding: '16px', color: '#999', fontSize: '12px', textAlign: 'center' }}>
                    Analysis will appear after speaker pauses
                  </div>
                )}
                {chunks.map((chunk) => (
                  <div
                    key={chunk.id}
                    style={{
                      borderBottom: '1px solid #f0f0f0',
                      minHeight: '60px',
                    }}
                  >
                    {chunk.isAnalyzing ? (
                      <ChunkAnnotationSkeleton />
                    ) : (
                      <ChunkAnnotation annotation={chunk.annotation} />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Session ended message */}
      {!isLive && hasContent && (
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
          {chunks.length > 0 && ` (${chunks.length} analyzed segments)`}
        </div>
      )}

      {/* CSS for animations */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
      `}</style>
    </section>
  )
}
