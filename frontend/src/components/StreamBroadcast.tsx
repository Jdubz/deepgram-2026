import { useState, useRef, useCallback, useEffect } from 'react'

type ConnectionStatus = 'disconnected' | 'connecting' | 'authenticating' | 'streaming' | 'error'

interface ServerMessage {
  type: string
  viewerCount?: number
  error?: string
  message?: string
}

export function StreamBroadcast() {
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [error, setError] = useState<string | null>(null)
  const [viewerCount, setViewerCount] = useState(0)
  const [audioSource, setAudioSource] = useState<'system' | 'microphone'>('system')

  const wsRef = useRef<WebSocket | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const workletNodeRef = useRef<AudioWorkletNode | null>(null)
  const isMountedRef = useRef(true)

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      // Inline cleanup to avoid stale closure
      if (wsRef.current) {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'stop' }))
        }
        wsRef.current.close()
        wsRef.current = null
      }
      if (workletNodeRef.current) {
        workletNodeRef.current.disconnect()
        workletNodeRef.current = null
      }
      if (audioContextRef.current) {
        audioContextRef.current.close()
        audioContextRef.current = null
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop())
        mediaStreamRef.current = null
      }
    }
  }, [])

  const getWebSocketUrl = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}/stream/broadcast`
  }, [])

  const stopStreaming = useCallback(() => {
    // Close WebSocket
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'stop' }))
      }
      wsRef.current.close()
      wsRef.current = null
    }

    // Stop audio processing
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect()
      workletNodeRef.current = null
    }

    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }

    // Stop media stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }

    setStatus('disconnected')
  }, [])

  const startStreaming = useCallback(async () => {
    if (!password) {
      setError('Please enter a password')
      return
    }

    setError(null)
    setStatus('connecting')

    try {
      // Connect WebSocket
      const ws = new WebSocket(getWebSocketUrl())
      wsRef.current = ws

      ws.onopen = () => {
        setStatus('authenticating')
        ws.send(JSON.stringify({ type: 'auth', password }))
      }

      ws.onmessage = (event) => {
        if (!isMountedRef.current) return

        const message: ServerMessage = JSON.parse(event.data)

        switch (message.type) {
          case 'auth_success':
            setStatus('streaming')
            startAudioCapture()
            break

          case 'auth_failed':
            setError(message.error || 'Authentication failed')
            setStatus('error')
            ws.close()
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
      }

      ws.onerror = () => {
        if (isMountedRef.current) {
          setError('WebSocket connection error')
          setStatus('error')
        }
      }

      ws.onclose = () => {
        if (isMountedRef.current && wsRef.current === ws) {
          // Only update status if this is still our active connection
          setStatus('disconnected')
          wsRef.current = null
        }
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(`Failed to connect: ${err}`)
        setStatus('error')
      }
    }
  }, [password, getWebSocketUrl])

  const startAudioCapture = useCallback(async () => {
    try {
      let stream: MediaStream

      if (audioSource === 'system') {
        // Capture system audio via screen share
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: 1, height: 1 }, // Minimal video requirement
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        })

        // Check if component was unmounted during async operation
        if (!isMountedRef.current) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        // Check if audio track was included
        const audioTracks = stream.getAudioTracks()
        if (audioTracks.length === 0) {
          throw new Error('No audio track. Please check "Share system audio" in the dialog.')
        }

        // Stop video track - we only need audio
        stream.getVideoTracks().forEach((track) => track.stop())
      } else {
        // Capture microphone
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        })

        // Check if component was unmounted during async operation
        if (!isMountedRef.current) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
      }

      mediaStreamRef.current = stream

      // Create audio context at 16kHz for Deepgram
      const audioContext = new AudioContext({ sampleRate: 16000 })
      audioContextRef.current = audioContext

      // Load audio worklet for processing
      await audioContext.audioWorklet.addModule(createWorkletUrl())

      // Create worklet node
      const workletNode = new AudioWorkletNode(audioContext, 'pcm-processor')
      workletNodeRef.current = workletNode

      // Handle processed audio data
      workletNode.port.onmessage = (event) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          // Send raw PCM data
          wsRef.current.send(event.data)
        }
      }

      // Connect audio source to worklet
      const source = audioContext.createMediaStreamSource(stream)
      source.connect(workletNode)

      // Handle stream ending (user stops screen share)
      stream.getAudioTracks()[0].onended = () => {
        if (isMountedRef.current) {
          stopStreaming()
        }
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(`Audio capture failed: ${err}`)
        stopStreaming()
      }
    }
  }, [audioSource, stopStreaming])

  // Create inline AudioWorklet processor
  function createWorkletUrl(): string {
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
    return URL.createObjectURL(blob)
  }

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

  return (
    <section style={{ marginTop: '20px', padding: '20px', border: '1px solid #ddd', borderRadius: '8px' }}>
      <h2>Stream to Interview</h2>

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
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter streaming password"
              style={{ padding: '8px 12px', width: '250px', borderRadius: '4px', border: '1px solid #ddd' }}
              disabled={status !== 'disconnected' && status !== 'error'}
            />
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>
              Audio Source
            </label>
            <div style={{ display: 'flex', gap: '16px', marginBottom: '8px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="audioSource"
                  value="system"
                  checked={audioSource === 'system'}
                  onChange={() => setAudioSource('system')}
                  disabled={status !== 'disconnected' && status !== 'error'}
                />
                System Audio (Screen Share)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="audioSource"
                  value="microphone"
                  checked={audioSource === 'microphone'}
                  onChange={() => setAudioSource('microphone')}
                  disabled={status !== 'disconnected' && status !== 'error'}
                />
                Microphone
              </label>
            </div>
            {audioSource === 'system' && (
              <div
                style={{
                  padding: '10px 12px',
                  background: '#e3f2fd',
                  borderRadius: '4px',
                  fontSize: '13px',
                  color: '#1565c0',
                  lineHeight: 1.5,
                }}
              >
                <strong>Tips for capturing meeting audio:</strong>
                <ul style={{ margin: '6px 0 0 0', paddingLeft: '18px' }}>
                  <li>Select "Chrome Tab" or "Window" containing your meeting</li>
                  <li>Check "Share audio" or "Share system audio" in the dialog</li>
                  <li>Once streaming starts, you can switch back to your meeting - audio capture continues in background</li>
                  <li>The video portion is not used, only audio</li>
                </ul>
              </div>
            )}
          </div>

          <button
            onClick={startStreaming}
            disabled={status !== 'disconnected' && status !== 'error'}
            style={{
              padding: '10px 20px',
              background: '#1976d2',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: status === 'disconnected' || status === 'error' ? 'pointer' : 'not-allowed',
              opacity: status === 'disconnected' || status === 'error' ? 1 : 0.6,
            }}
          >
            Start Streaming
          </button>
        </div>
      )}

      {/* Stop button when streaming */}
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
            Audio capture is active. You can switch to other tabs or windows - streaming continues in the background.
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
