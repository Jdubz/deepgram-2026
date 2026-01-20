import { useState, useEffect, useCallback } from 'react'
import {
  UploadSection,
  RecordSection,
  FilesList,
  JobQueue,
  FileInfoModal,
  StreamBroadcast,
  StreamViewer,
  type AudioFile,
  type Job,
  type QueueStatus,
  type FileInfo,
} from './components'
import { useJobEvents } from './hooks/useJobEvents'

type Tab = 'files' | 'watch'

const API_BASE = '/api'

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('files')
  const [files, setFiles] = useState<AudioFile[]>([])
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState('')
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null)
  const [maxDuration, setMaxDuration] = useState('')
  const [minConfidence, setMinConfidence] = useState('')
  const [jobs, setJobs] = useState<Job[]>([])
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null)
  const [queueExpanded, setQueueExpanded] = useState(false)
  const [provider, setProvider] = useState<'local' | 'deepgram'>('local')

  const fetchFiles = async () => {
    try {
      const params = new URLSearchParams()
      if (maxDuration) params.set('maxduration', maxDuration)
      // Convert percentage (0-100) to decimal (0-1) for API
      if (minConfidence) params.set('min_confidence', String(Number(minConfidence) / 100))

      const res = await fetch(`${API_BASE}/list?${params}`)
      const data = await res.json()
      setFiles(data.files || [])
    } catch (err) {
      console.error('Failed to fetch files:', err)
    }
  }

  // Helper to update a job in the list
  const updateJob = useCallback((jobId: number, updates: Partial<Job>) => {
    setJobs((prev) =>
      prev.map((job) => (job.id === jobId ? { ...job, ...updates } : job))
    )
  }, [])

  // WebSocket hook for real-time job updates
  const { isConnected } = useJobEvents({
    onInitialState: (initialJobs, status) => {
      setJobs(initialJobs)
      setQueueStatus(status)
    },
    onJobCreated: (job) => {
      setJobs((prev) => [job, ...prev.filter((j) => j.id !== job.id)])
    },
    onJobClaimed: (jobId, startedAt) => {
      updateJob(jobId, { status: 'processing', started_at: startedAt })
    },
    onJobCompleted: (jobId, processingTimeMs, completedAt) => {
      updateJob(jobId, {
        status: 'completed',
        processing_time_ms: processingTimeMs,
        completed_at: completedAt,
      })
    },
    onJobFailed: (jobId, errorMessage) => {
      updateJob(jobId, {
        status: 'failed',
        error_message: errorMessage,
        completed_at: new Date().toISOString(),
      })
    },
    onQueueStatus: setQueueStatus,
  })

  useEffect(() => {
    fetchFiles()
  }, [maxDuration, minConfidence])

  const handleUpload = async (file: File) => {
    setUploading(true)
    setMessage('')

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('title', file.name)
      formData.append('provider', provider)

      const res = await fetch(`${API_BASE}/files`, {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()

      if (res.ok) {
        setMessage(`Uploaded: ${data.filename} (${data.provider})`)
        fetchFiles()
        // Jobs update automatically via WebSocket
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

  const tabStyle = (tab: Tab) => ({
    padding: '10px 20px',
    border: 'none',
    background: activeTab === tab ? '#1976d2' : '#e0e0e0',
    color: activeTab === tab ? 'white' : '#333',
    cursor: 'pointer',
    borderRadius: '4px 4px 0 0',
    fontWeight: activeTab === tab ? 600 : 400,
    marginRight: '4px',
  })

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '20px', fontFamily: 'system-ui' }}>
      <h1>Audio Projects API</h1>
      <p style={{ color: '#666' }}>Deepgram Backend AI Engineer Interview Project</p>

      {/* Tab Navigation */}
      <div style={{ marginBottom: '20px', borderBottom: '2px solid #1976d2' }}>
        <button style={tabStyle('files')} onClick={() => setActiveTab('files')}>
          Audio Files
        </button>
        <button style={tabStyle('watch')} onClick={() => setActiveTab('watch')}>
          Watch Live
        </button>
      </div>

      {/* Files Tab */}
      <div style={{ display: activeTab === 'files' ? 'block' : 'none' }}>
        <UploadSection
          provider={provider}
          onProviderChange={setProvider}
          onUpload={handleUpload}
          uploading={uploading}
          message={message}
        />

        <RecordSection
          provider={provider}
          onProviderChange={setProvider}
          onUploadSuccess={() => {
            fetchFiles()
            // Jobs update automatically via WebSocket
          }}
        />

        <FilesList
          files={files}
          maxDuration={maxDuration}
          minConfidence={minConfidence}
          onMaxDurationChange={setMaxDuration}
          onMinConfidenceChange={setMinConfidence}
          onRefresh={fetchFiles}
          onGetInfo={handleGetInfo}
        />

        <JobQueue
          jobs={jobs}
          queueStatus={queueStatus}
          expanded={queueExpanded}
          onToggleExpand={() => setQueueExpanded(!queueExpanded)}
          isConnected={isConnected}
        />

        <StreamBroadcast />
      </div>

      {/* Watch Tab - kept mounted to preserve connection */}
      <div style={{ display: activeTab === 'watch' ? 'block' : 'none' }}>
        <StreamViewer isActive={activeTab === 'watch'} />
      </div>

      {fileInfo && <FileInfoModal fileInfo={fileInfo} onClose={() => setFileInfo(null)} onDownload={handleDownload} />}
    </div>
  )
}

export default App
