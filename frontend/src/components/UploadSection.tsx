import { useRef, useState } from 'react'
import { useProvider } from '../contexts'

interface UploadSectionProps {
  onUpload: (file: File) => Promise<void>
  uploading: boolean
  message: string
}

export function UploadSection({
  onUpload,
  uploading,
  message,
}: UploadSectionProps) {
  const { provider, setProvider } = useProvider()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) {
      setSelectedFile(null)
      return
    }

    if (!file.type.startsWith('audio/')) {
      alert('Please select an audio file')
      e.target.value = ''
      setSelectedFile(null)
      return
    }

    setSelectedFile(file)
  }

  const handleSubmit = async () => {
    if (!selectedFile) return

    await onUpload(selectedFile)

    // Reset after upload
    setSelectedFile(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <section style={{ background: '#f5f5f5', padding: '20px', borderRadius: '8px', marginBottom: '20px' }}>
      <h2>Upload Audio</h2>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          onChange={handleFileSelect}
          disabled={uploading}
        />
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as 'local' | 'deepgram')}
          style={{ padding: '8px 12px' }}
          disabled={uploading}
        >
          <option value="local">LocalAI</option>
          <option value="deepgram">Deepgram</option>
        </select>
        <button
          onClick={handleSubmit}
          disabled={!selectedFile || uploading}
          style={{
            padding: '8px 16px',
            cursor: selectedFile && !uploading ? 'pointer' : 'not-allowed',
            opacity: selectedFile && !uploading ? 1 : 0.6,
          }}
        >
          {uploading ? 'Uploading...' : 'Upload'}
        </button>
      </div>
      {selectedFile && !uploading && (
        <p style={{ marginTop: '10px', color: '#666' }}>
          Selected: {selectedFile.name} ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
        </p>
      )}
      {message && (
        <p style={{ marginTop: '10px', color: message.startsWith('Error') ? 'red' : 'green' }}>
          {message}
        </p>
      )}
    </section>
  )
}
