import { formatDuration, formatSize } from '../utils/format'
import { ChunkSentiment } from './ChunkAnnotation'

// Stream chunk with analysis data
export interface StreamChunkInfo {
  id: number
  index: number
  speaker: number | null
  transcript: string
  startTimeMs: number
  endTimeMs: number
  confidence: number | null
  analysisStatus: 'pending' | 'processing' | 'completed' | 'skipped'
  topics: Array<{ topic: string; confidence: number }> | null
  intents: Array<{ intent: string; confidence: number }> | null
  summary: string | null
  sentiment: ChunkSentiment | null
}

// Stream session data
export interface StreamSessionInfo {
  id: string
  durationMs: number
  chunkCount: number
  speakers: number[]
  status: 'active' | 'ended'
  startedAt: string
  endedAt: string | null
  chunks: StreamChunkInfo[]
}

export interface FileInfo {
  id: string
  filename: string
  duration?: number
  size?: number
  // Transcript job info
  transcriptStatus: 'pending' | 'completed' | 'failed'
  transcript?: string | null
  transcriptError?: string | null
  transcriptProvider?: string | null
  transcriptModel?: string | null
  transcriptConfidence?: number | null
  // Summary job info
  summaryStatus: 'pending' | 'completed' | 'failed'
  summary?: string | null
  summaryError?: string | null
  summaryProvider?: string | null
  summaryModel?: string | null
  summaryConfidence?: number | null
  // Text intelligence analysis (from Deepgram)
  topics?: Array<{ topic: string; confidence: number }> | null
  intents?: Array<{ intent: string; confidence: number }> | null
  sentiment?: ChunkSentiment | null
  // Stream session data (for recordings from live streams)
  streamSession?: StreamSessionInfo | null
}

// Visual confidence indicator component
function ConfidenceBadge({ confidence, label }: { confidence: number | null | undefined; label: string }) {
  if (confidence === null || confidence === undefined) return null

  const percentage = Math.round(confidence * 100)
  const getColor = () => {
    if (percentage >= 90) return { bg: '#e8f5e9', text: '#2e7d32', bar: '#4caf50' }
    if (percentage >= 70) return { bg: '#fff3e0', text: '#ef6c00', bar: '#ff9800' }
    return { bg: '#ffebee', text: '#c62828', bar: '#f44336' }
  }
  const colors = getColor()

  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      background: colors.bg,
      padding: '4px 10px',
      borderRadius: '12px',
      fontSize: '12px',
      marginLeft: '8px'
    }}>
      <span style={{ color: colors.text, fontWeight: 500 }}>{label}: {percentage}%</span>
      <div style={{
        width: '50px',
        height: '6px',
        background: '#e0e0e0',
        borderRadius: '3px',
        overflow: 'hidden'
      }}>
        <div style={{
          width: `${percentage}%`,
          height: '100%',
          background: colors.bar,
          borderRadius: '3px'
        }} />
      </div>
    </div>
  )
}

interface FileInfoModalProps {
  fileInfo: FileInfo
  onClose: () => void
  onDownload: (filename: string) => void
}

export function FileInfoModal({ fileInfo, onClose, onDownload }: FileInfoModalProps) {
  return (
    <section
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: 'white',
          padding: '24px',
          borderRadius: '8px',
          maxWidth: '600px',
          width: '90%',
          maxHeight: '80vh',
          overflow: 'auto',
        }}
      >
        <h3>File Info: {fileInfo.filename}</h3>

        {/* Always show file details */}
        {fileInfo.duration !== undefined && (
          <p>
            <strong>Duration:</strong> {formatDuration(fileInfo.duration)}
          </p>
        )}
        {fileInfo.size !== undefined && (
          <p>
            <strong>Size:</strong> {formatSize(fileInfo.size)}
          </p>
        )}

        {/* Audio player */}
        <div style={{ marginTop: '16px' }}>
          <audio
            controls
            preload="metadata"
            src={`/api/download?id=${encodeURIComponent(fileInfo.id)}`}
            style={{ width: '100%' }}
            onError={(e) => {
              const audio = e.currentTarget
              const error = audio.error
              console.error('[Audio Player] Error:', {
                code: error?.code,
                message: error?.message,
                networkState: audio.networkState,
                readyState: audio.readyState,
                src: audio.src,
              })
            }}
          >
            Your browser does not support the audio element.
          </audio>
        </div>

        {/* Transcript section with job-specific status */}
        <div style={{ marginTop: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', marginBottom: '8px' }}>
            <strong>Transcript</strong>
            {fileInfo.transcriptProvider && (
              <span style={{ color: '#666', fontSize: '12px', marginLeft: '8px' }}>
                ({fileInfo.transcriptProvider}
                {fileInfo.transcriptModel ? ` / ${fileInfo.transcriptModel}` : ''})
              </span>
            )}
            <ConfidenceBadge confidence={fileInfo.transcriptConfidence} label="Confidence" />
          </div>
          {fileInfo.transcriptStatus === 'pending' && (
            <p
              style={{
                background: '#fff3e0',
                padding: '12px',
                borderRadius: '4px',
                color: '#e65100',
              }}
            >
              Pending...
            </p>
          )}
          {fileInfo.transcriptStatus === 'failed' && (
            <p
              style={{
                background: '#ffebee',
                padding: '12px',
                borderRadius: '4px',
                color: '#c62828',
              }}
            >
              Failed: {fileInfo.transcriptError || 'Unknown error'}
            </p>
          )}
          {fileInfo.transcriptStatus === 'completed' && (
            <p
              style={{
                background: '#f5f5f5',
                padding: '12px',
                borderRadius: '4px',
                whiteSpace: 'pre-wrap',
              }}
            >
              {fileInfo.transcript || '(Empty transcript)'}
            </p>
          )}
        </div>

        {/* Summary section - different handling for stream files vs uploaded files */}
        {fileInfo.streamSession ? (
          // Stream files: Show combined summary from chunks
          <div style={{ marginTop: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', marginBottom: '8px' }}>
              <strong>AI Summary</strong>
              <span style={{ color: '#666', fontSize: '12px', marginLeft: '8px' }}>
                (from {fileInfo.streamSession.chunks.length} segments)
              </span>
            </div>
            {fileInfo.streamSession.chunks.some(c => c.analysisStatus === 'completed' && c.summary) ? (
              <div style={{ background: '#f5f5f5', padding: '8px', borderRadius: '4px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {fileInfo.streamSession.chunks
                  .filter(c => c.analysisStatus === 'completed' && c.summary)
                  .map((chunk) => {
                    const speakerColors = ['#e3f2fd', '#f3e5f5', '#e8f5e9', '#fff3e0']
                    const borderColors = ['#1976d2', '#7b1fa2', '#388e3c', '#f57c00']
                    const colorIndex = chunk.speaker !== null ? chunk.speaker % speakerColors.length : 0
                    return (
                      <div
                        key={chunk.id}
                        style={{
                          background: speakerColors[colorIndex],
                          borderLeft: `3px solid ${borderColors[colorIndex]}`,
                          padding: '10px 12px',
                          borderRadius: '4px',
                          fontSize: '14px',
                        }}
                      >
                        <span style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '4px' }}>
                          {chunk.speaker !== null ? `Speaker ${chunk.speaker + 1}` : 'Unknown'} • {Math.round(chunk.startTimeMs / 1000)}s
                        </span>
                        {chunk.summary}
                      </div>
                    )
                  })}
              </div>
            ) : fileInfo.streamSession.chunks.some(c => c.analysisStatus === 'pending' || c.analysisStatus === 'processing') ? (
              <p style={{ background: '#fff3e0', padding: '12px', borderRadius: '4px', color: '#e65100' }}>
                Analysis in progress...
              </p>
            ) : (
              <p style={{ background: '#f5f5f5', padding: '12px', borderRadius: '4px', color: '#666' }}>
                No summaries available
              </p>
            )}
          </div>
        ) : (
          // Uploaded files: Show single summary job status
          <div style={{ marginTop: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', marginBottom: '8px' }}>
              <strong>AI Summary</strong>
              {fileInfo.summaryProvider && (
                <span style={{ color: '#666', fontSize: '12px', marginLeft: '8px' }}>
                  ({fileInfo.summaryProvider}
                  {fileInfo.summaryModel ? ` / ${fileInfo.summaryModel}` : ''})
                </span>
              )}
              <ConfidenceBadge confidence={fileInfo.summaryConfidence} label="Confidence" />
            </div>
            {fileInfo.summaryStatus === 'pending' && (
              <p
                style={{
                  background: '#fff3e0',
                  padding: '12px',
                  borderRadius: '4px',
                  color: '#e65100',
                }}
              >
                Pending...
              </p>
            )}
            {fileInfo.summaryStatus === 'failed' && (
              <p
                style={{
                  background: '#ffebee',
                  padding: '12px',
                  borderRadius: '4px',
                  color: '#c62828',
                }}
              >
                Failed: {fileInfo.summaryError || 'Unknown error'}
              </p>
            )}
            {fileInfo.summaryStatus === 'completed' && (
              <p style={{ background: '#e3f2fd', padding: '12px', borderRadius: '4px' }}>
                {fileInfo.summary || '(Empty summary)'}
              </p>
            )}
          </div>
        )}

        {/* Text Intelligence Analysis (Deepgram only) */}
        {fileInfo.summaryStatus === 'completed' && (fileInfo.topics || fileInfo.intents || fileInfo.sentiment) && (
          <div style={{ marginTop: '16px' }}>
            <strong>Text Analysis</strong>

            {/* Sentiment */}
            {fileInfo.sentiment && (
              <div style={{ marginTop: '8px' }}>
                <span style={{ fontSize: '13px', color: '#666' }}>Sentiment: </span>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '4px 10px',
                    background:
                      fileInfo.sentiment.sentiment === 'positive'
                        ? '#e8f5e9'
                        : fileInfo.sentiment.sentiment === 'negative'
                        ? '#ffebee'
                        : '#f5f5f5',
                    color:
                      fileInfo.sentiment.sentiment === 'positive'
                        ? '#2e7d32'
                        : fileInfo.sentiment.sentiment === 'negative'
                        ? '#c62828'
                        : '#666',
                    borderRadius: '12px',
                    fontSize: '13px',
                    fontWeight: 500,
                  }}
                  title={`Score: ${fileInfo.sentiment.sentimentScore.toFixed(2)}`}
                >
                  {fileInfo.sentiment.sentiment === 'positive'
                    ? '+'
                    : fileInfo.sentiment.sentiment === 'negative'
                    ? '-'
                    : '~'}
                  {' '}
                  {fileInfo.sentiment.sentiment}
                </span>
              </div>
            )}

            {/* Topics */}
            {fileInfo.topics && (
              <div style={{ marginTop: '8px' }}>
                <span style={{ fontSize: '13px', color: '#666' }}>Topics: </span>
                {fileInfo.topics.length > 0 ? (
                  <div style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                    {fileInfo.topics.slice(0, 5).map((topic, index) => (
                      <span
                        key={`${index}-${topic.topic}`}
                        style={{
                          display: 'inline-block',
                          padding: '3px 8px',
                          background: ['#e3f2fd', '#f3e5f5', '#e8f5e9', '#fff3e0', '#fce4ec'][index % 5],
                          color: ['#1565c0', '#7b1fa2', '#2e7d32', '#ef6c00', '#c2185b'][index % 5],
                          borderRadius: '12px',
                          fontSize: '12px',
                          fontWeight: 500,
                        }}
                        title={`Confidence: ${Math.round(topic.confidence * 100)}%`}
                      >
                        {topic.topic}
                      </span>
                    ))}
                    {fileInfo.topics.length > 5 && (
                      <span style={{ fontSize: '12px', color: '#999' }}>
                        +{fileInfo.topics.length - 5} more
                      </span>
                    )}
                  </div>
                ) : (
                  <span style={{ fontSize: '13px', color: '#999', fontStyle: 'italic' }}>None detected</span>
                )}
              </div>
            )}

            {/* Intents */}
            {fileInfo.intents && (
              <div style={{ marginTop: '8px' }}>
                <span style={{ fontSize: '13px', color: '#666' }}>Intents: </span>
                {fileInfo.intents.length > 0 ? (
                  <div style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                    {fileInfo.intents.slice(0, 4).map((intent, index) => (
                      <span
                        key={`${index}-${intent.intent}`}
                        style={{
                          display: 'inline-block',
                          padding: '3px 8px',
                          background: '#f5f5f5',
                          color: '#666',
                          borderRadius: '4px',
                          fontSize: '12px',
                        }}
                        title={`Confidence: ${Math.round(intent.confidence * 100)}%`}
                      >
                        {intent.intent}
                      </span>
                    ))}
                    {fileInfo.intents.length > 4 && (
                      <span style={{ fontSize: '12px', color: '#999' }}>
                        +{fileInfo.intents.length - 4} more
                      </span>
                    )}
                  </div>
                ) : (
                  <span style={{ fontSize: '13px', color: '#999', fontStyle: 'italic' }}>None detected</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Stream Session Chunks (for recordings from live streams) */}
        {fileInfo.streamSession && fileInfo.streamSession.chunks.length > 0 && (
          <div style={{ marginTop: '16px' }}>
            <strong>Stream Segments ({fileInfo.streamSession.chunks.length})</strong>
            <div
              style={{
                marginTop: '8px',
                maxHeight: '300px',
                overflowY: 'auto',
                border: '1px solid #e0e0e0',
                borderRadius: '8px',
              }}
            >
              {fileInfo.streamSession.chunks.map((chunk) => {
                const speakerColors = [
                  { bg: '#e3f2fd', border: '#1976d2' },
                  { bg: '#f3e5f5', border: '#7b1fa2' },
                  { bg: '#e8f5e9', border: '#388e3c' },
                  { bg: '#fff3e0', border: '#f57c00' },
                ]
                const colorIndex = chunk.speaker !== null ? chunk.speaker % speakerColors.length : 0
                const colors = speakerColors[colorIndex]

                return (
                  <div
                    key={chunk.id}
                    style={{
                      padding: '12px',
                      borderBottom: '1px solid #f0f0f0',
                      background: colors.bg,
                      borderLeft: `3px solid ${colors.border}`,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: '#666' }}>
                        {chunk.speaker !== null ? `Speaker ${chunk.speaker + 1}` : 'Unknown'}
                      </span>
                      <span style={{ fontSize: '11px', color: '#999' }}>
                        {Math.round(chunk.startTimeMs / 1000)}s - {Math.round(chunk.endTimeMs / 1000)}s
                      </span>
                    </div>
                    <p style={{ margin: '0 0 8px 0', fontSize: '14px', lineHeight: 1.4 }}>
                      {chunk.transcript}
                    </p>

                    {/* Chunk Analysis */}
                    {chunk.analysisStatus === 'completed' && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                        {/* Sentiment */}
                        {chunk.sentiment && (
                          <span
                            style={{
                              padding: '2px 6px',
                              background: chunk.sentiment.sentiment === 'positive' ? '#c8e6c9' : chunk.sentiment.sentiment === 'negative' ? '#ffcdd2' : '#e0e0e0',
                              color: chunk.sentiment.sentiment === 'positive' ? '#2e7d32' : chunk.sentiment.sentiment === 'negative' ? '#c62828' : '#666',
                              borderRadius: '4px',
                              fontSize: '10px',
                              fontWeight: 500,
                            }}
                          >
                            {chunk.sentiment.sentiment}
                          </span>
                        )}
                        {/* Topics */}
                        {chunk.topics && chunk.topics.slice(0, 2).map((topic, topicIndex) => (
                          <span
                            key={`${chunk.id}-topic-${topicIndex}`}
                            style={{
                              padding: '2px 6px',
                              background: '#e3f2fd',
                              color: '#1565c0',
                              borderRadius: '10px',
                              fontSize: '10px',
                            }}
                          >
                            {topic.topic}
                          </span>
                        ))}
                        {/* Intents */}
                        {chunk.intents && chunk.intents.slice(0, 1).map((intent, intentIndex) => (
                          <span
                            key={`${chunk.id}-intent-${intentIndex}`}
                            style={{
                              padding: '2px 6px',
                              background: '#f5f5f5',
                              color: '#666',
                              borderRadius: '4px',
                              fontSize: '10px',
                            }}
                          >
                            {intent.intent}
                          </span>
                        ))}
                      </div>
                    )}
                    {chunk.analysisStatus === 'pending' && (
                      <span style={{ fontSize: '10px', color: '#ff9800', fontStyle: 'italic' }}>Analysis pending...</span>
                    )}
                    {chunk.analysisStatus === 'processing' && (
                      <span style={{ fontSize: '10px', color: '#2196f3', fontStyle: 'italic' }}>Analyzing...</span>
                    )}
                    {chunk.analysisStatus === 'skipped' && (
                      <span style={{ fontSize: '10px', color: '#999', fontStyle: 'italic' }}>Analysis skipped (too short)</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
          <button
            onClick={() => onDownload(fileInfo.filename)}
            style={{ padding: '8px 16px', background: '#1976d2', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          >
            Download
          </button>
          <button onClick={onClose} style={{ padding: '8px 16px' }}>
            Close
          </button>
        </div>
      </div>
    </section>
  )
}
