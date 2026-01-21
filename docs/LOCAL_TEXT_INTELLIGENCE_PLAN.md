# Local Text Intelligence API Parity Plan

## Research Summary

### Your Hardware
- **GPU**: NVIDIA RTX 3080 (10GB VRAM, ~8.8GB free)
- **Current LocalAI Setup**: Whisper + Qwen2.5-7B for transcription/summarization

### Deepgram Text Intelligence Features

Deepgram's Text Intelligence API (`POST /v1/read`) provides four features powered by Task-Specific Language Models (TSLMs):

| Feature | Description | Response Format |
|---------|-------------|-----------------|
| **Summarization** | Condensed version of text | `{ summary: { text: string } }` |
| **Topic Detection** | Key topics with confidence | `{ topics: { segments: [{ topics: [{ topic, confidence_score }] }] } }` |
| **Intent Recognition** | Speaker intents (verb form) | `{ intents: { segments: [{ intents: [{ intent, confidence_score }] }] } }` |
| **Sentiment Analysis** | Per-segment sentiment (-1 to 1) | `{ sentiments: { segments: [{ sentiment, sentiment_score }] } }` |

**Constraints**: English only, pre-recorded only (no streaming), minimum 50 words for summarization.

---

## Architecture Options

### Option A: Single LLM with Structured Output (Recommended)

Use one model (Qwen2.5) to handle all tasks via JSON-structured prompts.

**Pros**:
- Already have Qwen2.5-7B loaded
- Single model = simpler memory management
- Qwen2.5 excels at structured JSON output
- Can run all 4 tasks in one inference call

**Cons**:
- Slower than specialized models
- May need prompt engineering for quality

**VRAM**: ~5-6GB for Q5_K_M quantization (fits easily in 10GB)

### Option B: Hybrid - LLM + Small Encoder Models

Use Qwen2.5 for summarization + lightweight encoder models for classification tasks.

**Pros**:
- Encoder models (BERT/DistilBERT) are fast and accurate for classification
- Can run sentiment/intent/topic in parallel
- Lower latency for simple tasks

**Cons**:
- Multiple models to manage
- ONNX runtime needed for encoder models
- More complex implementation

**VRAM**: ~5GB (Qwen2.5 Q5) + ~500MB (encoder models in ONNX)

---

## Recommended Implementation: Option A

### Model Selection

**Primary Model**: `Qwen2.5-7B-Instruct-GGUF` (Q5_K_M quantization)
- Size: ~5.5GB VRAM
- Already configured in your LocalAI setup
- Excellent at structured JSON output
- Strong reasoning for summarization

**Alternative for faster inference**: `Qwen2.5-3B-Instruct-GGUF` (Q5_K_M)
- Size: ~2.5GB VRAM
- ~2x faster inference
- Slightly lower quality but still good

### Job Structure

Create separate job types to match Deepgram's feature set:

```
Job Types:
- analyze_chunk (existing) → topics, intents, summary for stream chunks
- analyze_sentiment → sentiment analysis for text
- analyze_topics → topic detection only
- analyze_intents → intent recognition only
- summarize_text → summarization only (already exists)
```

Or consolidate into a single `analyze_text` job with options flags.

### Prompt Templates

#### Combined Analysis Prompt
```
You are a text analysis assistant. Analyze the following text and return a JSON object with these fields:

1. topics: Array of {topic: string, confidence: number} - Key discussion topics (0-1 confidence)
2. intents: Array of {intent: string, confidence: number} - Speaker intents as verbs (0-1 confidence)
3. summary: string - 1-2 sentence summary
4. sentiment: {sentiment: "positive"|"negative"|"neutral", score: number} - Overall sentiment (-1 to 1)

Text to analyze:
"""
{TEXT}
"""

Return ONLY valid JSON, no explanation:
```

#### Topic Detection Only
```
Extract the main topics from this text. Return a JSON array of objects with "topic" (string) and "confidence" (0-1 float).

Text: "{TEXT}"

Return ONLY the JSON array:
```

#### Intent Recognition Only
```
Identify the speaker's intents in this text. Intents should be verbs (e.g., "request information", "express concern", "confirm understanding").

Return a JSON array of objects with "intent" (string) and "confidence" (0-1 float).

Text: "{TEXT}"

Return ONLY the JSON array:
```

#### Sentiment Analysis Only
```
Analyze the sentiment of this text.

Return a JSON object with:
- sentiment: "positive", "negative", or "neutral"
- score: float from -1 (most negative) to 1 (most positive)

Text: "{TEXT}"

Return ONLY the JSON object:
```

---

## Implementation Plan

### Phase 1: Extend LocalAI Service (High Priority)

**File**: `backend/src/services/localai.ts`

Add method:
```typescript
interface TextAnalysisResult {
  topics: Array<{ topic: string; confidence: number }>;
  intents: Array<{ intent: string; confidence: number }>;
  summary: string;
  sentiment: { sentiment: 'positive' | 'negative' | 'neutral'; score: number } | null;
  processingTimeMs: number;
}

async analyzeText(
  text: string,
  options?: { topics?: boolean; intents?: boolean; summarize?: boolean; sentiment?: boolean }
): Promise<TextAnalysisResult>
```

### Phase 2: Add Prompt Templates (High Priority)

**File**: `backend/src/constants.ts`

Add prompts for each analysis type:
```typescript
export const TEXT_ANALYSIS_PROMPT = `...`;
export const TOPIC_DETECTION_PROMPT = `...`;
export const INTENT_RECOGNITION_PROMPT = `...`;
export const SENTIMENT_ANALYSIS_PROMPT = `...`;
```

### Phase 3: Update Job Processor (Medium Priority)

**File**: `backend/src/services/job-processor.ts`

Modify `processAnalyzeChunkJob` to:
1. Check provider (deepgram vs local)
2. Call appropriate service based on provider
3. Parse JSON response from LocalAI

### Phase 4: Provider Selection (Medium Priority)

**File**: `backend/src/services/inference-queue.ts`

Add provider field to analyze_chunk jobs, defaulting to current configuration.

### Phase 5: Response Normalization (Medium Priority)

Create a shared interface that normalizes responses from both Deepgram and LocalAI:

```typescript
interface NormalizedAnalysis {
  topics: Array<{ topic: string; confidence: number }>;
  intents: Array<{ intent: string; confidence: number }>;
  summary: string;
  sentiment: SentimentResult | null;
  provider: 'deepgram' | 'local';
  model: string;
  processingTimeMs: number;
}
```

---

## Alternative: Specialized Small Models

If LLM-based analysis is too slow, consider these specialized models:

### For Sentiment Analysis
- **DistilBERT-base-uncased-finetuned-sst-2** (~250MB)
- **cardiffnlp/twitter-roberta-base-sentiment** (~500MB)

### For Topic/Intent (Zero-Shot Classification)
- **facebook/bart-large-mnli** (~1.6GB) - Best quality
- **MoritzLaurer/deberta-v3-base-zeroshot-v2.0** (~700MB) - Good balance
- **typeform/distilbert-base-uncased-mnli** (~250MB) - Fastest

### Running Encoder Models
LocalAI supports transformers models. You could:
1. Use ONNX-optimized versions for CPU inference
2. Run alongside Qwen2.5 (they're small enough)
3. Create separate endpoints in LocalAI config

---

## Performance Considerations

### Latency Comparison (Estimated)

| Task | Deepgram API | Qwen2.5-7B Local | Specialized Model |
|------|-------------|------------------|-------------------|
| Summarization | ~500ms | ~2-3s | N/A (use LLM) |
| Topic Detection | ~300ms | ~1-2s | ~100ms (zero-shot) |
| Intent Recognition | ~300ms | ~1-2s | ~100ms (zero-shot) |
| Sentiment | ~200ms | ~1s | ~50ms (fine-tuned) |
| Combined Analysis | ~800ms | ~3-4s | N/A |

### Throughput
- Qwen2.5-7B Q5: ~15-20 tokens/sec on RTX 3080
- Typical analysis output: ~100-200 tokens
- Expected: ~5-10 seconds per chunk for full analysis

### Optimization Strategies
1. **Batch processing**: Analyze multiple chunks in one prompt
2. **Caching**: Cache analysis for identical text
3. **Async processing**: Already using job queue
4. **Quantization**: Q4_K_M for speed vs Q5_K_M for quality

---

## Files to Modify

| File | Changes | Priority |
|------|---------|----------|
| `backend/src/services/localai.ts` | Add `analyzeText()` method | High |
| `backend/src/constants.ts` | Add analysis prompt templates | High |
| `backend/src/services/job-processor.ts` | Update `processAnalyzeChunkJob` for provider selection | Medium |
| `backend/src/types/index.ts` | Add shared analysis interfaces | Medium |
| `backend/src/services/inference-queue.ts` | Add provider to analyze jobs | Low |

---

## Testing Strategy

1. **Unit tests**: Mock LocalAI responses, verify JSON parsing
2. **Integration tests**: Compare LocalAI vs Deepgram outputs on same text
3. **Quality benchmarks**: Run on sample transcripts, measure accuracy
4. **Performance tests**: Measure latency under load

---

## Summary

**Recommended Approach**: Use existing Qwen2.5-7B with structured JSON prompts for all text intelligence features. This:

- Requires minimal new infrastructure (already have the model)
- Provides feature parity with Deepgram
- Fits comfortably in 10GB VRAM
- Can be optimized later with specialized models if needed

**Estimated Implementation Time**:
- Phase 1-2 (Core functionality): 2-3 hours
- Phase 3-5 (Full integration): 2-3 hours
- Testing & tuning: 2-4 hours

---

## Sources

- [Deepgram Text Intelligence Overview](https://developers.deepgram.com/docs/text-intelligence-feature-overview)
- [Deepgram Intent Recognition](https://developers.deepgram.com/docs/intent-recognition)
- [Deepgram Summarization](https://developers.deepgram.com/docs/summarization)
- [Qwen2.5 Blog - JSON Output](https://qwenlm.github.io/blog/qwen2.5/)
- [Qwen2.5-7B GGUF on HuggingFace](https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF)
- [LocalAI Model Gallery](https://localai.io/gallery.html)
- [Zero-Shot Classification with NLI](https://jaketae.github.io/study/zero-shot-classification/)
- [HuggingFace Text Classification Models](https://huggingface.co/models?pipeline_tag=text-classification)
