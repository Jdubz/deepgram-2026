# Deepgram Backend AI Engineer - Interview Project

Audio Projects API - A simple API server for managing user audio files with AI-powered summarization.

## Requirements

From the interview prompt:
1. **POST /files** - Upload raw audio data with metadata
2. **GET /list** - List stored files with filtering (e.g., `?maxduration=300`)
3. **GET /download** - Download file content
4. **GET /info** - Get AI-generated summary of audio file (mocked)

## Quick Start

### Option 1: Docker Compose (Recommended)

Run both backend and LocalAI with GPU support:

```bash
# Start all services
docker compose up -d

# View logs
docker compose logs -f

# Stop services
docker compose down
```

Services:
- **Backend**: http://localhost:3001
- **Frontend**: http://localhost:5173
- **LocalAI**: http://localhost:8080

Note: First startup takes a few minutes while LocalAI downloads and initializes models.

### Option 2: Local Development

#### Backend

```bash
cd backend
npm install
npm run dev
```

Server runs at http://localhost:3001

#### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at http://localhost:5173

#### LocalAI (for real transcription/summarization)

```bash
docker run -p 8080:8080 --gpus all localai/localai:latest-aio-gpu
```

### Test the API

```bash
cd scripts
chmod +x test-api.sh
./test-api.sh
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/files` | Upload audio file (queued for processing) |
| GET | `/list` | List files (supports `?maxduration=N`, `?minduration=N`) |
| GET | `/download?id=X` | Download file by ID |
| GET | `/info?id=X` | Get transcript/summary (or processing status) |
| GET | `/submissions/:id` | Full submission details with jobs |
| GET | `/queue/status` | Queue and processor status |
| GET | `/files/:id` | Get file metadata by ID |
| DELETE | `/files/:id` | Delete file by ID |
| GET | `/health` | Health check (includes LocalAI status) |

## Curl Examples

```bash
# Upload a file (queued for processing)
curl -X POST -F "file=@myfile.wav" http://localhost:3001/files
# Returns: { id: "abc123", status: "pending", provider: "local" }

# Upload with specific provider
curl -X POST -F "file=@myfile.wav" -F "provider=deepgram" http://localhost:3001/files

# List files with filter
curl "http://localhost:3001/list?maxduration=300"

# Check processing status
curl "http://localhost:3001/submissions/abc123"

# Get transcript/summary (after processing complete)
curl "http://localhost:3001/info?id=abc123"

# Download a file
curl "http://localhost:3001/download?id=abc123" -o downloaded.wav

# Check queue status
curl "http://localhost:3001/queue/status"

# Health check
curl "http://localhost:3001/health"
```

## Provider Selection

The API supports multiple AI providers for transcription and summarization:

### Available Providers

- **local** (default): LocalAI with Whisper + Llama models - Runs locally, no API key required
- **deepgram**: Deepgram API - Cloud-based, requires API key, higher accuracy with confidence scores

### Usage

```bash
# Use Deepgram provider (requires DEEPGRAM_API_KEY environment variable)
curl -X POST -F "file=@audio.wav" -F "provider=deepgram" http://localhost:3001/files

# Use LocalAI provider (default)
curl -X POST -F "file=@audio.wav" http://localhost:3001/files

# Explicitly specify local provider
curl -X POST -F "file=@audio.wav" -F "provider=local" http://localhost:3001/files
```

### Configuration

Set environment variables to configure providers:

```bash
# Deepgram Configuration (Optional - for cloud-based transcription)
export DEEPGRAM_API_KEY=your_api_key_here
export DEEPGRAM_MODEL=nova-2              # or nova-3 for latest model
export DEEPGRAM_LANGUAGE=en

# LocalAI Configuration (for local transcription)
export LOCALAI_URL=http://localhost:8080
export LOCALAI_WHISPER_MODEL=whisper-1
export LOCALAI_LLM_MODEL=llama3

# Default Provider Selection
export DEFAULT_PROVIDER=local              # or 'deepgram'
```

### Check Provider Status

The `/health` endpoint shows which providers are configured:

```bash
curl http://localhost:3001/health | jq
```

Response:
```json
{
  "status": "ok",
  "services": {
    "localAI": {
      "healthy": true,
      "config": { "whisperModel": "whisper-1", "llmModel": "llama3" }
    },
    "deepgram": {
      "configured": true,
      "config": { "transcriptionModel": "nova-2", "language": "en" }
    },
    "jobProcessor": {
      "isRunning": true,
      "isProcessing": false
    }
  }
}
```

### Provider Comparison

| Feature | LocalAI | Deepgram |
|---------|---------|----------|
| Cost | Free (local GPU/CPU) | Pay per usage |
| Setup | Docker required | API key only |
| Latency | Depends on hardware | Fast (cloud) |
| Accuracy | Good (Whisper) | Excellent (Nova-2/3) |
| Confidence Scores | Estimated | Real per-word scores |
| Languages | 99+ (Whisper) | 36+ optimized |
| Streaming | No | Yes (coming soon) |

## Project Structure

```
deepgram-2026/
├── backend/
│   ├── src/
│   │   ├── index.ts              # Express server entry point
│   │   ├── constants.ts          # Shared configuration constants
│   │   ├── routes/
│   │   │   └── audio.ts          # API route handlers
│   │   ├── services/
│   │   │   ├── audio.ts          # Audio validation/metadata extraction
│   │   │   ├── localai.ts        # LocalAI HTTP client (Whisper + LLM)
│   │   │   ├── deepgram.ts       # Deepgram API client
│   │   │   ├── provider-factory.ts # Inference provider factory
│   │   │   ├── job-processor.ts  # Background job processor
│   │   │   └── inference-queue.ts # SQLite queue management
│   │   ├── db/
│   │   │   ├── database.ts       # SQLite database connection
│   │   │   └── migrations/       # Database migrations
│   │   └── types/
│   │       └── index.ts          # TypeScript interfaces
│   ├── data/                     # SQLite database (gitignored)
│   ├── uploads/                  # Uploaded audio files (gitignored)
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx               # Main React component
│   │   └── main.tsx              # Entry point
│   ├── package.json
│   └── vite.config.ts
├── models/                       # LocalAI model configs
├── localai/                      # LocalAI Docker configuration
├── scripts/
│   ├── test-api.sh               # API test suite
│   └── curl-examples.sh          # Example curl commands
├── docker-compose.yml            # Run backend + LocalAI together
├── Makefile                      # Development commands
└── README.md
```

## Architecture Highlights

### Multi-Provider Inference
The system supports multiple inference providers through a factory pattern:
- **LocalAI**: Self-hosted Whisper + LLM (Qwen2.5) for privacy and cost savings
- **Deepgram**: Cloud-based transcription and summarization API

### Job Queue System
Background job processing with SQLite-backed queue:
- Atomic job claiming to prevent race conditions
- Auto-chaining: transcription jobs automatically create summarization jobs
- Heartbeat tracking for stuck job detection
- Graceful shutdown with job completion

### Potential Enhancements
The following improvements could be added for production:

1. **Authentication & Authorization**
   - Add JWT authentication to protect endpoints
   - Implement rate limiting

2. **Storage Abstraction**
   - Add S3 support for audio file storage
   - Implement pre-signed URLs for direct uploads

3. **Caching**
   - Add Redis caching for frequent queries
   - Implement semantic caching for similar transcripts

4. **RAG Implementation**
   - Add vector storage for multi-file queries
   - Enable cross-file search and summarization

5. **Monitoring & Observability**
   - Add structured logging
   - Implement request tracing
   - Add metrics collection

## Local AI Setup (Optional)

To enable real transcription and summarization with LocalAI:

```bash
# Using docker-compose (recommended - includes model configuration)
docker compose up localai -d

# Or manually with Docker (GPU support)
docker run -p 8080:8080 --gpus all \
  -v ./models:/models \
  localai/localai:latest-gpu-nvidia-cuda-12

# Environment variables (set in backend/.env)
LOCALAI_URL=http://localhost:8080
LOCALAI_WHISPER_MODEL=whisper-1
LOCALAI_LLM_MODEL=qwen2.5-7b
```

Without LocalAI running, the health check will show `localAI: { healthy: false }`.

## Discussion Topics

Be prepared to discuss:
1. LLM orchestration frameworks (LangChain, LlamaIndex)
2. Validating/monitoring AI outputs for hallucinations
3. When to use RAG
4. Multi-provider LLM architecture
5. Caching, batching, routing for AI inference
6. Audio storage strategies (S3, pre-signed URLs)
7. Authentication and security
8. Data integrity and validation

## Tech Stack

- **Backend**: Node.js, Express, TypeScript
- **Frontend**: React, Vite, TypeScript
- **Audio Processing**: music-metadata
- **File Upload**: multer
- **Database**: SQLite (better-sqlite3)
- **Local AI** (optional): LocalAI (Docker) - provides OpenAI-compatible API for Whisper + LLM

## License

MIT
