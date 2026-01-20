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
  // Summary job info
  summaryStatus: 'pending' | 'completed' | 'failed'
  summary?: string | null
  summaryError?: string | null
  summaryProvider?: string | null
  summaryModel?: string | null
}

interface FileInfoModalProps {
  fileInfo: FileInfo
  onClose: () => void
}

export function FileInfoModal({ fileInfo, onClose }: FileInfoModalProps) {
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
          <p>
            <strong>Transcript</strong>
            {fileInfo.transcriptProvider && (
              <span style={{ color: '#666', fontSize: '12px', marginLeft: '8px' }}>
                ({fileInfo.transcriptProvider}
                {fileInfo.transcriptModel ? ` / ${fileInfo.transcriptModel}` : ''})
              </span>
            )}
          </p>
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
          <p>
            <strong>AI Summary</strong>
            {fileInfo.summaryProvider && (
              <span style={{ color: '#666', fontSize: '12px', marginLeft: '8px' }}>
                ({fileInfo.summaryProvider}
                {fileInfo.summaryModel ? ` / ${fileInfo.summaryModel}` : ''})
              </span>
            )}
          </p>
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

        <button onClick={onClose} style={{ marginTop: '12px', padding: '8px 16px' }}>
          Close
        </button>
      </div>
    </section>
  )
}
