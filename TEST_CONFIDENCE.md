# Testing Plan: Confidence Scores

## Pre-Test Setup

```bash
# 1. Start backend (will run migration automatically)
cd backend
npm run dev

# 2. Verify migration ran
# Check logs for: "Applying migration 3: add_confidence"

# 3. Optional: Start LocalAI for local provider testing
docker compose up -d localai
```

## Test 1: Database Migration

**Goal**: Verify confidence columns were added

```bash
# Check schema
sqlite3 backend/data/deepgram.db ".schema jobs" | grep confidence
# Expected: confidence REAL DEFAULT NULL

sqlite3 backend/data/deepgram.db ".schema audio_submissions" | grep confidence
# Expected: transcript_confidence REAL DEFAULT NULL
# Expected: summary_confidence REAL DEFAULT NULL

# Check index exists
sqlite3 backend/data/deepgram.db ".indexes audio_submissions"
# Expected: idx_submissions_confidence
```

## Test 2: Upload with LocalAI Provider (Estimated Confidence)

```bash
# Upload a file
curl -X POST -F "file=@test.wav" -F "provider=local" http://localhost:3001/files

# Expected response:
{
  "id": "abc123",
  "filename": "test.wav",
  "status": "pending",
  "provider": "local",
  "message": "File uploaded and queued for processing"
}

# Wait a few seconds, then check status
curl "http://localhost:3001/submissions/<id>" | jq

# Expected: jobs[0].confidence should be 0.85 (LocalAI default)
```

## Test 3: Upload with Deepgram Provider (Real Confidence)

**Requires**: `DEEPGRAM_API_KEY` environment variable set

```bash
# Set API key
export DEEPGRAM_API_KEY=your_key_here

# Upload a file
curl -X POST -F "file=@test.wav" -F "provider=deepgram" http://localhost:3001/files

# Wait for processing, then check
curl "http://localhost:3001/submissions/<id>" | jq '.jobs[] | {type: .job_type, confidence: .confidence}'

# Expected: Confidence between 0 and 1 (real value from Deepgram)
# Note: Actual confidence depends on audio quality
```

## Test 4: Check Confidence in Database

```bash
# After processing a file
sqlite3 backend/data/deepgram.db "SELECT id, job_type, confidence FROM jobs WHERE status = 'completed';"

# Expected output:
# abc123|transcribe|0.85
# abc124|summarize|0.80

# Check submissions table
sqlite3 backend/data/deepgram.db "SELECT id, transcript_confidence, summary_confidence FROM audio_submissions WHERE status = 'completed';"

# Expected: Values should match job confidence scores
```

## Test 5: GET /info Endpoint with Confidence

```bash
# Get info for processed file
curl "http://localhost:3001/info?id=<submission_id>" | jq

# Expected response includes:
{
  "filename": "test.wav",
  "duration": 10.5,
  "size": 168000,
  "transcriptStatus": "completed",
  "transcript": "...",
  "transcriptConfidence": 0.85,    # <-- NEW
  "transcriptProvider": "local",
  "transcriptModel": "whisper-1",
  "summaryStatus": "completed",
  "summary": "...",
  "summaryConfidence": 0.80,       # <-- NEW
  "summaryProvider": "local",
  "summaryModel": "qwen2.5-7b"
}
```

## Test 6: Filter by Confidence

```bash
# Upload multiple files to build test data
curl -X POST -F "file=@test1.wav" -F "provider=local" http://localhost:3001/files
curl -X POST -F "file=@test2.wav" -F "provider=deepgram" http://localhost:3001/files

# Wait for processing...

# List all files (no filter)
curl "http://localhost:3001/list" | jq '.files | length'

# Filter by high confidence (>= 0.9)
curl "http://localhost:3001/list?min_confidence=0.9" | jq

# Expected: Only files with confidence >= 0.9
# LocalAI files (0.85) should be excluded
# Deepgram files with high confidence should be included

# Filter by low confidence (>= 0.7)
curl "http://localhost:3001/list?min_confidence=0.7" | jq

# Expected: Both LocalAI (0.85) and most Deepgram files
```

## Test 7: Combine Filters

```bash
# Filter by duration AND confidence
curl "http://localhost:3001/list?maxduration=60&min_confidence=0.8" | jq

# Expected: Only files <= 60s with confidence >= 0.8

# Check total count in response
curl "http://localhost:3001/list?min_confidence=0.95" | jq '.total'

# Expected: Count should match filtered results
```

## Test 8: Edge Cases

### 8.1: Invalid Confidence Range

```bash
# Try confidence > 1
curl "http://localhost:3001/list?min_confidence=1.5"
# Expected: 400 Bad Request or filtered as >= 1

# Try negative confidence
curl "http://localhost:3001/list?min_confidence=-0.5"
# Expected: 400 Bad Request or filtered as >= 0
```

### 8.2: No Confidence Data

```bash
# Files uploaded before migration won't have confidence
# Check if old files are handled gracefully
curl "http://localhost:3001/list" | jq '.files[] | select(.transcriptConfidence == null)'

# Expected: Old files should have null confidence and not break the API
```

### 8.3: Partial Confidence

```bash
# File with transcript but no summary
# Upload file with auto-summarize disabled
curl -X POST -F "file=@test.wav" -F "metadata={'autoSummarize':false}" http://localhost:3001/files

# Check info
curl "http://localhost:3001/info?id=<id>" | jq '{transcriptConfidence, summaryConfidence}'

# Expected:
# transcriptConfidence: 0.85
# summaryConfidence: null
```

## Test 9: Performance Check

```bash
# Upload 10 files and measure confidence filtering performance
for i in {1..10}; do
  curl -X POST -F "file=@test.wav" http://localhost:3001/files
done

# Wait for all to process...

# Time the filtered query
time curl "http://localhost:3001/list?min_confidence=0.8" > /dev/null

# Expected: Should complete in < 100ms with index
```

## Test 10: Health Check (No Change)

```bash
# Verify health endpoint still works
curl "http://localhost:3001/health" | jq

# Expected: Same as before (confidence doesn't affect health)
{
  "status": "ok",
  "services": {
    "localAI": { "healthy": true },
    "deepgram": { "configured": true }
  }
}
```

## Validation Checklist

- [ ] Migration 003 applied successfully
- [ ] Database schema has confidence columns
- [ ] LocalAI returns confidence 0.85 for transcription
- [ ] LocalAI returns confidence 0.80 for summarization
- [ ] Deepgram returns real confidence (0-1)
- [ ] Confidence stored in jobs table
- [ ] Confidence stored in audio_submissions table
- [ ] GET /info includes transcriptConfidence
- [ ] GET /info includes summaryConfidence
- [ ] GET /list supports min_confidence filter
- [ ] Filtering by confidence works correctly
- [ ] Null confidence handled gracefully
- [ ] Backward compatible with old data
- [ ] Index on transcript_confidence exists

## Expected Confidence Values

| Provider | Operation | Confidence | Source |
|----------|-----------|------------|--------|
| LocalAI | Transcription | 0.85 | Estimated default |
| LocalAI | Summarization | 0.80 | Estimated default |
| Deepgram | Transcription | 0.0 - 1.0 | Real API value |
| Deepgram | Summarization | null | Not provided by API |

## Troubleshooting

### Migration doesn't run
```bash
# Force migration check
rm backend/data/deepgram.db
npm run dev
# Will recreate DB with all migrations
```

### Confidence is null
```bash
# Check job status
sqlite3 backend/data/deepgram.db "SELECT id, status, confidence FROM jobs ORDER BY id DESC LIMIT 5;"

# If status = 'completed' but confidence is null:
# - Check provider service is returning confidence
# - Check job processor is passing confidence to completeJob()
```

### Filtering not working
```bash
# Check index exists
sqlite3 backend/data/deepgram.db ".indexes audio_submissions"

# Verify data exists
sqlite3 backend/data/deepgram.db "SELECT COUNT(*) FROM audio_submissions WHERE transcript_confidence IS NOT NULL;"

# Test SQL directly
sqlite3 backend/data/deepgram.db "SELECT id, transcript_confidence FROM audio_submissions WHERE transcript_confidence >= 0.8;"
```

## Success Criteria

✅ **Phase 1 Complete** when:

1. All tests pass
2. Confidence scores are stored for new transcriptions
3. API filtering by confidence works
4. GET /info exposes confidence scores
5. Both LocalAI and Deepgram providers return confidence
6. No breaking changes to existing functionality
7. Migration runs automatically on server start
