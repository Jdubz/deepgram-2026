import { useState, useEffect, useRef } from 'react'

const API_BASE = '/api'

interface AudioFile {
  id: string
  filename: string
  duration: number
  size: number
  mimeType: string
  uploadedAt: string
  status: string
}

interface FileInfo {
  filename: string
  duration?: number
  size?: number
  transcript?: string
  transcriptProvider?: string
  transcriptModel?: string
  summary?: string
  summaryProvider?: string
  summaryModel?: string
  status?: string
  error?: string
  message?: string
}

interface Job {
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

interface QueueStatus {
  totalJobs: number
  pending: number
  processing: number
  completed: number
  failed: number
}

function App() {
  const [files, setFiles] = useState<AudioFile[]>([])
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState('')
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null)
  const [maxDuration, setMaxDuration] = useState('')
  const [jobs, setJobs] = useState<Job[]>([])
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null)
  const [queueExpanded, setQueueExpanded] = useState(false)
  const [provider, setProvider] = useState<'local' | 'deepgram'>('local')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) {
      setSelectedFile(null)
      return
    }
    if (!file.type.startsWith('audio/')) {
      setMessage('Error: Please select an audio file')
      e.target.value = ''
      setSelectedFile(null)
      return
    }
    setMessage('')
    setSelectedFile(file)
  }

  const fetchFiles = async () => {
    try {
      const params = new URLSearchParams()
      if (maxDuration) params.set('maxduration', maxDuration)

      const res = await fetch(`${API_BASE}/list?${params}`)
      const data = await res.json()
      setFiles(data.files || [])
    } catch (err) {
      console.error('Failed to fetch files:', err)
    }
  }

  const fetchJobs = async () => {
    try {
      const res = await fetch(`${API_BASE}/jobs?limit=50`)
      const data = await res.json()
      setJobs(data.jobs || [])
      setQueueStatus(data.status || null)
    } catch (err) {
      console.error('Failed to fetch jobs:', err)
    }
  }

  useEffect(() => {
    fetchFiles()
    fetchJobs()
    // Auto-refresh jobs every 5 seconds when queue is expanded
    const interval = setInterval(() => {
      if (queueExpanded) {
        fetchJobs()
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [maxDuration, queueExpanded])

  const handleUpload = async () => {
    if (!selectedFile) return

    setUploading(true)
    setMessage('')

    try {
      const formData = new FormData()
      formData.append('file', selectedFile)
      formData.append('title', selectedFile.name)
      formData.append('provider', provider)

      const res = await fetch(`${API_BASE}/files`, {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()

      if (res.ok) {
        setMessage(`Uploaded: ${data.filename} (${data.provider})`)
        setSelectedFile(null)
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
        fetchFiles()
        fetchJobs()
      } else {
        setMessage(`Error: ${data.error}`)
      }
    } catch (err) {
      setMessage(`Upload failed: ${err}`)
    } finally {
      setUploading(false)
    }
  }

  const handleGetInfo = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/info?id=${encodeURIComponent(id)}`)
      const data = await res.json()
      setFileInfo(data)
    } catch (err) {
      console.error('Failed to get info:', err)
    }
  }

  const handleDownload = (filename: string) => {
    window.open(`${API_BASE}/download?name=${encodeURIComponent(filename)}`, '_blank')
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
  }

  const formatTime = (isoString: string | null) => {
    if (!isoString) return '-'
    return new Date(isoString).toLocaleTimeString()
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return '#4caf50'
      case 'processing': return '#2196f3'
      case 'pending': return '#ff9800'
      case 'failed': return '#f44336'
      default: return '#666'
    }
  }

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '20px', fontFamily: 'system-ui' }}>
      <h1>Audio Projects API</h1>
      <p style={{ color: '#666' }}>Deepgram Backend AI Engineer Interview Project</p>

      {/* Upload Section */}
      <section style={{ background: '#f5f5f5', padding: '20px', borderRadius: '8px', marginBottom: '20px' }}>
        <h2>Upload Audio</h2>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            onChange={handleFileSelect}
          />
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as 'local' | 'deepgram')}
            style={{ padding: '8px 12px' }}
          >
            <option value="local">LocalAI</option>
            <option value="deepgram">Deepgram</option>
          </select>
          <button
            onClick={handleUpload}
            disabled={!selectedFile || uploading}
            style={{ padding: '8px 16px', cursor: selectedFile ? 'pointer' : 'not-allowed' }}
          >
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>
        {message && <p style={{ marginTop: '10px', color: message.startsWith('Error') ? 'red' : 'green' }}>{message}</p>}
      </section>

      {/* Filter Section */}
      <section style={{ marginBottom: '20px' }}>
        <h2>Files</h2>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px' }}>
          <label>
            Max Duration (seconds):
            <input
              type="number"
              value={maxDuration}
              onChange={(e) => setMaxDuration(e.target.value)}
              placeholder="e.g., 300"
              style={{ marginLeft: '8px', padding: '4px', width: '100px' }}
            />
          </label>
          <button onClick={fetchFiles} style={{ padding: '4px 12px' }}>Refresh</button>
        </div>
      </section>

      {/* Files List */}
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
                <th style={{ padding: '10px', textAlign: 'left' }}>Status</th>
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
                    <span style={{ color: getStatusColor(file.status), fontWeight: 500 }}>
                      {file.status}
                    </span>
                  </td>
                  <td style={{ padding: '10px' }}>
                    <button onClick={() => handleDownload(file.filename)} style={{ marginRight: '8px' }}>
                      Download
                    </button>
                    <button onClick={() => handleGetInfo(file.id)}>
                      Get Info
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Collapsible Job Queue */}
      <section style={{ marginTop: '20px' }}>
        <div
          onClick={() => setQueueExpanded(!queueExpanded)}
          style={{
            background: '#f5f5f5',
            padding: '12px 16px',
            borderRadius: '8px',
            cursor: 'pointer',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <h2 style={{ margin: 0 }}>
            Job Queue {queueExpanded ? '▼' : '▶'}
          </h2>
          {queueStatus && (
            <div style={{ display: 'flex', gap: '16px', fontSize: '14px' }}>
              <span style={{ color: '#ff9800' }}>Pending: {queueStatus.pending}</span>
              <span style={{ color: '#2196f3' }}>Processing: {queueStatus.processing}</span>
              <span style={{ color: '#4caf50' }}>Completed: {queueStatus.completed}</span>
              <span style={{ color: '#f44336' }}>Failed: {queueStatus.failed}</span>
            </div>
          )}
        </div>

        {queueExpanded && (
          <div style={{ marginTop: '10px' }}>
            <div style={{ marginBottom: '10px', display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={fetchJobs} style={{ padding: '4px 12px' }}>Refresh</button>
            </div>
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
                        {job.processing_time_ms ? `${(job.processing_time_ms / 1000).toFixed(1)}s` : '-'}
                      </td>
                      <td style={{ padding: '8px', color: '#f44336', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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

      {/* Info Modal */}
      {fileInfo && (
        <section style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <div style={{
            background: 'white',
            padding: '24px',
            borderRadius: '8px',
            maxWidth: '600px',
            width: '90%',
            maxHeight: '80vh',
            overflow: 'auto'
          }}>
            <h3>File Info: {fileInfo.filename}</h3>

            {/* Show status for non-completed files */}
            {fileInfo.status && fileInfo.status !== 'completed' && (
              <p style={{
                color: fileInfo.status === 'failed' ? 'red' : '#666',
                background: fileInfo.status === 'failed' ? '#ffebee' : '#f5f5f5',
                padding: '12px',
                borderRadius: '4px'
              }}>
                <strong>Status:</strong> {fileInfo.status}
                {fileInfo.error && <><br/><strong>Error:</strong> {fileInfo.error}</>}
                {fileInfo.message && <><br/>{fileInfo.message}</>}
              </p>
            )}

            {/* Show details for completed files */}
            {fileInfo.duration !== undefined && (
              <p><strong>Duration:</strong> {formatDuration(fileInfo.duration)}</p>
            )}
            {fileInfo.size !== undefined && (
              <p><strong>Size:</strong> {formatSize(fileInfo.size)}</p>
            )}

            {fileInfo.transcript && (
              <>
                <p>
                  <strong>Transcript</strong>
                  {fileInfo.transcriptProvider && (
                    <span style={{ color: '#666', fontSize: '12px', marginLeft: '8px' }}>
                      ({fileInfo.transcriptProvider}{fileInfo.transcriptModel ? ` / ${fileInfo.transcriptModel}` : ''})
                    </span>
                  )}
                </p>
                <p style={{ background: '#f5f5f5', padding: '12px', borderRadius: '4px', whiteSpace: 'pre-wrap' }}>
                  {fileInfo.transcript}
                </p>
              </>
            )}

            {fileInfo.summary && (
              <>
                <p>
                  <strong>AI Summary</strong>
                  {fileInfo.summaryProvider && (
                    <span style={{ color: '#666', fontSize: '12px', marginLeft: '8px' }}>
                      ({fileInfo.summaryProvider}{fileInfo.summaryModel ? ` / ${fileInfo.summaryModel}` : ''})
                    </span>
                  )}
                </p>
                <p style={{ background: '#e3f2fd', padding: '12px', borderRadius: '4px' }}>
                  {fileInfo.summary}
                </p>
              </>
            )}

            <button onClick={() => setFileInfo(null)} style={{ marginTop: '12px', padding: '8px 16px' }}>
              Close
            </button>
          </div>
        </section>
      )}
    </div>
  )
}

export default App
