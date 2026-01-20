import { formatDuration, formatSize } from '../utils/format'

export interface AudioFile {
  id: string
  filename: string
  duration: number
  size: number
  mimeType: string
  uploadedAt: string
  transcriptConfidence?: number | null
  summaryConfidence?: number | null
}

// Compact confidence indicator for table
function ConfidenceCell({ confidence }: { confidence: number | null | undefined }) {
  if (confidence === null || confidence === undefined) {
    return <span style={{ color: '#999' }}>—</span>
  }

  const percentage = Math.round(confidence * 100)
  const getColor = () => {
    if (percentage >= 90) return '#4caf50'
    if (percentage >= 70) return '#ff9800'
    return '#f44336'
  }

  return (
    <span style={{
      color: getColor(),
      fontWeight: 500,
      fontSize: '13px'
    }}>
      {percentage}%
    </span>
  )
}

interface FilesListProps {
  files: AudioFile[]
  maxDuration: string
  minConfidence: string
  onMaxDurationChange: (value: string) => void
  onMinConfidenceChange: (value: string) => void
  onRefresh: () => void
  onDownload: (filename: string) => void
  onGetInfo: (id: string) => void
}

export function FilesList({
  files,
  maxDuration,
  minConfidence,
  onMaxDurationChange,
  onMinConfidenceChange,
  onRefresh,
  onDownload,
  onGetInfo,
}: FilesListProps) {
  return (
    <>
      {/* Filter Section */}
      <section style={{ marginBottom: '20px' }}>
        <h2>Files</h2>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap' }}>
          <label>
            Max Duration (s):
            <input
              type="number"
              value={maxDuration}
              onChange={(e) => onMaxDurationChange(e.target.value)}
              placeholder="e.g., 300"
              style={{ marginLeft: '8px', padding: '4px', width: '80px' }}
            />
          </label>
          <label>
            Min Confidence (%):
            <input
              type="number"
              value={minConfidence}
              onChange={(e) => onMinConfidenceChange(e.target.value)}
              placeholder="e.g., 80"
              min="0"
              max="100"
              style={{ marginLeft: '8px', padding: '4px', width: '80px' }}
            />
          </label>
          <button onClick={onRefresh} style={{ padding: '4px 12px' }}>
            Refresh
          </button>
        </div>
      </section>

      {/* Files Table */}
      <section>
        {files.length === 0 ? (
          <p style={{ color: '#666' }}>No files uploaded yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#eee' }}>
                <th style={{ padding: '10px', textAlign: 'left' }}>Filename</th>
                <th style={{ padding: '10px', textAlign: 'left' }}>Duration</th>
                <th style={{ padding: '10px', textAlign: 'left' }}>Size</th>
                <th style={{ padding: '10px', textAlign: 'center' }}>Confidence</th>
                <th style={{ padding: '10px', textAlign: 'left' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr key={file.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '10px' }}>{file.filename}</td>
                  <td style={{ padding: '10px' }}>{formatDuration(file.duration)}</td>
                  <td style={{ padding: '10px' }}>{formatSize(file.size)}</td>
                  <td style={{ padding: '10px', textAlign: 'center' }}>
                    <ConfidenceCell confidence={file.transcriptConfidence} />
                  </td>
                  <td style={{ padding: '10px' }}>
                    <button
                      onClick={() => onDownload(file.filename)}
                      style={{ marginRight: '8px' }}
                    >
                      Download
                    </button>
                    <button onClick={() => onGetInfo(file.id)}>Get Info</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}
