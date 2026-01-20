# Real-Time Audio Streaming Implementation Plan

## Overview

Add real-time audio streaming capability to capture system audio (e.g., from Google Meet) and transcribe it live using Deepgram's streaming API with speaker diarization. The architecture supports a single authenticated broadcaster with multiple viewers for live transcription.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           User's Machine                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────┐    PipeWire Monitor     ┌──────────────────────────┐  │
│  │ Google Meet  │ ──────────────────────► │  Browser Audio Capture   │  │
│  │  (or any)    │    (system audio)       │  (via AudioWorklet API)  │  │
│  └──────────────┘                         └───────────┬──────────────┘  │
│                                                       │                  │
│  ┌──────────────┐                                     │ WebSocket        │
│  │ JBL Pebbles  │ ◄──── audio playback               │ (authenticated)  │
│  │  speakers    │                                     │                  │
│  └──────────────┘                                     ▼                  │
│                                           ┌──────────────────────────┐  │
│                                           │  Backend WebSocket Hub   │  │
│                                           │  - Auth for broadcaster  │  │
│                                           │  - Deepgram relay        │  │
│                                           │  - Viewer broadcast      │  │
│                                           └───────────┬──────────────┘  │
│                                                       │                  │
│           ┌───────────────────────────────────────────┼──────────┐      │
│           │                                           │          │      │
│           ▼                                           ▼          ▼      │
│  ┌─────────────────┐                    ┌──────────────────────────┐   │
│  │ Deepgram API    │                    │  Viewer Browsers         │   │
│  │ (WebSocket)     │                    │  (live transcription)    │   │
│  │ - diarize=true  │                    └──────────────────────────┘   │
│  └────────┬────────┘                                                    │
│           │                                                              │
│           ▼                                                              │
│  ┌─────────────────┐                                                    │
│  │ Transcription   │                                                    │
│  │ with speakers   │                                                    │
│  └─────────────────┘                                                    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## System Audio Capture (PipeWire)

### Current System Configuration

Based on system analysis:
- **Audio Server**: PipeWire 1.0.5 with WirePlumber session manager
- **Default Output**: JBL Pebbles (USB speakers)
- **Monitor Source**: `alsa_output.usb-Harman_Multimedia_JBL_Pebbles_1.0.0-00.analog-stereo:monitor_FL/FR`

### Method: Browser getDisplayMedia with Audio

**Recommended approach**: Use `navigator.mediaDevices.getDisplayMedia()` with `audio: true` to capture system audio directly in the browser.

```typescript
// Browser-based system audio capture
const stream = await navigator.mediaDevices.getDisplayMedia({
  video: true,   // Required (can be minimal/hidden)
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    sampleRate: 16000,
  }
});

// Extract audio track only
const audioTrack = stream.getAudioTracks()[0];
```

**Pros**:
- No PipeWire command-line complexity
- Works cross-platform
- User grants explicit permission (security)
- Audio stream directly available in browser

**Cons**:
- Requires screen share permission (can share minimal window)
- Chrome/Edge support better than Firefox
- User must click "Share system audio" checkbox

### Alternative: PipeWire pw-loopback

If browser capture is insufficient, create a virtual microphone from monitor:

```bash
# Create loopback from speakers to virtual mic
pw-loopback \
  --capture-props='media.class=Audio/Sink' \
  --playback-props='media.class=Audio/Source/Virtual' \
  --capture='alsa_output.usb-Harman_Multimedia_JBL_Pebbles_1.0.0-00.analog-stereo' \
  --name='Interview-Capture'
```

This creates a virtual source that can be selected as microphone input.

---

## WebSocket Architecture

### Server Endpoints

| Endpoint | Purpose | Authentication |
|----------|---------|----------------|
| `ws://localhost:3001/stream/broadcast` | Broadcaster sends audio | Password required |
| `ws://localhost:3001/stream/watch` | Viewers receive transcription | Public (read-only) |

### Message Protocol

#### Broadcaster → Server
```typescript
// Authentication (first message)
{ type: 'auth', password: string }

// Audio data (after auth)
{ type: 'audio', data: ArrayBuffer }  // 16-bit PCM, 16kHz

// Control
{ type: 'stop' }
```

#### Server → Broadcaster
```typescript
{ type: 'auth_success' }
{ type: 'auth_failed', error: string }
{ type: 'transcript', data: TranscriptMessage }
{ type: 'error', message: string }
```

#### Server → Viewers (broadcast)
```typescript
{
  type: 'transcript',
  speaker: number,           // Speaker ID from diarization
  text: string,              // Transcript segment
  confidence: number,
  isFinal: boolean,
  timestamp: number
}

{ type: 'session_started' }
{ type: 'session_ended' }
{ type: 'status', isLive: boolean, viewerCount: number }
```

---

## Deepgram WebSocket Integration

### Streaming API Parameters

```typescript
const DEEPGRAM_WS_URL = 'wss://api.deepgram.com/v1/listen';

const params = new URLSearchParams({
  model: 'nova-2',
  language: 'en',
  punctuate: 'true',
  diarize: 'true',           // Speaker identification
  interim_results: 'true',    // Get partial results
  endpointing: '300',         // Silence detection (ms)
  encoding: 'linear16',       // Raw PCM
  sample_rate: '16000',
  channels: '1',
});
```

### Deepgram Response Format (with diarization)

```typescript
interface DeepgramStreamingResponse {
  type: 'Results';
  channel_index: [number, number];
  duration: number;
  start: number;
  is_final: boolean;
  speech_final: boolean;
  channel: {
    alternatives: [{
      transcript: string;
      confidence: number;
      words: [{
        word: string;
        start: number;
        end: number;
        confidence: number;
        speaker: number;          // Speaker ID (0, 1, 2, ...)
        speaker_confidence: number;
      }];
    }];
  };
}
```

---

## Implementation Steps

### Phase 1: Backend WebSocket Hub

**New files:**
- `backend/src/services/stream-hub.ts` - WebSocket connection manager
- `backend/src/services/deepgram-stream.ts` - Deepgram WebSocket client
- `backend/src/routes/stream.ts` - WebSocket route handlers

**Dependencies to add:**
```json
{
  "ws": "^8.16.0",
  "@types/ws": "^8.5.10"
}
```

**Key implementation:**

```typescript
// stream-hub.ts
class StreamHub {
  private broadcaster: WebSocket | null = null;
  private viewers: Set<WebSocket> = new Set();
  private deepgramStream: DeepgramStream | null = null;
  private broadcastPassword: string;

  constructor() {
    this.broadcastPassword = process.env.STREAM_PASSWORD || 'interview2026';
  }

  handleBroadcaster(ws: WebSocket) {
    // Authenticate, then relay audio to Deepgram
    // Forward transcripts back to broadcaster and all viewers
  }

  handleViewer(ws: WebSocket) {
    // Add to viewers set, receive transcript broadcasts
    // No authentication required
  }

  broadcastTranscript(data: TranscriptMessage) {
    const message = JSON.stringify(data);
    this.viewers.forEach(viewer => viewer.send(message));
    this.broadcaster?.send(message);
  }
}
```

### Phase 2: Frontend Streaming Components

**New files:**
- `frontend/src/components/StreamBroadcast.tsx` - Broadcaster UI
- `frontend/src/components/StreamViewer.tsx` - Viewer UI
- `frontend/src/components/TranscriptDisplay.tsx` - Live transcript with speaker colors

**Audio processing in browser:**

```typescript
// AudioWorklet for real-time processing
class AudioProcessor extends AudioWorkletProcessor {
  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    const input = inputs[0][0];
    if (input) {
      // Convert Float32 to Int16 PCM
      const pcm = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        pcm[i] = Math.max(-32768, Math.min(32767, input[i] * 32768));
      }
      this.port.postMessage(pcm.buffer);
    }
    return true;
  }
}
```

### Phase 3: UI/UX Design

**Broadcaster View:**
```
┌─────────────────────────────────────────────────┐
│  🎙️ Stream to Interview                         │
├─────────────────────────────────────────────────┤
│                                                 │
│  Password: [••••••••••]  [Start Streaming]      │
│                                                 │
│  ┌──── Audio Source ────┐                       │
│  │ ○ Microphone         │                       │
│  │ ● System Audio       │  [Capture Screen]     │
│  └──────────────────────┘                       │
│                                                 │
│  Status: 🟢 Live | Viewers: 3                   │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │ Live Transcript                          │   │
│  │                                          │   │
│  │ [Speaker 0] Hello, thank you for...     │   │
│  │ [Speaker 1] Thanks for having me...     │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  [Stop Streaming]                               │
└─────────────────────────────────────────────────┘
```

**Viewer View:**
```
┌─────────────────────────────────────────────────┐
│  📺 Live Interview Transcription                │
├─────────────────────────────────────────────────┤
│                                                 │
│  Status: 🟢 Live                                │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │                                          │   │
│  │ [Interviewer] Can you tell us about     │   │
│  │ your experience with distributed        │   │
│  │ systems?                                 │   │
│  │                                          │   │
│  │ [Candidate] Yes, I've worked on...      │   │
│  │ ▋ (typing indicator for interim)        │   │
│  │                                          │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  Auto-scroll: [✓]                               │
└─────────────────────────────────────────────────┘
```

---

## Security Model

### Authentication Flow

1. **Broadcaster connects** to `/stream/broadcast`
2. **First message must be auth**: `{ type: 'auth', password: '...' }`
3. **Server validates** against `STREAM_PASSWORD` env var
4. **Success**: Connection upgraded, audio relay begins
5. **Failure**: Connection closed with error

### Security Measures

| Risk | Mitigation |
|------|------------|
| Unauthorized streaming | Password required for broadcaster |
| Password brute force | Rate limiting (5 attempts/minute) |
| Resource exhaustion | Single broadcaster limit, viewer cap (50) |
| Data interception | HTTPS/WSS via Cloudflare tunnel |
| API key exposure | Server-side Deepgram connection only |

---

## Environment Variables

Add to `.env`:
```bash
# Real-time streaming
STREAM_PASSWORD=your-secure-password-here
STREAM_MAX_VIEWERS=50
DEEPGRAM_STREAMING_TIMEOUT_MS=30000
```

---

## File Changes Summary

### New Files

| File | Purpose |
|------|---------|
| `backend/src/services/stream-hub.ts` | WebSocket connection manager |
| `backend/src/services/deepgram-stream.ts` | Deepgram WebSocket client |
| `backend/src/routes/stream.ts` | WebSocket upgrade handlers |
| `frontend/src/components/StreamBroadcast.tsx` | Broadcaster UI |
| `frontend/src/components/StreamViewer.tsx` | Viewer UI |
| `frontend/src/components/TranscriptDisplay.tsx` | Live transcript renderer |
| `frontend/src/audio/capture-worklet.ts` | Audio processing worklet |

### Modified Files

| File | Changes |
|------|---------|
| `backend/src/index.ts` | Add WebSocket server, mount stream routes |
| `backend/package.json` | Add `ws` dependency |
| `frontend/src/App.tsx` | Add streaming tab/navigation |
| `frontend/vite.config.ts` | Add WebSocket proxy config |

---

## Testing Plan

### Manual Testing Checklist

- [ ] Broadcaster can authenticate with correct password
- [ ] Broadcaster rejected with wrong password
- [ ] System audio capture works via getDisplayMedia
- [ ] Audio streams to Deepgram and returns transcripts
- [ ] Speaker diarization correctly identifies speakers
- [ ] Viewers receive real-time transcript updates
- [ ] Multiple viewers can connect simultaneously
- [ ] Viewer count updates correctly
- [ ] Session end broadcasts to all viewers
- [ ] Graceful reconnection on network issues

### Integration Test Scenarios

1. **Happy path**: Broadcaster streams, viewer watches, both receive transcripts
2. **Auth failure**: Wrong password rejected, connection closed
3. **Broadcaster disconnect**: Viewers notified, session ended
4. **Network interruption**: Reconnection attempted, stream resumes
5. **Long-running session**: Memory stable over 60+ minute stream

---

## Implementation Order

1. **Backend WebSocket infrastructure** (stream-hub.ts, index.ts modifications)
2. **Deepgram streaming client** (deepgram-stream.ts)
3. **Frontend broadcaster** (StreamBroadcast.tsx, audio worklet)
4. **Frontend viewer** (StreamViewer.tsx, TranscriptDisplay.tsx)
5. **Integration and testing**
6. **Security hardening** (rate limiting, error handling)

---

## Estimated Dependencies

### Backend
```bash
cd backend
npm install ws
npm install -D @types/ws
```

### Frontend
No additional dependencies (uses native Web APIs)

---

## Notes

- Deepgram Nova-2 model supports up to 2 hours of streaming per connection
- Diarization works best with clear audio and speaker turns
- Consider adding transcript persistence to SQLite for review
- Future enhancement: Export transcript as SRT/VTT subtitles
