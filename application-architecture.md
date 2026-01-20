# Application Architecture

## Overview

This is a full-stack audio processing application that handles audio file uploads, transcription, and AI-powered summarization. The system uses a **job queue architecture** with support for multiple inference providers (LocalAI and Deepgram).

**Technology Stack:**
- **Backend:** Node.js, Express, TypeScript, SQLite (better-sqlite3)
- **Frontend:** React 18, Vite, TypeScript
- **Infrastructure:** Docker Compose, LocalAI (GPU-enabled)
- **Architecture:** Job queue with embedded background processor, provider abstraction pattern

---

## Project Structure

```
deepgram-2026/
├── backend/                      # Express.js API server
│   ├── src/
│   │   ├── index.ts             # Express server entry point
│   │   ├── routes/
│   │   │   └── audio.ts         # API route handlers
│   │   ├── services/
│   │   │   ├── job-processor.ts     # Background job runner
│   │   │   ├── inference-queue.ts   # SQLite job queue manager
│   │   │   ├── provider-factory.ts  # Provider abstraction layer
│   │   │   ├── localai.ts           # LocalAI HTTP client
│   │   │   ├── deepgram.ts          # Deepgram API client
│   │   │   └── audio.ts             # Audio metadata extraction
│   │   ├── db/
│   │   │   ├── database.ts          # DB connection & migrations
│   │   │   └── migrations/          # SQL migration files
│   │   └── types/
│   │       └── index.ts         # TypeScript interfaces
│   ├── data/                    # SQLite database (runtime)
│   ├── uploads/                 # Audio files (runtime)
│   └── Dockerfile
│
├── frontend/                     # React web UI
│   ├── src/
│   │   ├── App.tsx              # Main component
│   │   └── main.tsx             # Entry point
│   └── vite.config.ts           # Dev server with API proxy
│
├── models/                       # LocalAI model configs
├── docker-compose.yml           # Backend + LocalAI services
└── Makefile                     # Development commands
```

---

## Backend Architecture

### Entry Point (`src/index.ts`)

The Express server initializes with:
- CORS middleware
- JSON body parsing
- Audio routes mounted at root
- Health check endpoint with service status
- Queue status monitoring
- Graceful shutdown handling (SIGTERM/SIGINT)
- Job processor auto-start

**Ports:** 3001 (development) / 3000 (Docker)

### API Endpoints (`src/routes/audio.ts`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/files` | Upload audio file, queue for processing |
| `GET` | `/list` | List files with duration filtering |
| `GET` | `/download` | Download file by ID or name |
| `GET` | `/info` | Get transcript & summary for file |
| `GET` | `/files/:id` | Get file metadata |
| `DELETE` | `/files/:id` | Delete file and associated jobs |
| `GET` | `/submissions/:id` | Get submission with jobs |
| `GET` | `/jobs` | List recent jobs |
| `GET` | `/jobs/:id` | Get job details with heartbeat |

**File Upload Flow:**
1. Multer receives file (100MB limit)
2. Save to disk: `/uploads/{uuid}{ext}`
3. Validate & extract audio metadata
4. Create submission in SQLite
5. Auto-create transcribe job
6. Return `{ id, filename, status, provider }`

---

## Database Schema

**SQLite with WAL mode** - Migrations run automatically on startup.

### `jobs` Table
Inference job queue with fields:
- `id`, `job_type` (transcribe/summarize), `status`
- `provider` (local/deepgram)
- `input_file_path`, `input_text`, `output_text`
- `audio_file_id` (FK to submissions)
- Timing: `created_at`, `started_at`, `completed_at`, `processing_time_ms`
- Heartbeat: `last_heartbeat`, `heartbeat_count`, `model_verified`, `timeout_seconds`

### `audio_submissions` Table
Uploaded files with fields:
- `id` (UUID), `filename`, `file_path`
- `duration_seconds`, `file_size`, `mime_type`
- `transcript`, `summary` (results)
- `status` (pending/transcribing/summarizing/completed/failed)

---

## Services Architecture

### Job Processor (`job-processor.ts`)

**Embedded background worker** running in the Express process.

- **Polling Loop:** Every 2s, claims next pending job
- **Sequential Processing:** One job at a time (GPU constraint)
- **Auto-Chaining:** Transcribe completion creates summarize job
- **Stuck Job Detection:** Every 30s, recovers stalled jobs
- **Graceful Shutdown:** Waits for current job to complete

### Inference Queue (`inference-queue.ts`)

**SQLite queue manager** with atomic operations.

Key operations:
- `claimNextJob()` - Atomic claim via `UPDATE ... WHERE id = (SELECT ...)`
- `createSubmission()` - Create file entry + auto-queue jobs
- `completeJob()` / `failJob()` - Update job status
- `updateJobHeartbeat()` - Track streaming progress
- `findStuckJobs()` - Query stale processing jobs

### Provider Factory (`provider-factory.ts`)

**Factory pattern** for runtime provider selection.

```typescript
interface InferenceProvider {
  name: Provider  // 'local' | 'deepgram'
  transcribe(audioFilePath): Promise<TranscriptionResult>
  summarize(text): Promise<SummarizationResult>
  healthCheck(): Promise<boolean>
}
```

### LocalAI Service (`localai.ts`)

HTTP client for LocalAI's OpenAI-compatible API.

- **Transcription:** `POST /v1/audio/transcriptions` (Whisper)
- **Summarization:** `POST /v1/chat/completions` (LLM)
- **Streaming:** SSE with heartbeat callbacks for stuck detection
- **Health Check:** `GET /readyz` + model availability check

### Deepgram Service (`deepgram.ts`)

HTTP client for Deepgram's REST API.

- **Transcription:** `POST /v1/listen` with audio buffer
- **Summarization:** `POST /v1/read?summarize=v2`
- **Auth:** `Authorization: Token {apiKey}`
- **Note:** Summarization requires 50+ words, otherwise returns original text

### Audio Service (`audio.ts`)

Audio file validation and metadata extraction.

**Duration Strategies:**
1. `music-metadata` library parsing
2. Manual FLAC STREAMINFO block parsing
3. Bitrate-based estimation fallback
4. Exact WAV calculation from header

---

## Frontend Architecture

### React App (`App.tsx`)

Single-page application using React hooks for state management.

**Sections:**
1. **Upload** - File input, provider selector, upload button
2. **Files List** - Table with duration filter, download/info actions
3. **Job Queue** - Collapsible table with auto-refresh (5s)
4. **Info Modal** - Displays transcript/summary with provider info

**API Integration:**
- Vite proxy routes `/api/*` to backend on port 3001
- Auto-refresh on filter changes and queue expansion

---

## Infrastructure

### Docker Compose

**Services:**

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| `backend` | Custom build | 3001:3000 | Express API server |
| `localai` | `localai/localai:latest-aio-gpu-nvidia-cuda-12` | 8080 | Whisper + LLM inference |

**Volumes:**
- `backend-data` - SQLite database
- `backend-uploads` - Audio files
- `localai-cache` - Model build cache
- `localai-backend-data` - Downloaded backends

**GPU Configuration:**
```yaml
deploy:
  resources:
    reservations:
      devices:
        - driver: nvidia
          count: 1
          capabilities: [gpu]
```

### Multi-Stage Dockerfile

1. **base** - Install dependencies
2. **development** - Hot reload with tsx
3. **builder** - TypeScript compilation
4. **production** - Minimal image, non-root user

---

## Data Flow

### Upload → Transcription → Summarization Pipeline

```
POST /files (Upload)
    ↓
┌─────────────────────────────────────┐
│ 1. Save file to disk                │
│ 2. Extract audio metadata           │
│ 3. Create submission (SQLite)       │
│ 4. Create transcribe job            │
│ 5. Return: { id, status: pending }  │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ Background Job Processor            │
├─────────────────────────────────────┤
│ Poll every 2s:                      │
│   1. Claim next pending job         │
│   2. Verify model is loaded         │
│   3. Call provider.transcribe()     │
│   4. Store transcript               │
│   5. Auto-create summarize job      │
│                                     │
│   6. Claim summarize job            │
│   7. Call provider.summarize()      │
│   8. Store summary                  │
│   9. Mark submission completed      │
└─────────────────────────────────────┘
    ↓
GET /info?id=X
    ↓
{ transcript, summary, provider info }
```

### Job State Machine

```
PENDING → PROCESSING → COMPLETED
              ↓
           FAILED
```

### Submission State Machine

```
PENDING → TRANSCRIBING → SUMMARIZING → COMPLETED
   ↓          ↓              ↓
   └──────────┴──────────────┴───→ FAILED
```

---

## Provider Comparison

| Feature | LocalAI | Deepgram |
|---------|---------|----------|
| **Transcription** | Whisper backend | Nova-2 model |
| **Summarization** | LLM (qwen2.5-7b) | Text Intelligence API |
| **Authentication** | None (local) | API key |
| **Streaming** | Supported | N/A |
| **Heartbeat** | Token-based | N/A |
| **Cost** | Free (local GPU) | Pay-per-use |

---

## Stuck Job Detection

**Problem:** Jobs can hang silently (model loading, inference stall).

**Solution:** Heartbeat-based monitoring.

1. **Streaming Heartbeat:** On each token, update `last_heartbeat` and `heartbeat_count`
2. **Model Verification:** Flag `model_verified` when model confirmed loaded
3. **Detection Loop:** Every 30s, query processing jobs with stale heartbeat
4. **Recovery:** Mark failed with reason:
   - "Model never verified as loaded"
   - "No tokens ever received"
   - "Stalled after N tokens"

---

## Environment Variables

```bash
# Backend
NODE_ENV=production
PORT=3000
LOCALAI_URL=http://localai:8080
LOCALAI_WHISPER_MODEL=whisper-1
LOCALAI_LLM_MODEL=gpt-4o-mini
DEEPGRAM_API_KEY=your-api-key
DEFAULT_PROVIDER=local

# LocalAI
MODELS_PATH=/models
PARALLEL_REQUESTS=1
LOCALAI_EXTERNAL_BACKENDS=whisper:quay.io/go-skynet/local-ai-backends:latest-gpu-nvidia-cuda-12-whisper
```

---

## Key Design Patterns

| Pattern | Usage |
|---------|-------|
| **Singleton** | Database, InferenceQueue, providers |
| **Factory** | ProviderFactory for runtime resolution |
| **Strategy** | InferenceProvider interface |
| **Observer** | Heartbeat callbacks during streaming |
| **Queue** | SQLite with atomic job claiming |
| **Embedded Worker** | JobProcessor in Express process |

---

## API Response Examples

### Upload Response
```json
{
  "id": "abc-123",
  "filename": "meeting.wav",
  "status": "pending",
  "provider": "local"
}
```

### Completed Info Response
```json
{
  "filename": "meeting.wav",
  "duration": 125.4,
  "size": 2048000,
  "transcript": "The meeting started at...",
  "transcriptProvider": "local",
  "transcriptModel": "whisper-1",
  "summary": "Main topics discussed...",
  "summaryProvider": "local",
  "summaryModel": "qwen2.5-7b"
}
```

### Health Check Response
```json
{
  "status": "ok",
  "services": {
    "localAI": { "healthy": true },
    "jobProcessor": { "isRunning": true }
  }
}
```

---

## Development Commands

```bash
make dev              # Start backend + frontend
make dev-backend      # Backend only (port 3001)
make dev-frontend     # Frontend only (port 5173)

make db-reset         # Reset SQLite database
make test-api         # Run integration tests

make localai-logs     # View LocalAI logs
make localai-models   # List available models
```

---

## Deployment

```bash
# Start all services
docker compose up -d

# Check logs
docker compose logs -f backend
docker compose logs -f localai

# Stop services
docker compose down
```

**First Run:** LocalAI downloads models (~5-10 minutes). Backend waits for LocalAI health check.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Frontend (React)                          │
│                         localhost:5173                              │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ /api/*
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Backend (Express)                            │
│                       localhost:3001                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │    Routes    │  │  Job Queue   │  │    Job Processor         │  │
│  │  (audio.ts)  │→ │  (SQLite)    │→ │  (background polling)    │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
│                                              │                      │
│                                              ▼                      │
│                           ┌──────────────────────────────────┐     │
│                           │      Provider Factory            │     │
│                           │  ┌─────────┐  ┌─────────────┐   │     │
│                           │  │ LocalAI │  │  Deepgram   │   │     │
│                           │  └─────────┘  └─────────────┘   │     │
│                           └──────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────┘
         │                                      │
         │ HTTP                                 │ HTTPS
         ▼                                      ▼
┌─────────────────────┐              ┌──────────────────────┐
│      LocalAI        │              │    Deepgram API      │
│   localhost:8080    │              │  api.deepgram.com    │
│  ┌───────────────┐  │              └──────────────────────┘
│  │    Whisper    │  │
│  │  (transcribe) │  │
│  ├───────────────┤  │
│  │     LLM       │  │
│  │  (summarize)  │  │
│  └───────────────┘  │
└─────────────────────┘
```
