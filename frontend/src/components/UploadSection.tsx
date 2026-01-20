import { useRef } from 'react'

interface UploadSectionProps {
  provider: 'local' | 'deepgram'
  onProviderChange: (provider: 'local' | 'deepgram') => void
  onUpload: (file: File) => Promise<void>
  uploading: boolean
  message: string
}

export function UploadSection({
  provider,
  onProviderChange,
  onUpload,
  uploading,
  message,
}: UploadSectionProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('audio/')) {
      alert('Please select an audio file')
      e.target.value = ''
      return
    }

    await onUpload(file)

    // Reset input after upload
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
          onChange={(e) => onProviderChange(e.target.value as 'local' | 'deepgram')}
          style={{ padding: '8px 12px' }}
          disabled={uploading}
        >
          <option value="local">LocalAI</option>
          <option value="deepgram">Deepgram</option>
        </select>
        {uploading && <span style={{ color: '#666' }}>Uploading...</span>}
      </div>
      {message && (
        <p style={{ marginTop: '10px', color: message.startsWith('Error') ? 'red' : 'green' }}>
          {message}
        </p>
      )}
    </section>
  )
}
