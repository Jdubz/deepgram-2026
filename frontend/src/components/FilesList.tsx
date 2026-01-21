import { useState } from 'react'
import { formatDuration, formatSize } from '../utils/format'
import { CollapsibleSection } from './CollapsibleSection'

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
  onGetInfo: (id: string) => void
}

export function FilesList({
  files,
  maxDuration,
  onMaxDurationChange,
  onRefresh,
  onGetInfo,
}: FilesListProps) {
  const [isExpanded, setIsExpanded] = useState(true)

  const filterControls = (
    <div style={{ display: 'flex', gap: '12px', alignItems: 'center', fontSize: '14px' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        Max Duration:
        <input
          type="number"
          value={maxDuration}
          onChange={(e) => onMaxDurationChange(e.target.value)}
          placeholder="sec"
          style={{ padding: '4px', width: '60px' }}
        />
      </label>
      <button onClick={onRefresh} style={{ padding: '4px 12px' }}>
        Refresh
      </button>
    </div>
  )

  return (
    <CollapsibleSection
      title="Files"
      count={files.length}
      expanded={isExpanded}
      onToggle={() => setIsExpanded(!isExpanded)}
      headerRight={filterControls}
    >
      {files.length === 0 ? (
        <p style={{ color: '#666', margin: 0 }}>No files uploaded yet.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#e8e8e8' }}>
              <th style={{ padding: '10px', textAlign: 'left' }}>Filename</th>
              <th style={{ padding: '10px', textAlign: 'left' }}>Duration</th>
              <th style={{ padding: '10px', textAlign: 'left' }}>Size</th>
              <th style={{ padding: '10px', textAlign: 'left' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {files.map((file) => (
              <tr key={file.id} style={{ borderBottom: '1px solid #e0e0e0' }}>
                <td style={{ padding: '10px' }}>{file.filename}</td>
                <td style={{ padding: '10px' }}>{formatDuration(file.duration)}</td>
                <td style={{ padding: '10px' }}>{formatSize(file.size)}</td>
                <td style={{ padding: '10px' }}>
                  <button onClick={() => onGetInfo(file.id)}>Details</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </CollapsibleSection>
  )
}
