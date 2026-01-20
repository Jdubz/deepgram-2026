# REVISED Implementation Plan: 3 High-Impact Features (1 Day)

## What's Already Implemented ✅

After reviewing the backend code, here's what's **already done**:

1. **Deepgram Provider** - Fully implemented in `backend/src/services/deepgram.ts`
   - Transcription via `/v1/listen` API
   - Summarization via `/v1/read` API (Text Intelligence)
   - Health check
   - Already extracts confidence from response (line 98)

2. **Provider Factory** - Implemented in `backend/src/services/provider-factory.ts`
   - `getProvider(name)` - Get provider by name
   - `getDefaultProvider()` - Get default from env
   - `isProviderAvailable(name)` - Health check wrapper
   - `getProvidersHealth()` - Check all providers

3. **Job Processor** - Already uses provider factory
   - Line 198: `const provider = getProvider(job.provider)`
   - Routes jobs to correct provider based on `job.provider` field

4. **Database Schema** - Already supports providers
   - `jobs` table has `provider` column (CHECK 'local' or 'deepgram')
   - Provider selection already persisted

## What's Missing ❌

1. **Confidence Scores**
   - Deepgram extracts confidence but doesn't return it
   - LocalAI doesn't return confidence
   - No database columns for confidence
   - No API exposure or filtering

2. **Health Check for Deepgram**
   - `/health` endpoint only checks LocalAI
   - Doesn't show Deepgram status

3. **Streaming Transcription**
   - No WebSocket implementation
   - No real-time transcription endpoint

---

## REVISED Phase 1: Confidence Scores (2-3 hours)

### Goal
Complete the confidence implementation that's partially done.

### Changes Required

#### 1. Database Migration ✏️
**File**: `backend/src/db/migrations/003_add_confidence.sql` (NEW)

```sql
-- Migration 003: Add confidence scores
ALTER TABLE jobs ADD COLUMN confidence REAL DEFAULT NULL;
ALTER TABLE audio_submissions ADD COLUMN transcript_confidence REAL DEFAULT NULL;
ALTER TABLE audio_submissions ADD COLUMN summary_confidence REAL DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_submissions_confidence
  ON audio_submissions(transcript_confidence)
  WHERE transcript_confidence IS NOT NULL;
```

#### 2. Type Definitions ✏️
**File**: `backend/src/types/index.ts`

Add `confidence` field to interfaces:
- Line 16-21: `TranscriptionResult` - add `confidence: number;`
- Line 26-32: `SummarizationResult` - add `confidence?: number;`
- Line 92-108: `AudioInfoResponse` - add `transcriptConfidence` and `summaryConfidence`

#### 3. Deepgram Service ✏️
**File**: `backend/src/services/deepgram.ts`

**Current**: Line 115-120 returns `{ text, model, processingTimeMs, rawResponse }`
**Fix**: Add confidence to return value

```typescript
// Line 109: Already extracts confidence
const confidence = dgResponse.results?.channels?.[0]?.alternatives?.[0]?.confidence || 0;

// Line 115-121: Update return statement
return {
  text: transcript,
  confidence, // ADD THIS
  model: modelName,
  processingTimeMs: Date.now() - startTime,
  rawResponse,
};
```

#### 4. LocalAI Service ✏️
**File**: `backend/src/services/localai.ts`

Add confidence to return values (LocalAI doesn't provide it, so estimate):

```typescript
// Line ~100: Update transcribe return
return {
  text: result.text || "",
  confidence: 0.85, // ADD THIS - reasonable default
  model: this.config.whisperModel,
  processingTimeMs: Date.now() - startTime,
};

// Line ~156: Update summarize return
return {
  text: result.choices?.[0]?.message?.content || "",
  confidence: 0.8, // ADD THIS - optional for summaries
  model: this.config.llmModel,
  tokensUsed: result.usage?.total_tokens || 0,
  processingTimeMs: Date.now() - startTime,
};
```

#### 5. Inference Queue ✏️
**File**: `backend/src/services/inference-queue.ts`

Update `completeJob()` method to accept and store confidence:

```typescript
// Line 408-437: Update completeJob signature
completeJob(
  jobId: number,
  outputText: string,
  modelUsed: string,
  processingTimeMs: number,
  confidence?: number, // ADD THIS parameter
  rawResponse?: unknown
): void {
  const db = this.getDb();

  const stmt = db.prepare(`
    UPDATE jobs
    SET status = 'completed',
        output_text = ?,
        model_used = ?,
        processing_time_ms = ?,
        confidence = ?, // ADD THIS
        raw_response = ?,
        raw_response_type = ?,
        completed_at = datetime('now')
    WHERE id = ?
  `);

  stmt.run(
    outputText,
    modelUsed,
    processingTimeMs,
    confidence || null, // ADD THIS
    rawResponse ? JSON.stringify(rawResponse) : null,
    rawResponse ? typeof rawResponse : null,
    jobId
  );
}

// Also update updateSubmissionTranscript and updateSubmissionSummary
// to store confidence in audio_submissions table
```

#### 6. Job Processor ✏️
**File**: `backend/src/services/job-processor.ts`

Update calls to `completeJob()` to pass confidence:

```typescript
// Line 227-233: processTranscribeJob - Add confidence
inferenceQueue.completeJob(
  job.id,
  result.text,
  result.model,
  result.processingTimeMs,
  result.confidence, // ADD THIS
  result.rawResponse
);

// Line 244-250: processSummarizeJob - Add confidence
inferenceQueue.completeJob(
  job.id,
  result.text,
  result.model,
  result.processingTimeMs,
  result.confidence, // ADD THIS (optional)
  result.rawResponse
);
```

#### 7. API Routes ✏️
**File**: `backend/src/routes/audio.ts`

Add confidence filtering and exposure:

```typescript
// Line 146-184: GET /list - Add min_confidence filter
const query = {
  maxduration: req.query.maxduration ? Number(req.query.maxduration) : undefined,
  minduration: req.query.minduration ? Number(req.query.minduration) : undefined,
  min_confidence: req.query.min_confidence ? Number(req.query.min_confidence) : undefined, // ADD
  limit: req.query.limit ? Number(req.query.limit) : 100,
  offset: req.query.offset ? Number(req.query.offset) : 0,
};

// Apply confidence filter
if (query.min_confidence !== undefined) {
  submissions = submissions.filter(s =>
    s.transcript_confidence && s.transcript_confidence >= query.min_confidence!
  );
}

// Line 285-298: GET /info - Add confidence to response
const response: AudioInfoResponse = {
  filename: submission.original_filename || submission.filename,
  duration: submission.duration_seconds || 0,
  size: submission.file_size || 0,
  summary: submission.summary || "",
  transcript: submission.transcript || "",
  transcriptConfidence: submission.transcript_confidence, // ADD
  summaryConfidence: submission.summary_confidence, // ADD
};
```

### Testing Plan
```bash
# Test 1: Upload with Deepgram provider
curl -X POST -F "file=@test.wav" -F "provider=deepgram" http://localhost:3001/files
# Verify confidence is stored in database

# Test 2: Upload with Local provider
curl -X POST -F "file=@test.wav" -F "provider=local" http://localhost:3001/files
# Verify default confidence (0.85) is stored

# Test 3: Filter by confidence
curl "http://localhost:3001/list?min_confidence=0.9"
# Verify only high-confidence results returned

# Test 4: Check confidence in info endpoint
curl "http://localhost:3001/info?id=<submission_id>"
# Verify transcriptConfidence and summaryConfidence in response

# Test 5: Check database directly
sqlite3 backend/data/deepgram.db "SELECT confidence FROM jobs WHERE id = 1;"
```

### Files Changed
- **New**: 1 file (migration)
- **Modified**: 6 files
- **Lines**: ~50 lines added/modified

---

## REVISED Phase 2: Provider Documentation (30 minutes - 1 hour)

### Goal
Document provider selection. Deepgram is already working, just needs clear documentation!

### Changes Required

#### 1. Update Health Endpoint to Show Provider Configuration ✏️
**File**: `backend/src/index.ts`

```typescript
// Line 30-46: Update /health endpoint to show provider availability
import { deepgram } from "./services/deepgram.js";

app.get("/health", async (_req, res) => {
  const localAIHealthy = await localAI.healthCheck();
  const processorStatus = jobProcessor.getStatus();

  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    services: {
      localAI: {
        healthy: localAIHealthy,
        config: localAI.getConfig(),
      },
      deepgram: {
        configured: !!process.env.DEEPGRAM_API_KEY, // Just check if key exists
        config: deepgram.getConfig(), // Returns config without API key
      },
      jobProcessor: processorStatus,
    },
  });
});
```

**Note**: We just check if `DEEPGRAM_API_KEY` is set, not calling their API. If key is set, assume it works until a job fails.

#### 2. Document Provider Selection ✏️
**File**: `README.md`

Add section:

```markdown
## Provider Selection

The API supports multiple AI providers for transcription and summarization:

### Available Providers
- **local**: LocalAI (Whisper + Llama) - Default, runs locally
- **deepgram**: Deepgram API - Requires API key, cloud-based

### Usage

```bash
# Use Deepgram (requires DEEPGRAM_API_KEY)
curl -X POST -F "file=@audio.wav" -F "provider=deepgram" http://localhost:3001/files

# Use LocalAI (default)
curl -X POST -F "file=@audio.wav" http://localhost:3001/files
# OR explicitly:
curl -X POST -F "file=@audio.wav" -F "provider=local" http://localhost:3001/files
```

### Configuration

Set environment variables:
```bash
# Optional: Use Deepgram for higher accuracy
export DEEPGRAM_API_KEY=your_api_key_here
export DEEPGRAM_MODEL=nova-2  # or nova-3

# Optional: Set default provider
export DEFAULT_PROVIDER=deepgram  # or local
```

### Health Check

Check provider status:
```bash
curl http://localhost:3001/health
```

Response shows which providers are available:
```json
{
  "services": {
    "providers": {
      "local": { "healthy": true },
      "deepgram": { "healthy": true }
    }
  }
}
```
```

#### 3. Environment Variables ✏️
**File**: `backend/.env.example`

```bash
# Server
PORT=3001

# LocalAI Configuration
LOCALAI_URL=http://localhost:8080
LOCALAI_WHISPER_MODEL=whisper-1
LOCALAI_LLM_MODEL=llama3

# Deepgram Configuration (Optional)
DEEPGRAM_API_KEY=your_api_key_here
DEEPGRAM_MODEL=nova-2
DEEPGRAM_LANGUAGE=en

# Default Provider (local or deepgram)
DEFAULT_PROVIDER=local
```

### Testing Plan
```bash
# Test 1: Health check shows provider configuration
curl http://localhost:3001/health | jq '.services'
# Should show: deepgram.configured: true/false

# Test 2: Upload with Deepgram
curl -X POST -F "file=@test.wav" -F "provider=deepgram" http://localhost:3001/files
# If no API key: should fail gracefully with error message

# Test 3: Upload with LocalAI (default)
curl -X POST -F "file=@test.wav" http://localhost:3001/files

# Test 4: Check queue shows provider used
curl http://localhost:3001/submissions/<id> | jq '.jobs[].provider'

# Test 5: Verify error message when Deepgram key missing
unset DEEPGRAM_API_KEY
curl -X POST -F "file=@test.wav" -F "provider=deepgram" http://localhost:3001/files
# Should return clear error: "Deepgram API key not configured"
```

### Files Changed
- **Modified**: 3 files (index.ts, README.md, .env.example)
- **Lines**: ~100 lines documentation, ~10 lines code
- **Time**: 30min - 1 hour (mostly documentation)

---

## REVISED Phase 3: Real-Time Streaming Transcription (4-5 hours)

### Goal
WebSocket endpoint for streaming audio → real-time transcription using Deepgram's live API.

### Changes Required

#### 1. Install Dependencies ✏️
**File**: `backend/package.json`

```bash
npm install ws @types/ws @deepgram/sdk
```

Note: `@deepgram/sdk` already installed for Phase 2

#### 2. Streaming Route ✏️
**File**: `backend/src/routes/streaming.ts` (NEW)

```typescript
/**
 * Real-Time Streaming Transcription
 *
 * WebSocket endpoint for live audio transcription.
 * Supports Deepgram's live transcription API.
 */

import { WebSocket } from "ws";
import { deepgram } from "../services/deepgram.js";
import { Provider } from "../types/index.js";

export interface StreamConfig {
  provider?: Provider;
  language?: string;
  model?: string;
  interim_results?: boolean;
}

export interface StreamMessage {
  type: "config" | "audio" | "close";
  data?: unknown;
}

export interface TranscriptMessage {
  type: "transcript" | "error" | "metadata";
  text?: string;
  is_final?: boolean;
  confidence?: number;
  words?: unknown[];
  error?: string;
}

export function handleStreamingConnection(ws: WebSocket) {
  let deepgramLive: any = null;
  let config: StreamConfig = {
    provider: Provider.DEEPGRAM,
    language: "en",
    interim_results: true,
  };

  console.log("[Streaming] New WebSocket connection");

  ws.on("message", async (data: Buffer) => {
    try {
      // Try to parse as JSON (config/control message)
      const message = JSON.parse(data.toString()) as StreamMessage;

      if (message.type === "config") {
        // Configuration message
        config = { ...config, ...message.data } as StreamConfig;
        console.log("[Streaming] Config updated:", config);

        // Initialize Deepgram live connection
        if (config.provider === Provider.DEEPGRAM) {
          await initializeDeepgramLive(ws, config);
        } else {
          ws.send(JSON.stringify({
            type: "error",
            error: "Only Deepgram provider supports streaming",
          }));
        }
        return;
      }

      if (message.type === "close") {
        // Client requesting close
        if (deepgramLive) {
          deepgramLive.finish();
        }
        ws.close();
        return;
      }
    } catch {
      // Not JSON - treat as raw audio data
      if (deepgramLive && data.length > 0) {
        deepgramLive.send(data);
      }
    }
  });

  ws.on("close", () => {
    console.log("[Streaming] WebSocket closed");
    if (deepgramLive) {
      deepgramLive.finish();
    }
  });

  ws.on("error", (error) => {
    console.error("[Streaming] WebSocket error:", error);
    if (deepgramLive) {
      deepgramLive.finish();
    }
  });

  async function initializeDeepgramLive(ws: WebSocket, config: StreamConfig) {
    const dgClient = deepgram.getClient(); // Need to add this method

    deepgramLive = dgClient.listen.live({
      model: config.model || "nova-2",
      language: config.language || "en",
      punctuate: true,
      interim_results: config.interim_results !== false,
      smart_format: true,
    });

    // Handle transcription results
    deepgramLive.on("transcript", (data: any) => {
      const channel = data.channel;
      const alternative = channel?.alternatives?.[0];

      if (!alternative) return;

      const message: TranscriptMessage = {
        type: "transcript",
        text: alternative.transcript,
        is_final: data.is_final || false,
        confidence: alternative.confidence,
        words: alternative.words,
      };

      ws.send(JSON.stringify(message));
    });

    // Handle metadata
    deepgramLive.on("metadata", (data: any) => {
      ws.send(JSON.stringify({
        type: "metadata",
        data,
      }));
    });

    // Handle errors
    deepgramLive.on("error", (error: any) => {
      console.error("[Streaming] Deepgram error:", error);
      ws.send(JSON.stringify({
        type: "error",
        error: error.message || "Transcription error",
      }));
    });

    // Handle connection close
    deepgramLive.on("close", () => {
      console.log("[Streaming] Deepgram connection closed");
    });

    console.log("[Streaming] Deepgram live connection initialized");
  }
}
```

#### 3. Update Server to Handle WebSocket ✏️
**File**: `backend/src/index.ts`

```typescript
import { WebSocketServer } from "ws";
import { handleStreamingConnection } from "./routes/streaming.js";

// After line 73 (after server creation):

// WebSocket server for streaming transcription
const wss = new WebSocketServer({ server, path: "/stream" });

wss.on("connection", (ws) => {
  handleStreamingConnection(ws);
});

console.log("WebSocket server ready at ws://localhost:${PORT}/stream");
```

#### 4. Update Deepgram Service ✏️
**File**: `backend/src/services/deepgram.ts`

Add method to expose client:

```typescript
// Add after line 237
/**
 * Get Deepgram client for streaming (live transcription)
 */
getClient() {
  if (!this.config.apiKey) {
    throw new Error("Deepgram API key not configured");
  }

  // Note: May need to use @deepgram/sdk's createClient
  // This is a simplified example
  return {
    listen: {
      live: (options: any) => {
        // Return live transcription connection
        // Implementation depends on @deepgram/sdk version
      }
    }
  };
}
```

#### 5. Test Client ✏️
**File**: `scripts/test-streaming.js` (NEW)

```javascript
#!/usr/bin/env node

/**
 * WebSocket Streaming Test Client
 *
 * Tests real-time transcription by streaming an audio file.
 */

const WebSocket = require('ws');
const fs = require('fs');

const AUDIO_FILE = process.argv[2] || './test.wav';
const WS_URL = 'ws://localhost:3001/stream';

if (!fs.existsSync(AUDIO_FILE)) {
  console.error(`Audio file not found: ${AUDIO_FILE}`);
  process.exit(1);
}

console.log(`Connecting to ${WS_URL}...`);
const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log('Connected! Sending config...');

  // Send configuration
  ws.send(JSON.stringify({
    type: 'config',
    data: {
      provider: 'deepgram',
      language: 'en',
      model: 'nova-2',
      interim_results: true,
    }
  }));

  // Wait a bit for config to be processed
  setTimeout(() => {
    console.log(`Streaming audio file: ${AUDIO_FILE}`);
    streamAudioFile(ws, AUDIO_FILE);
  }, 500);
});

ws.on('message', (data) => {
  const message = JSON.parse(data.toString());

  if (message.type === 'transcript') {
    const prefix = message.is_final ? '[FINAL]' : '[INTERIM]';
    const confidence = message.confidence ? ` (${(message.confidence * 100).toFixed(1)}%)` : '';
    console.log(`${prefix}${confidence}: ${message.text}`);
  } else if (message.type === 'error') {
    console.error(`Error: ${message.error}`);
  } else if (message.type === 'metadata') {
    console.log('Metadata:', message.data);
  }
});

ws.on('close', () => {
  console.log('Connection closed');
});

ws.on('error', (error) => {
  console.error('WebSocket error:', error);
});

function streamAudioFile(ws, filePath) {
  const CHUNK_SIZE = 4096; // Send 4KB at a time
  const CHUNK_INTERVAL = 100; // ms between chunks (simulates real-time)

  const audioData = fs.readFileSync(filePath);
  let offset = 0;

  const interval = setInterval(() => {
    if (offset >= audioData.length) {
      clearInterval(interval);
      console.log('Finished streaming audio');

      // Close connection after a delay to get final results
      setTimeout(() => {
        ws.send(JSON.stringify({ type: 'close' }));
      }, 2000);
      return;
    }

    const chunk = audioData.slice(offset, offset + CHUNK_SIZE);
    ws.send(chunk);
    offset += CHUNK_SIZE;
  }, CHUNK_INTERVAL);
}
```

Make executable:
```bash
chmod +x scripts/test-streaming.js
```

#### 6. Documentation ✏️
**File**: `README.md`

Add section:

```markdown
## Real-Time Streaming Transcription

WebSocket endpoint for live audio transcription.

### Usage

```javascript
const ws = new WebSocket('ws://localhost:3001/stream');

// 1. Send configuration
ws.send(JSON.stringify({
  type: 'config',
  data: {
    provider: 'deepgram',
    language: 'en',
    interim_results: true
  }
}));

// 2. Stream audio chunks (raw binary)
ws.send(audioChunkBuffer);

// 3. Receive transcription results
ws.on('message', (data) => {
  const message = JSON.parse(data);
  if (message.type === 'transcript') {
    console.log(message.text, message.is_final);
  }
});
```

### Test Script

```bash
node scripts/test-streaming.js path/to/audio.wav
```

### Message Protocol

**Client → Server:**
- Config: `{ type: "config", data: { provider, language, model } }`
- Audio: Raw binary data (PCM, WAV, etc.)
- Close: `{ type: "close" }`

**Server → Client:**
- Transcript: `{ type: "transcript", text, is_final, confidence, words }`
- Error: `{ type: "error", error }`
- Metadata: `{ type: "metadata", data }`
```

### Testing Plan
```bash
# Test 1: Test client with sample audio
node scripts/test-streaming.js test.wav

# Test 2: Test with curl (config only)
wscat -c ws://localhost:3001/stream
> {"type":"config","data":{"provider":"deepgram"}}

# Test 3: Check interim vs final results
# Should see multiple interim results, then final

# Test 4: Error handling - no API key
unset DEEPGRAM_API_KEY
node scripts/test-streaming.js test.wav
# Should show error message

# Test 5: Connection close
# Verify graceful shutdown after streaming completes
```

### Files Changed
- **New**: 2 files (streaming.ts, test-streaming.js)
- **Modified**: 3 files (index.ts, deepgram.ts, README.md)
- **Lines**: ~300 lines new code

---

## FINAL SUMMARY

### Timeline (6-8 hours)

| Phase | Duration | Tasks |
|-------|----------|-------|
| Phase 1: Confidence | 2-3h | Migration, types, services, APIs |
| Phase 2: Provider Docs | 0.5-1h | Documentation, show config status |
| Phase 3: Streaming | 4-5h | WebSocket, routes, client, testing |

### Total Impact

1. **Confidence Scores** - Quality awareness, filtering, monitoring
2. **Provider Selection** - Shows Deepgram usage, architecture skills
3. **Streaming** - Real-time capability, differentiator

### Key Deliverables

- ✅ Confidence scores stored and queryable
- ✅ Deepgram provider fully functional and documented
- ✅ Real-time streaming transcription via WebSocket
- ✅ Complete test suite
- ✅ Updated documentation

### Files Summary

- **New**: 4 files (migration, streaming route, test client, revised plan)
- **Modified**: 12 files
- **Total**: ~400 lines of new code

Ready to implement! 🚀
