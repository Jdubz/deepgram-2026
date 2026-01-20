import { formatDuration, formatSize } from '../utils/format'

export interface AudioFile {
  id: string
  filename: string
  duration: number
  size: number
  mimeType: string
  uploadedAt: string
}

interface FilesListProps {
  files: AudioFile[]
  maxDuration: string
  onMaxDurationChange: (value: string) => void
  onRefresh: () => void
  onDownload: (filename: string) => void
  onGetInfo: (id: string) => void
}

export function FilesList({
  files,
  maxDuration,
  onMaxDurationChange,
  onRefresh,
  onDownload,
  onGetInfo,
}: FilesListProps) {
  return (
    <>
      {/* Filter Section */}
      <section style={{ marginBottom: '20px' }}>
        <h2>Files</h2>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px' }}>
          <label>
            Max Duration (seconds):
            <input
              type="number"
              value={maxDuration}
              onChange={(e) => onMaxDurationChange(e.target.value)}
              placeholder="e.g., 300"
              style={{ marginLeft: '8px', padding: '4px', width: '100px' }}
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
                <th style={{ padding: '10px', textAlign: 'left' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr key={file.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '10px' }}>{file.filename}</td>
                  <td style={{ padding: '10px' }}>{formatDuration(file.duration)}</td>
                  <td style={{ padding: '10px' }}>{formatSize(file.size)}</td>
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
