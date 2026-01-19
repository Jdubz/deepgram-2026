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
- **LocalAI**: http://localhost:8080

Note: First startup takes a few minutes while LocalAI downloads models (~10GB).
Note: Docker uses port 3001. Curl examples below use port 3000 (local dev). Adjust accordingly.

### Option 2: Local Development

#### Backend

```bash
cd backend
npm install
npm run dev
```

Server runs at http://localhost:3000

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
curl -X POST -F "file=@myfile.wav" http://localhost:3000/files
# Returns: { id: "abc123", status: "pending" }

# List files with filter
curl "http://localhost:3000/list?maxduration=300"

# Check processing status
curl "http://localhost:3000/submissions/abc123"

# Get transcript/summary (after processing complete)
curl "http://localhost:3000/info?id=abc123"

# Download a file
curl "http://localhost:3000/download?id=abc123" -o downloaded.wav

# Check queue status
curl "http://localhost:3000/queue/status"
```

## Project Structure

```
deepgram-2026/
├── backend/
│   ├── src/
│   │   ├── index.ts              # Express server entry point
│   │   ├── routes/
│   │   │   └── audio.ts          # API route handlers
│   │   ├── services/
│   │   │   ├── storage.ts        # Audio storage (in-memory)
│   │   │   ├── audio.ts          # Audio validation/metadata
│   │   │   ├── llm.ts            # LLM service (mocked)
│   │   │   ├── localai.ts        # LocalAI HTTP client
│   │   │   ├── job-processor.ts  # Background job processor
│   │   │   └── inference-queue.ts # SQLite queue management
│   │   └── types/
│   │       └── index.ts          # TypeScript interfaces
│   ├── data/                     # SQLite database (gitignored)
│   ├── uploads/                  # Uploaded audio files (gitignored)
│   ├── Dockerfile                # Backend container image
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx               # Main React component
│   │   └── main.tsx              # Entry point
│   ├── package.json
│   └── vite.config.ts
├── scripts/
│   ├── test-api.sh               # API test suite
│   └── curl-examples.sh          # Example curl commands
├── docker-compose.yml            # Run backend + LocalAI together
└── README.md
```

## Study Exercises

The codebase includes TODO comments marking exercises to complete:

### Exercise 1: LLM Orchestration
- File: `backend/src/services/llm.ts`
- Implement LangChain or similar framework integration

### Exercise 2: Output Validation
- File: `backend/src/services/llm.ts`
- Add Zod schema validation for LLM responses

### Exercise 3: RAG Implementation
- File: `backend/src/services/llm.ts`
- Implement vector storage and retrieval for multi-file queries

### Exercise 4: Multi-Provider Architecture
- File: `backend/src/services/llm.ts`
- Create provider abstraction layer for OpenAI, Anthropic, etc.

### Exercise 5: Caching
- File: `backend/src/services/llm.ts`
- Add Redis/semantic caching for LLM responses

### Exercise 6: Storage Abstraction
- File: `backend/src/services/storage.ts`
- Implement file system and S3 storage options

### Exercise 7: Authentication
- File: `backend/src/routes/audio.ts`
- Add JWT authentication and authorization

### Exercise 8: Data Validation
- File: `backend/src/services/audio.ts`
- Implement robust file validation with magic bytes

### Exercise 9: Local Inference with LocalAI
- Files: `backend/src/services/localai.ts`, `backend/src/services/job-processor.ts`
- Connect to LocalAI for Whisper transcription and LLM summarization
- Job processor runs embedded in Express server
- Sequential processing (single-GPU constraint)

## Local AI Setup (Optional)

To enable real transcription and summarization with LocalAI:

```bash
# Run LocalAI with Docker (CPU)
docker run -p 8080:8080 localai/localai:latest-aio-cpu

# Or with GPU support
docker run -p 8080:8080 --gpus all localai/localai:latest-aio-gpu

# Environment variables (set before starting backend)
export LOCALAI_URL=http://localhost:8080
export LOCALAI_WHISPER_MODEL=whisper-1
export LOCALAI_LLM_MODEL=llama3
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
