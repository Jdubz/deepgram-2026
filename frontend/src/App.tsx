import { useState, useEffect } from 'react'

const API_BASE = '/api'

interface AudioFile {
  id: string
  filename: string
  duration: number
  size: number
  mimeType: string
  uploadedAt: string
}

interface FileInfo {
  filename: string
  duration: number
  size: number
  summary: string
}

function App() {
  const [files, setFiles] = useState<AudioFile[]>([])
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState('')
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null)
  const [maxDuration, setMaxDuration] = useState('')

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

  useEffect(() => {
    fetchFiles()
  }, [maxDuration])

  const handleUpload = async () => {
    if (!selectedFile) return

    setUploading(true)
    setMessage('')

    try {
      const formData = new FormData()
      formData.append('file', selectedFile)
      formData.append('title', selectedFile.name)

      const res = await fetch(`${API_BASE}/files`, {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()

      if (res.ok) {
        setMessage(`Uploaded: ${data.filename} (${data.duration.toFixed(2)}s)`)
        setSelectedFile(null)
        fetchFiles()
      } else {
        setMessage(`Error: ${data.error}`)
      }
    } catch (err) {
      setMessage(`Upload failed: ${err}`)
    } finally {
      setUploading(false)
    }
  }

  const handleGetInfo = async (filename: string) => {
    try {
      const res = await fetch(`${API_BASE}/info?name=${encodeURIComponent(filename)}`)
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

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '20px', fontFamily: 'system-ui' }}>
      <h1>Audio Projects API</h1>
      <p style={{ color: '#666' }}>Deepgram Backend AI Engineer Interview Project</p>

      {/* Upload Section */}
      <section style={{ background: '#f5f5f5', padding: '20px', borderRadius: '8px', marginBottom: '20px' }}>
        <h2>Upload Audio</h2>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <input
            type="file"
            accept="audio/*"
            onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
          />
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
                    <button onClick={() => handleDownload(file.filename)} style={{ marginRight: '8px' }}>
                      Download
                    </button>
                    <button onClick={() => handleGetInfo(file.filename)}>
                      Get Info
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
            width: '90%'
          }}>
            <h3>File Info: {fileInfo.filename}</h3>
            <p><strong>Duration:</strong> {formatDuration(fileInfo.duration)}</p>
            <p><strong>Size:</strong> {formatSize(fileInfo.size)}</p>
            <p><strong>AI Summary:</strong></p>
            <p style={{ background: '#f5f5f5', padding: '12px', borderRadius: '4px' }}>
              {fileInfo.summary}
            </p>
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
