import { formatDuration, formatSize } from '../utils/format'

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
            src={`/api/download?id=${encodeURIComponent(fileInfo.id)}`}
            style={{ width: '100%' }}
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

        {/* Summary section with job-specific status */}
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
