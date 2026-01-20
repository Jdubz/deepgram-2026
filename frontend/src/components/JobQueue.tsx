import { formatTime, getStatusColor } from '../utils/format'

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
  return (
    <section style={{ marginTop: '20px' }}>
      <div
        onClick={onToggleExpand}
        style={{
          background: '#f5f5f5',
          padding: '12px 16px',
          borderRadius: '8px',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h2 style={{ margin: 0 }}>Job Queue {expanded ? '▼' : '▶'}</h2>
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
        </div>
        {queueStatus && (
          <div style={{ display: 'flex', gap: '16px', fontSize: '14px' }}>
            <span style={{ color: '#ff9800' }}>Pending: {queueStatus.pending}</span>
            <span style={{ color: '#2196f3' }}>Processing: {queueStatus.processing}</span>
            <span style={{ color: '#4caf50' }}>Completed: {queueStatus.completed}</span>
            <span style={{ color: '#f44336' }}>Failed: {queueStatus.failed}</span>
          </div>
        )}
      </div>

      {expanded && (
        <div style={{ marginTop: '10px' }}>
          {onRefresh && (
            <div style={{ marginBottom: '10px', display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={onRefresh} style={{ padding: '4px 12px' }}>
                Refresh
              </button>
            </div>
          )}
          {jobs.length === 0 ? (
            <p style={{ color: '#666' }}>No jobs in queue.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr style={{ background: '#eee' }}>
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
                  <tr key={job.id} style={{ borderBottom: '1px solid #eee' }}>
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
        </div>
      )}
    </section>
  )
}
