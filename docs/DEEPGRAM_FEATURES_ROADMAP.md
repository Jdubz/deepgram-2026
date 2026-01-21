# Deepgram Features Roadmap

## Current Implementation Status

### Streaming (Real-time STT) - `deepgram-stream.ts`
- [x] Nova-2 model
- [x] Speaker diarization (`diarize=true`)
- [x] Smart formatting (`smart_format=true`)
- [x] Punctuation (`punctuate=true`)
- [x] Interim results (`interim_results=true`)
- [x] Utterance end detection (`utterance_end_ms=1500`)
- [x] Endpointing (`endpointing=300`)

### Text Intelligence (Chunk Analysis) - `deepgram.ts`
- [x] Topic detection (`topics=true`)
- [x] Intent recognition (`intents=true`)
- [x] Summarization v2 (`summarize=v2`)

---

## Features to Add

### Priority 1: High-Value Interview Demo Features

#### 1. Sentiment Analysis (Text Intelligence)
**Why**: Show emotional tone shifts during interview - nervous start, confident answers, excitement about topics.

**Implementation**:
```typescript
// In deepgram.ts analyzeText()
params.append("sentiment", "true");

// Response structure
interface SentimentSegment {
  text: string;
  start_word: number;
  end_word: number;
  sentiment: "positive" | "negative" | "neutral";
  sentiment_score: number; // -1 to 1
}
```

**Database**: Add `sentiment` column to `stream_chunks` table (JSON array)

**Frontend**: Color-code chunks or add sentiment indicator (green/yellow/red)

#### 2. Entity Detection (Streaming)
**Why**: Real-time extraction of company names, technologies, locations, people mentioned.

**Implementation**:
```typescript
// In deepgram-stream.ts connect()
params.set("detect_entities", "true");

// Response includes entities in each transcript segment
interface Entity {
  entity: string;        // "Google", "Python", "San Francisco"
  type: string;          // "organization", "programming_language", "location"
  confidence: number;
}
```

**Note**: Requires Nova-3 model for streaming entity detection.

**Frontend**: Highlight entities inline or show entity summary panel

#### 3. Upgrade to Nova-3 Model
**Why**: Better accuracy, required for streaming entity detection.

**Implementation**:
```typescript
// In deepgram-stream.ts DEFAULT_CONFIG
model: "nova-3",  // was "nova-2"
```

### Priority 2: Nice-to-Have Features

#### 4. Filler Words Detection
**Why**: Analyze speech patterns, show nervous "um"s and "uh"s.

**Implementation**:
```typescript
// In deepgram-stream.ts connect()
params.set("filler_words", "true");
```

**Frontend**: Toggle to show/hide filler words, count filler word frequency

#### 5. Custom Topics
**Why**: Detect interview-specific topics like "salary", "remote work", "growth opportunities".

**Implementation**:
```typescript
// In deepgram.ts analyzeText()
params.append("custom_topic", "compensation");
params.append("custom_topic", "remote work");
params.append("custom_topic", "career growth");
params.append("custom_topic_mode", "extended"); // or "strict"
```

### Priority 3: Optional/Specialized Features

#### 6. PII Redaction
**Why**: Privacy protection if sharing transcripts.

**Implementation**:
```typescript
// In deepgram-stream.ts connect()
params.set("redact", "pci");      // Credit cards
params.set("redact", "ssn");      // Social security
params.set("redact", "phone");    // Phone numbers
```

#### 7. PHI Redaction (Healthcare)
**Why**: HIPAA compliance for medical interviews.

**Implementation**:
```typescript
params.set("redact", "phi");  // conditions, drugs, injuries, etc.
```

#### 8. Multichannel Audio
**Why**: Separate audio channels per speaker (cleaner than diarization).

**Implementation**:
```typescript
params.set("multichannel", "true");
params.set("channels", "2");
```

**Note**: Requires stereo audio input with speakers on separate channels.

---

## Implementation Plan

### Phase 1: Quick Wins (1-2 hours)
1. Upgrade model from `nova-2` to `nova-3`
2. Add `sentiment=true` to text analysis
3. Update database schema for sentiment data
4. Display sentiment in frontend

### Phase 2: Entity Detection (2-3 hours)
1. Add `detect_entities=true` to streaming config
2. Parse entity data from transcript segments
3. Store entities with chunks
4. Display entities in frontend (inline highlights or panel)

### Phase 3: Enhanced Analysis (1-2 hours)
1. Add filler words option
2. Add custom topics for interview context
3. Frontend toggles for these features

---

## Database Schema Changes

```sql
-- Migration: Add sentiment and entities to stream_chunks
ALTER TABLE stream_chunks ADD COLUMN sentiment TEXT;     -- JSON: [{text, sentiment, score}]
ALTER TABLE stream_chunks ADD COLUMN entities TEXT;      -- JSON: [{entity, type, confidence}]
ALTER TABLE stream_chunks ADD COLUMN filler_word_count INTEGER DEFAULT 0;
```

---

## API Response Examples

### Sentiment Analysis Response
```json
{
  "results": {
    "sentiments": {
      "segments": [
        {
          "text": "I'm really excited about this opportunity",
          "sentiment": "positive",
          "sentiment_score": 0.85
        }
      ],
      "average": {
        "sentiment": "positive",
        "sentiment_score": 0.72
      }
    }
  }
}
```

### Entity Detection Response (Streaming)
```json
{
  "channel": {
    "alternatives": [{
      "transcript": "I worked at Google for five years",
      "words": [...],
      "entities": [
        {
          "entity": "Google",
          "type": "organization",
          "confidence": 0.95,
          "start_word": 3,
          "end_word": 3
        }
      ]
    }]
  }
}
```

---

## References

- [STT Streaming Features](https://developers.deepgram.com/docs/stt-streaming-feature-overview)
- [STT Intelligence Features](https://developers.deepgram.com/docs/stt-intelligence-feature-overview)
- [Entity Detection Docs](https://developers.deepgram.com/docs/detect-entities)
- [Sentiment Analysis Docs](https://developers.deepgram.com/docs/sentiment-analysis)
- [Text Intelligence API](https://developers.deepgram.com/docs/text-intelligence)
- [Redaction Docs](https://developers.deepgram.com/docs/redaction)
