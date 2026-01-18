# Deepgram Backend AI Engineer - Interview Project

Audio Projects API - A simple API server for managing user audio files with AI-powered summarization.

## Requirements

From the interview prompt:
1. **POST /files** - Upload raw audio data with metadata
2. **GET /list** - List stored files with filtering (e.g., `?maxduration=300`)
3. **GET /download** - Download file content
4. **GET /info** - Get AI-generated summary of audio file (mocked)

## Quick Start

### Backend

```bash
cd backend
npm install
npm run dev
```

Server runs at http://localhost:3000

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at http://localhost:5173

### Test the API

```bash
cd scripts
chmod +x test-api.sh
./test-api.sh
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/files` | Upload audio file with metadata |
| GET | `/list` | List files (supports `?maxduration=N`, `?minduration=N`) |
| GET | `/download?name=X` | Download file by name |
| GET | `/info?name=X` | Get AI summary of file |
| GET | `/files/:id` | Get file metadata by ID |
| DELETE | `/files/:id` | Delete file by ID |
| GET | `/health` | Health check |

## Curl Examples

```bash
# Upload a file
curl -X POST -F "file=@myfile.wav" http://localhost:3000/files

# List files with filter
curl "http://localhost:3000/list?maxduration=300"

# Download a file
curl "http://localhost:3000/download?name=myfile.wav" -o downloaded.wav

# Get AI summary
curl "http://localhost:3000/info?name=myfile.wav"
```

## Project Structure

```
deepgram-2026/
├── backend/
│   ├── src/
│   │   ├── index.ts          # Express server entry point
│   │   ├── routes/
│   │   │   └── audio.ts      # API route handlers
│   │   ├── services/
│   │   │   ├── storage.ts    # Audio storage (in-memory)
│   │   │   ├── audio.ts      # Audio validation/metadata
│   │   │   └── llm.ts        # LLM service (mocked)
│   │   └── types/
│   │       └── index.ts      # TypeScript interfaces
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx           # Main React component
│   │   └── main.tsx          # Entry point
│   ├── package.json
│   └── vite.config.ts
├── scripts/
│   ├── test-api.sh           # API test suite
│   └── curl-examples.sh      # Example curl commands
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

## License

MIT
