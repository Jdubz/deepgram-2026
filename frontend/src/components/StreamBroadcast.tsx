import { useState, useRef, useCallback, useEffect } from 'react'
import { useWebSocket } from '../hooks/useWebSocket'

type ConnectionStatus = 'disconnected' | 'connecting' | 'authenticating' | 'streaming' | 'error'

interface ServerMessage {
  type: string
  viewerCount?: number
  error?: string
  message?: string
}

interface AudioDevice {
  deviceId: string
  label: string
}

function isLocalhost(): boolean {
  const hostname = window.location.hostname
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

export function StreamBroadcast() {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [error, setError] = useState<string | null>(null)
  const [viewerCount, setViewerCount] = useState(0)
  const [shouldConnect, setShouldConnect] = useState(false)

  // Audio device selection
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('')
  const [hasPermission, setHasPermission] = useState(false)

  // Audio capture refs
  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const workletNodeRef = useRef<AudioWorkletNode | null>(null)
  const workletUrlRef = useRef<string | null>(null)
  const sendRawRef = useRef<((data: ArrayBuffer) => boolean) | null>(null)
  const stopStreamingRef = useRef<(() => void) | null>(null)

  // Enumerate audio devices
  const enumerateDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const audioInputs = devices
        .filter(d => d.kind === 'audioinput')
        .map(d => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone ${d.deviceId.slice(0, 8)}`,
        }))
      setAudioDevices(audioInputs)

      // Try to find the Interview Combined Audio device
      const interviewDevice = audioInputs.find(d =>
        d.label.toLowerCase().includes('interview combined')
      )

      // Auto-select interview device if found, otherwise use first device
      if (interviewDevice) {
        setSelectedDeviceId(interviewDevice.deviceId)
      } else if (audioInputs.length > 0 && !selectedDeviceId) {
        setSelectedDeviceId(audioInputs[0].deviceId)
      }
    } catch (err) {
      console.error('Failed to enumerate devices:', err)
    }
  }, [selectedDeviceId])

  // Request microphone permission to get device labels
  const requestPermission = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      // Stop the stream immediately - we just needed permission
      stream.getTracks().forEach(track => track.stop())
      setHasPermission(true)
      // Now enumerate devices (labels will be available)
      await enumerateDevices()
    } catch (err) {
      setError('Microphone permission denied')
    }
  }, [enumerateDevices])

  // Initial permission check and device enumeration
  useEffect(() => {
    let permissionStatus: PermissionStatus | null = null

    const handlePermissionChange = () => {
      if (permissionStatus?.state === 'granted') {
        setHasPermission(true)
        enumerateDevices()
      }
    }

    const checkPermission = async () => {
      try {
        permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName })
        if (permissionStatus.state === 'granted') {
          setHasPermission(true)
          enumerateDevices()
        }
        // Listen for permission changes
        permissionStatus.addEventListener('change', handlePermissionChange)
      } catch {
        // permissions API not supported, try enumerating anyway
        enumerateDevices()
      }
    }
    checkPermission()

    // Cleanup listener on unmount
    return () => {
      if (permissionStatus) {
        permissionStatus.removeEventListener('change', handlePermissionChange)
      }
    }
  }, [enumerateDevices])

  // Re-enumerate when devices change
  useEffect(() => {
    const handleDeviceChange = () => {
      if (hasPermission) {
        enumerateDevices()
      }
    }
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange)
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange)
    }
  }, [hasPermission, enumerateDevices])

  const cleanupAudio = useCallback(() => {
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect()
      workletNodeRef.current = null
    }
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    if (workletUrlRef.current) {
      URL.revokeObjectURL(workletUrlRef.current)
      workletUrlRef.current = null
    }
  }, [])

  // Create inline AudioWorklet processor
  const createWorkletUrl = useCallback((): string => {
    const workletCode = `
      class PCMProcessor extends AudioWorkletProcessor {
        constructor() {
          super();
          this.buffer = new Float32Array(0);
        }

        process(inputs, outputs, parameters) {
          const input = inputs[0];
          if (!input || !input[0]) return true;

          const channelData = input[0];

          // Accumulate samples
          const newBuffer = new Float32Array(this.buffer.length + channelData.length);
          newBuffer.set(this.buffer);
          newBuffer.set(channelData, this.buffer.length);
          this.buffer = newBuffer;

          // Send chunks of ~100ms (1600 samples at 16kHz)
          while (this.buffer.length >= 1600) {
            const chunk = this.buffer.slice(0, 1600);
            this.buffer = this.buffer.slice(1600);

            // Convert Float32 to Int16 PCM
            const pcm = new Int16Array(chunk.length);
            for (let i = 0; i < chunk.length; i++) {
              const s = Math.max(-1, Math.min(1, chunk[i]));
              pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }

            this.port.postMessage(pcm.buffer, [pcm.buffer]);
          }

          return true;
        }
      }

      registerProcessor('pcm-processor', PCMProcessor);
    `

    const blob = new Blob([workletCode], { type: 'application/javascript' })
    const url = URL.createObjectURL(blob)
    workletUrlRef.current = url
    return url
  }, [])

  const startAudioCapture = useCallback(async () => {
    if (!selectedDeviceId) {
      setError('Please select an audio device')
      stopStreamingRef.current?.()
      return
    }

    try {
      // Capture from selected device
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: selectedDeviceId },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })
      streamRef.current = stream

      // Create audio context at 16kHz for Deepgram
      const audioContext = new AudioContext({ sampleRate: 16000 })
      audioContextRef.current = audioContext

      // Load audio worklet for processing
      await audioContext.audioWorklet.addModule(createWorkletUrl())

      // Create worklet node for PCM conversion
      const workletNode = new AudioWorkletNode(audioContext, 'pcm-processor')
      workletNodeRef.current = workletNode

      // Handle processed audio data - send to WebSocket
      workletNode.port.onmessage = (event) => {
        sendRawRef.current?.(event.data)
      }

      // Connect: stream -> worklet
      const source = audioContext.createMediaStreamSource(stream)
      source.connect(workletNode)

      // Handle stream ending (user revokes permission)
      stream.getAudioTracks()[0].onended = () => {
        stopStreamingRef.current?.()
      }

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      setError(`Audio capture failed: ${errorMessage}`)
      stopStreamingRef.current?.()
    }
  }, [selectedDeviceId, createWorkletUrl])

  const handleMessage = useCallback((message: ServerMessage) => {
    switch (message.type) {
      case 'auth_success':
        setStatus('streaming')
        startAudioCapture()
        break

      case 'auth_failed':
        setError(message.error || 'Authentication failed')
        setStatus('error')
        setShouldConnect(false)
        break

      case 'status':
        if (message.viewerCount !== undefined) {
          setViewerCount(message.viewerCount)
        }
        break

      case 'error':
        setError(message.message || 'Server error')
        break
    }
  }, [startAudioCapture])

  const handleOpen = useCallback(() => {
    // For localhost, server auto-authenticates. Send auth anyway (server ignores if already authenticated)
    setStatus('authenticating')
    sendRef.current?.({ type: 'auth', password: '' })
  }, [])

  const handleError = useCallback(() => {
    setError('WebSocket connection error')
    setStatus('error')
    setShouldConnect(false)
  }, [])

  const handleClose = useCallback(() => {
    cleanupAudio()
    setStatus('disconnected')
    setShouldConnect(false)
  }, [cleanupAudio])

  const sendRef = useRef<(<T>(message: T) => boolean) | null>(null)

  const { send, sendRaw, disconnect } = useWebSocket<ServerMessage>({
    path: '/stream/broadcast',
    enabled: shouldConnect,
    autoReconnect: false,
    onOpen: handleOpen,
    onMessage: handleMessage,
    onError: handleError,
    onClose: handleClose,
  })

  // Keep send functions in refs for use in callbacks
  sendRef.current = send
  sendRawRef.current = sendRaw

  const startStreaming = useCallback(() => {
    if (!selectedDeviceId) {
      setError('Please select an audio device')
      return
    }

    setError(null)
    setStatus('connecting')
    setShouldConnect(true)
  }, [selectedDeviceId])

  const stopStreaming = useCallback(() => {
    sendRef.current?.({ type: 'stop' })
    cleanupAudio()
    disconnect()
    setStatus('disconnected')
    setShouldConnect(false)
  }, [cleanupAudio, disconnect])

  // Keep stopStreaming in ref for use in async callbacks
  stopStreamingRef.current = stopStreaming

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupAudio()
    }
  }, [cleanupAudio])

  const getStatusDisplay = () => {
    switch (status) {
      case 'disconnected':
        return { text: 'Disconnected', color: '#666' }
      case 'connecting':
        return { text: 'Connecting...', color: '#ff9800' }
      case 'authenticating':
        return { text: 'Authenticating...', color: '#ff9800' }
      case 'streaming':
        return { text: 'Live', color: '#4caf50' }
      case 'error':
        return { text: 'Error', color: '#f44336' }
    }
  }

  const statusDisplay = getStatusDisplay()
  const selectedDevice = audioDevices.find(d => d.deviceId === selectedDeviceId)
  const isInterviewDevice = selectedDevice?.label.toLowerCase().includes('interview combined')

  // Only allow streaming from localhost
  if (!isLocalhost()) {
    return (
      <section style={{ marginTop: '20px', padding: '20px', border: '1px solid #ddd', borderRadius: '8px' }}>
        <h2>Stream Interview Audio</h2>
        <div
          style={{
            padding: '24px',
            textAlign: 'center',
            color: '#666',
            background: '#fafafa',
            borderRadius: '8px',
            border: '1px dashed #ddd',
          }}
        >
          <div style={{ fontSize: '16px', marginBottom: '8px' }}>Only available on localhost</div>
          <div style={{ fontSize: '14px', color: '#999' }}>
            Broadcasting is restricted to local connections for security.
          </div>
        </div>
      </section>
    )
  }

  return (
    <section style={{ marginTop: '20px', padding: '20px', border: '1px solid #ddd', borderRadius: '8px' }}>
      <h2>Stream Interview Audio</h2>

      {/* Status indicator */}
      <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 12px',
            borderRadius: '16px',
            background: statusDisplay.color + '20',
            color: statusDisplay.color,
            fontWeight: 500,
          }}
        >
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: statusDisplay.color,
              animation: status === 'streaming' ? 'pulse 2s infinite' : undefined,
            }}
          />
          {statusDisplay.text}
        </span>
        {status === 'streaming' && (
          <span style={{ color: '#666', fontSize: '14px' }}>
            {viewerCount} viewer{viewerCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div
          style={{
            padding: '12px',
            marginBottom: '16px',
            background: '#ffebee',
            color: '#c62828',
            borderRadius: '4px',
          }}
        >
          {error}
        </div>
      )}

      {/* Controls */}
      {status !== 'streaming' && (
        <div style={{ marginBottom: '16px' }}>
          {/* Permission request */}
          {!hasPermission && (
            <div style={{ marginBottom: '16px' }}>
              <button
                onClick={requestPermission}
                style={{
                  padding: '10px 20px',
                  background: '#ff9800',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Grant Microphone Permission
              </button>
              <p style={{ margin: '8px 0 0 0', fontSize: '13px', color: '#666' }}>
                Permission required to see available audio devices
              </p>
            </div>
          )}

          {/* Audio device selection */}
          {hasPermission && (
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>
                Audio Source
              </label>
              <select
                value={selectedDeviceId}
                onChange={(e) => setSelectedDeviceId(e.target.value)}
                style={{
                  padding: '8px 12px',
                  width: '100%',
                  maxWidth: '400px',
                  borderRadius: '4px',
                  border: '1px solid #ddd',
                  fontSize: '14px',
                }}
                disabled={status !== 'disconnected' && status !== 'error'}
              >
                <option value="">Select audio device...</option>
                {audioDevices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                    {device.label.toLowerCase().includes('interview combined') ? ' (Recommended)' : ''}
                  </option>
                ))}
              </select>

              {/* Device status indicator */}
              {selectedDeviceId && (
                <div
                  style={{
                    marginTop: '8px',
                    padding: '8px 12px',
                    borderRadius: '4px',
                    fontSize: '13px',
                    background: isInterviewDevice ? '#e8f5e9' : '#fff3e0',
                    color: isInterviewDevice ? '#2e7d32' : '#e65100',
                  }}
                >
                  {isInterviewDevice ? (
                    <>
                      <strong>Interview Combined Audio detected</strong> - This device captures both
                      your microphone and system audio (interviewer&apos;s voice).
                    </>
                  ) : (
                    <>
                      <strong>Standard microphone selected</strong> - Only your voice will be captured.
                      For interview transcription, run the setup script first:
                      <code style={{ display: 'block', marginTop: '4px', background: '#fff', padding: '4px 8px', borderRadius: '2px' }}>
                        ./scripts/setup-interview-audio.sh
                      </code>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Instructions */}
          <div
            style={{
              padding: '12px',
              marginBottom: '12px',
              background: '#e3f2fd',
              borderRadius: '4px',
              fontSize: '13px',
              color: '#1565c0',
              lineHeight: 1.6,
            }}
          >
            <strong>Setup (Linux with PipeWire):</strong>
            <ol style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
              <li>Run <code>./scripts/setup-interview-audio.sh</code> in a terminal</li>
              <li>Select &quot;Interview Combined Audio&quot; as the audio source above</li>
              <li>Start your Google Meet/Zoom call normally</li>
              <li>Click &quot;Start Streaming&quot; - both voices will be transcribed</li>
            </ol>
          </div>

          <button
            onClick={startStreaming}
            disabled={(status !== 'disconnected' && status !== 'error') || !selectedDeviceId || !hasPermission}
            style={{
              padding: '10px 20px',
              background: '#1976d2',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: (status === 'disconnected' || status === 'error') && selectedDeviceId && hasPermission ? 'pointer' : 'not-allowed',
              opacity: (status === 'disconnected' || status === 'error') && selectedDeviceId && hasPermission ? 1 : 0.6,
            }}
          >
            Start Streaming
          </button>
        </div>
      )}

      {/* Controls while streaming */}
      {status === 'streaming' && (
        <div style={{ marginBottom: '16px' }}>
          <div
            style={{
              padding: '10px 12px',
              marginBottom: '12px',
              background: '#e8f5e9',
              borderRadius: '4px',
              fontSize: '13px',
              color: '#2e7d32',
            }}
          >
            <strong>Streaming from:</strong> {selectedDevice?.label || 'Unknown device'}
            {isInterviewDevice && ' (mic + system audio combined)'}
          </div>

          <button
            onClick={stopStreaming}
            style={{
              padding: '10px 20px',
              background: '#d32f2f',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Stop Streaming
          </button>
        </div>
      )}

      {/* CSS for pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </section>
  )
}
