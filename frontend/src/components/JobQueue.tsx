import { formatTime, getStatusColor } from '../utils/format'
import { CollapsibleSection } from './CollapsibleSection'

export interface Job {
  id: number
  job_type: 'transcribe' | 'summarize'
  status: 'pending' | 'processing' | 'completed' | 'failed'
  provider: string
  audio_file_id: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  processing_time_ms: number | null
  error_message: string | null
}

export interface QueueStatus {
  totalJobs: number
  pending: number
  processing: number
  completed: number
  failed: number
}

interface JobQueueProps {
  jobs: Job[]
  queueStatus: QueueStatus | null
  expanded: boolean
  onToggleExpand: () => void
  onRefresh?: () => void
  isConnected?: boolean
}

export function JobQueue({
  jobs,
  queueStatus,
  expanded,
  onToggleExpand,
  onRefresh,
  isConnected = true,
}: JobQueueProps) {
  const headerRight = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '14px' }}>
      {queueStatus && (
        <>
          <span style={{ color: '#ff9800' }}>Pending: {queueStatus.pending}</span>
          <span style={{ color: '#2196f3' }}>Processing: {queueStatus.processing}</span>
          <span style={{ color: '#4caf50' }}>Completed: {queueStatus.completed}</span>
          <span style={{ color: '#f44336' }}>Failed: {queueStatus.failed}</span>
        </>
      )}
      <span
        title={isConnected ? 'Live updates connected' : 'Live updates disconnected'}
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: isConnected ? '#4caf50' : '#f44336',
          display: 'inline-block',
        }}
      />
      {onRefresh && (
        <button onClick={onRefresh} style={{ padding: '4px 12px' }}>
          Refresh
        </button>
      )}
    </div>
  )

  return (
    <CollapsibleSection
      title="Job Queue"
      count={jobs.length}
      expanded={expanded}
      onToggle={onToggleExpand}
      headerRight={headerRight}
    >
      {jobs.length === 0 ? (
        <p style={{ color: '#666', margin: 0 }}>No jobs in queue.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
          <thead>
            <tr style={{ background: '#e8e8e8' }}>
              <th style={{ padding: '8px', textAlign: 'left' }}>ID</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>Type</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>Status</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>Provider</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>Created</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>Time</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>Error</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} style={{ borderBottom: '1px solid #e0e0e0' }}>
                <td style={{ padding: '8px' }}>{job.id}</td>
                <td style={{ padding: '8px' }}>{job.job_type}</td>
                <td style={{ padding: '8px' }}>
                  <span style={{ color: getStatusColor(job.status), fontWeight: 500 }}>
                    {job.status}
                  </span>
                </td>
                <td style={{ padding: '8px' }}>{job.provider}</td>
                <td style={{ padding: '8px' }}>{formatTime(job.created_at)}</td>
                <td style={{ padding: '8px' }}>
                  {job.processing_time_ms
                    ? `${(job.processing_time_ms / 1000).toFixed(1)}s`
                    : '-'}
                </td>
                <td
                  style={{
                    padding: '8px',
                    color: '#f44336',
                    maxWidth: '200px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {job.error_message || '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </CollapsibleSection>
  )
}
