import { useState, useEffect } from 'react'
import {
  UploadSection,
  FilesList,
  JobQueue,
  FileInfoModal,
  type AudioFile,
  type Job,
  type QueueStatus,
  type FileInfo,
} from './components'

const API_BASE = '/api'

function App() {
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
  }, [maxDuration, minConfidence])

  // Auto-refresh jobs when queue is expanded
  useEffect(() => {
    if (!queueExpanded) return

    const interval = setInterval(fetchJobs, 5000)
    return () => clearInterval(interval)
  }, [queueExpanded])

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

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '20px', fontFamily: 'system-ui' }}>
      <h1>Audio Projects API</h1>
      <p style={{ color: '#666' }}>Deepgram Backend AI Engineer Interview Project</p>

      <UploadSection
        provider={provider}
        onProviderChange={setProvider}
        onUpload={handleUpload}
        uploading={uploading}
        message={message}
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
        onRefresh={fetchJobs}
      />

      {fileInfo && <FileInfoModal fileInfo={fileInfo} onClose={() => setFileInfo(null)} onDownload={handleDownload} />}
    </div>
  )
}

export default App
