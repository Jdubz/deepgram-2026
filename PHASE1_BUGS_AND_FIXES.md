# Phase 1: Bugs and Gaps Investigation

**Status**: ✅ Critical fixes applied and committed (9b5cd4b)

All 3 critical type safety issues have been resolved:
- Job interface now includes confidence field
- AudioSubmission interface now includes transcript_confidence and summary_confidence
- GET /list endpoint now returns confidence scores in response
- Route documentation updated with min_confidence parameter

---

## Critical Issues ⚠️

### 1. Missing `confidence` Field in `Job` Interface
**File**: `backend/src/services/inference-queue.ts`
**Line**: 21-39

**Issue**: The `Job` interface doesn't include the `confidence` field, even though:
- Database column exists (migration 003)
- We're writing to it in `completeJob()`
- We're reading from it when returning job info

**Impact**:
- TypeScript won't catch errors when accessing `job.confidence`
- Runtime type mismatches
- Database queries return confidence but it's not typed

**Fix**: Add field to interface:
```typescript
export interface Job {
  id: number;
  job_type: JobType;
  status: JobStatus;
  provider: Provider;
  input_file_path: string | null;
  input_text: string | null;
  output_text: string | null;
  error_message: string | null;
  audio_file_id: string | null;
  metadata: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  processing_time_ms: number | null;
  model_used: string | null;
  confidence: number | null;  // ADD THIS LINE
  raw_response: string | null;
  raw_response_type: string | null;
}
```

---

### 2. Missing Confidence Fields in `AudioSubmission` Interface
**File**: `backend/src/services/inference-queue.ts`
**Line**: 41-60

**Issue**: The `AudioSubmission` interface doesn't include `transcript_confidence` and `summary_confidence` fields:
- Database columns exist (migration 003)
- We're writing to them in `updateSubmissionTranscript()` and `updateSubmissionSummary()`
- We're reading from them in the `/info` endpoint

**Impact**:
- TypeScript won't catch errors when accessing these fields
- `submission.transcript_confidence` is used in routes but not typed

**Fix**: Add fields to interface:
```typescript
export interface AudioSubmission {
  id: string;
  filename: string;
  original_filename: string | null;
  file_path: string;
  mime_type: string | null;
  file_size: number | null;
  duration_seconds: number | null;
  transcript: string | null;
  transcript_job_id: number | null;
  transcript_confidence: number | null;  // ADD THIS LINE
  transcribed_at: string | null;
  summary: string | null;
  summary_job_id: number | null;
  summary_confidence: number | null;  // ADD THIS LINE
  summarized_at: string | null;
  status: SubmissionStatus;
  error_message: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}
```

---

### 3. GET /list Doesn't Return Confidence Scores
**File**: `backend/src/routes/audio.ts`
**Line**: 202-209

**Issue**: The `/list` endpoint:
- Accepts `?min_confidence` filter
- Filters submissions by confidence
- But doesn't return confidence scores in the response

Users can filter by confidence but can't see why files were included/excluded.

**Impact**:
- Poor user experience
- Can't display confidence in UI lists
- Inconsistent API design (filter by field but don't return it)

**Current Code**:
```typescript
const files = submissions.map((s) => ({
  id: s.id,
  filename: s.original_filename || s.filename,
  duration: s.duration_seconds || 0,
  size: s.file_size || 0,
  mimeType: s.mime_type || "audio/unknown",
  uploadedAt: s.created_at,
}));
```

**Fix**: Add confidence fields:
```typescript
const files = submissions.map((s) => ({
  id: s.id,
  filename: s.original_filename || s.filename,
  duration: s.duration_seconds || 0,
  size: s.file_size || 0,
  mimeType: s.mime_type || "audio/unknown",
  uploadedAt: s.created_at,
  transcriptConfidence: s.transcript_confidence,  // ADD THIS
  summaryConfidence: s.summary_confidence,        // ADD THIS
}));
```

**Also Update**: `ListFilesResponse` type to reflect this change or create a new interface for list items.

---

## Medium Priority Issues 📋

### 4. `AudioMetadata` Interface Doesn't Include Confidence
**File**: `backend/src/types/index.ts`
**Line**: 47-62

**Issue**: The `AudioMetadata` interface is used for in-memory storage but doesn't include confidence fields. This is inconsistent with database storage.

**Impact**:
- Can't store confidence in in-memory storage service
- Type inconsistency between storage mechanisms

**Note**: This might be okay if in-memory storage is deprecated, but should be documented or fixed for consistency.

**Fix**:
```typescript
export interface AudioMetadata {
  id: string;
  filename: string;
  originalFilename: string;
  mimeType: string;
  size: number;
  duration: number;
  channels?: number;
  sampleRate?: number;
  uploadedAt: Date;
  customMetadata: Record<string, string>;
  transcription?: string;
  transcriptConfidence?: number;  // ADD THIS
  summary?: string;
  summaryConfidence?: number;     // ADD THIS
}
```

---

### 5. Deepgram Summarization Doesn't Return Confidence
**File**: `backend/src/services/deepgram.ts`
**Line**: 189-195

**Issue**: The `summarize()` method doesn't return a `confidence` field, even though the interface allows it as optional.

**Impact**:
- Deepgram summaries will have `null` confidence
- Inconsistent with LocalAI which returns 0.80
- Users might expect confidence for all operations

**Current Code**:
```typescript
return {
  text: summary,
  model: "deepgram-text-intelligence",
  tokensUsed,
  processingTimeMs: Date.now() - startTime,
  rawResponse,
};
```

**Fix Options**:

**Option A**: Add undefined explicitly (documents the behavior):
```typescript
return {
  text: summary,
  confidence: undefined,  // ADD THIS - Deepgram doesn't provide summary confidence
  model: "deepgram-text-intelligence",
  tokensUsed,
  processingTimeMs: Date.now() - startTime,
  rawResponse,
};
```

**Option B**: Extract confidence if Deepgram provides it in the response (check API docs)

**Recommendation**: Option A with comment explaining why

---

## Low Priority / Documentation Issues 📝

### 6. Migration Missing Index for summary_confidence
**File**: `backend/src/db/migrations/003_add_confidence.sql`
**Line**: 12-14

**Issue**: We create an index on `transcript_confidence` but not on `summary_confidence`.

**Impact**:
- If we ever add filtering by summary confidence, it will be slower
- Asymmetric indexing strategy

**Analysis**:
- Currently we only filter by transcript confidence
- Summary confidence filtering might not be needed
- Index has storage/write cost

**Recommendation**:
- Keep as-is if we don't plan to filter by summary confidence
- Document the decision
- Add index later if needed

---

### 7. No Confidence Validation in Database
**File**: `backend/src/db/migrations/003_add_confidence.sql`

**Issue**: Database columns accept any REAL value, including invalid confidence scores (< 0 or > 1).

**Impact**:
- Could store invalid confidence values
- Application validates but database doesn't enforce

**Fix** (SQLite has limited CHECK constraints, might not work):
```sql
ALTER TABLE jobs ADD COLUMN confidence REAL DEFAULT NULL
  CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1));
```

**Recommendation**: Keep validation in application layer (already done in `parseNumericParam`)

---

### 8. Confidence Query Parameter Not Documented in Route Comment
**File**: `backend/src/routes/audio.ts`
**Line**: 165-178

**Issue**: The route comment doesn't mention the new `min_confidence` parameter.

**Current Comment**:
```typescript
/**
 * GET /list
 *
 * Get a list of stored files with optional filtering.
 *
 * Query parameters:
 *   - maxduration: Maximum duration in seconds
 *   - minduration: Minimum duration in seconds
 *   - limit: Max number of results (default: 100)
 *   - offset: Offset for pagination (default: 0)
 *
 * Example:
 *   curl http://localhost:3000/list?maxduration=300
 */
```

**Fix**: Add min_confidence to documentation:
```typescript
/**
 * GET /list
 *
 * Get a list of stored files with optional filtering.
 *
 * Query parameters:
 *   - maxduration: Maximum duration in seconds
 *   - minduration: Minimum duration in seconds
 *   - min_confidence: Minimum transcript confidence (0-1)
 *   - limit: Max number of results (default: 100)
 *   - offset: Offset for pagination (default: 0)
 *
 * Example:
 *   curl http://localhost:3000/list?maxduration=300&min_confidence=0.85
 */
```

---

### 9. README Not Updated with Confidence Feature
**File**: `README.md`

**Issue**: The main README doesn't document:
- New `min_confidence` query parameter
- Confidence scores in responses
- How confidence is calculated (real vs estimated)

**Recommendation**: Add a "Confidence Scores" section to README

---

## Edge Cases to Test 🧪

### 10. Null Confidence Handling in Frontend
**Concern**: Old submissions (before migration) will have `null` confidence.

**Test Scenarios**:
1. Upload before migration, query after migration
2. Filter by confidence when some files have null confidence
3. Display null confidence in UI

**Current Behavior**:
- SQL filter `transcript_confidence >= ?` will exclude null values (correct)
- API returns `null` for old files (correct)
- Frontend needs to handle null gracefully

**Status**: ✅ Should work, but needs frontend testing

---

### 11. Confidence = 0 vs Confidence = null
**Concern**: Deepgram might return confidence of 0 for very poor audio.

**Issue**:
- 0 is a valid confidence score (0% confident)
- null means no confidence data
- Filter `>= 0.8` should exclude confidence=0, include confidence=null?

**Current Behavior**:
- SQL: `transcript_confidence >= 0.8` excludes both 0 and null (correct)
- API validation: allows 0-1 range (correct)

**Status**: ✅ Correct behavior

---

### 12. Summary Confidence When Transcript Fails
**Concern**: If transcription fails, we won't create a summary job.

**Question**: Should `summary_confidence` be null or should we indicate failure differently?

**Current Behavior**:
- If transcript fails, no summary job created
- `summary_confidence` remains null
- API returns `summaryStatus: "failed"`

**Status**: ✅ Correct - use status, not confidence to indicate failure

---

## Summary of Required Fixes

### Must Fix (Critical) ⚠️
1. ✅ **FIXED** - Add `confidence: number | null` to `Job` interface
2. ✅ **FIXED** - Add `transcript_confidence` and `summary_confidence` to `AudioSubmission` interface
3. ✅ **FIXED** - Return confidence scores in GET /list endpoint response

### Should Fix (Medium) 📋
4. ⚠️ Add confidence fields to `AudioMetadata` interface (if used)
5. ✅ Document why Deepgram summarize doesn't return confidence
6. ✅ **FIXED** - Update route comments to document min_confidence parameter

### Nice to Have (Low) 📝
7. ⚠️ Update README with confidence feature documentation
8. ⚠️ Consider adding summary_confidence index if needed
9. ⚠️ Add confidence validation examples to TEST_CONFIDENCE.md

---

## Testing Checklist

After fixes:
- [ ] TypeScript compiles without errors
- [ ] Upload file with LocalAI → confidence = 0.85/0.80
- [ ] Upload file with Deepgram → confidence = real value
- [ ] GET /list returns confidence in response
- [ ] GET /list?min_confidence=0.9 filters correctly
- [ ] GET /info includes confidence scores
- [ ] Old files (null confidence) don't break anything
- [ ] Frontend displays confidence gracefully

---

## Estimated Fix Time
- Critical fixes: 15-30 minutes
- Medium fixes: 15-20 minutes
- Documentation: 10-15 minutes
**Total**: ~1 hour for all fixes
