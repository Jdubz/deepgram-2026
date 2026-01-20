import { useRef, useState } from 'react'

interface RecordSectionProps {
  provider: 'local' | 'deepgram'
  onProviderChange: (provider: 'local' | 'deepgram') => void
  onUploadSuccess: () => void
}

export function RecordSection({
  provider,
  onProviderChange,
  onUploadSuccess,
}: RecordSectionProps) {
  const [isRecording, setIsRecording] = useState(false)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [recordingName, setRecordingName] = useState('')
  const [duration, setDuration] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState('')

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      chunksRef.current = []

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data)
        }
      }

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        setAudioBlob(blob)
        setAudioUrl(URL.createObjectURL(blob))

        // Stop all tracks
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop())
        }
      }

      mediaRecorder.start()
      setIsRecording(true)
      setDuration(0)
      setMessage('')

      // Start timer
      timerRef.current = window.setInterval(() => {
        setDuration((d) => d + 1)
      }, 1000)
    } catch (err) {
      setMessage(`Error: Could not access microphone. ${err}`)
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)

      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }

  const clearRecording = () => {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl)
    }
    setAudioBlob(null)
    setAudioUrl(null)
    setDuration(0)
    setMessage('')
  }

  const handleUpload = async () => {
    if (!audioBlob) return

    setUploading(true)
    setMessage('')

    try {
      const filename = recordingName.trim() || `recording-${Date.now()}`
      const file = new File([audioBlob], `${filename}.webm`, { type: 'audio/webm' })

      const formData = new FormData()
      formData.append('file', file)
      formData.append('title', filename)
      formData.append('provider', provider)

      const res = await fetch('/api/files', {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()

      if (res.ok) {
        setMessage(`Uploaded: ${data.filename} (${data.provider})`)
        clearRecording()
        setRecordingName('')
        onUploadSuccess()
      } else {
        setMessage(`Error: ${data.error}`)
      }
    } catch (err) {
      setMessage(`Upload failed: ${err}`)
    } finally {
      setUploading(false)
    }
  }

  return (
    <section style={{ background: '#f5f5f5', padding: '20px', borderRadius: '8px', marginBottom: '20px' }}>
      <h2>Record Audio</h2>

      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Recording name (optional)"
          value={recordingName}
          onChange={(e) => setRecordingName(e.target.value)}
          disabled={isRecording || uploading}
          style={{ padding: '8px 12px', minWidth: '200px' }}
        />

        {!isRecording && !audioBlob && (
          <button
            onClick={startRecording}
            disabled={uploading}
            style={{
              padding: '8px 16px',
              cursor: uploading ? 'not-allowed' : 'pointer',
              opacity: uploading ? 0.6 : 1,
              background: '#d32f2f',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
            }}
          >
            Start Recording
          </button>
        )}

        {isRecording && (
          <>
            <button
              onClick={stopRecording}
              style={{
                padding: '8px 16px',
                cursor: 'pointer',
                background: '#1976d2',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
              }}
            >
              Stop Recording
            </button>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                fontFamily: 'monospace',
                fontSize: '16px',
              }}
            >
              <span
                style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  background: '#d32f2f',
                  animation: 'pulse 1s infinite',
                }}
              />
              {formatDuration(duration)}
            </span>
          </>
        )}
      </div>

      {audioBlob && audioUrl && (
        <div style={{ marginTop: '16px' }}>
          <audio controls src={audioUrl} style={{ width: '100%', marginBottom: '12px' }} />

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={provider}
              onChange={(e) => onProviderChange(e.target.value as 'local' | 'deepgram')}
              style={{ padding: '8px 12px' }}
              disabled={uploading}
            >
              <option value="local">LocalAI</option>
              <option value="deepgram">Deepgram</option>
            </select>

            <button
              onClick={handleUpload}
              disabled={uploading}
              style={{
                padding: '8px 16px',
                cursor: uploading ? 'not-allowed' : 'pointer',
                opacity: uploading ? 0.6 : 1,
              }}
            >
              {uploading ? 'Uploading...' : 'Upload Recording'}
            </button>

            <button
              onClick={clearRecording}
              disabled={uploading}
              style={{
                padding: '8px 16px',
                cursor: uploading ? 'not-allowed' : 'pointer',
                opacity: uploading ? 0.6 : 1,
                background: '#666',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
              }}
            >
              Clear
            </button>

            <span style={{ color: '#666', fontFamily: 'monospace' }}>
              Duration: {formatDuration(duration)}
            </span>
          </div>
        </div>
      )}

      {message && (
        <p style={{ marginTop: '10px', color: message.startsWith('Error') ? 'red' : 'green' }}>
          {message}
        </p>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </section>
  )
}
