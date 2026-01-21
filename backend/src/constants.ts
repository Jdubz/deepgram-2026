/**
 * Application constants
 *
 * Centralized location for all magic numbers and shared configuration values.
 */

/**
 * Maximum file size for audio uploads (100MB)
 */
export const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;

/**
 * Allowed MIME types for audio uploads
 */
export const ALLOWED_AUDIO_MIME_TYPES = new Set([
  "audio/wav",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp3",
  "audio/ogg",
  "audio/flac",
  "audio/webm",
  "audio/mp4",
  "audio/aac",
]);

/**
 * Maps file extensions to content types for audio files.
 * Used when making API requests that require explicit content type headers.
 */
export const AUDIO_CONTENT_TYPE_MAP: Record<string, string> = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".webm": "audio/webm",
  ".mp4": "audio/mp4",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
};

/**
 * Average bitrates for duration estimation (bits per second)
 * Used as fallback when audio metadata doesn't contain duration
 */
export const AVERAGE_AUDIO_BITRATES: Record<string, number> = {
  FLAC: 800000,    // ~800 kbps for CD-quality FLAC
  MP3: 192000,     // 192 kbps average
  OGG: 160000,     // 160 kbps average
  AAC: 128000,     // 128 kbps average
  WAV: 1411200,    // CD-quality uncompressed (44.1kHz * 16bit * 2ch)
};

/**
 * System prompt for audio summarization (basic - used by Deepgram provider)
 */
export const SUMMARIZATION_SYSTEM_PROMPT = `You are a helpful assistant that summarizes audio transcripts.
Provide a concise summary including:
- Main topics discussed
- Key points and takeaways
- Overall sentiment/tone
Keep the summary under 200 words.`;

/**
 * System prompt for full text analysis (used by local provider)
 * Returns structured JSON with summary, topics, intents, and sentiment
 */
export const TEXT_ANALYSIS_SYSTEM_PROMPT = `You are a text analysis assistant. You analyze transcripts and return structured JSON.

You MUST respond with ONLY a valid JSON object, no other text. The JSON must have this exact structure:
{
  "summary": "1-2 sentence summary of the main points",
  "topics": [{"topic": "topic name", "confidence": 0.0-1.0}],
  "intents": [{"intent": "verb phrase describing intent", "confidence": 0.0-1.0}],
  "sentiment": {"sentiment": "positive|negative|neutral", "sentimentScore": -1.0 to 1.0}
}

Guidelines:
- summary: Concise 1-2 sentences capturing the essence
- topics: 1-5 key discussion topics, confidence 0-1
- intents: 1-3 speaker intentions as verb phrases (e.g., "request information", "explain concept"), confidence 0-1
- sentiment: overall emotional tone, sentimentScore from -1 (very negative) to 1 (very positive)

Return ONLY the JSON object, no markdown, no explanation.`;

/**
 * User prompt template for text analysis
 */
export const TEXT_ANALYSIS_USER_PROMPT = `Analyze this transcript:

"""
{TEXT}
"""`;

/**
 * Fallback prompt for simpler summarization if JSON parsing fails
 */
export const SUMMARIZATION_FALLBACK_PROMPT = `Summarize this transcript in 1-2 sentences:

"""
{TEXT}
"""

Summary:`;

/**
 * Job processor configuration
 */
export const JOB_PROCESSOR_CONFIG = {
  /** Polling interval for checking new jobs (ms) */
  POLL_INTERVAL_MS: 2000,
  /** Interval for checking stuck jobs (ms) */
  STUCK_CHECK_INTERVAL_MS: 30000,
  /** Default timeout for jobs (seconds) */
  DEFAULT_JOB_TIMEOUT_SECONDS: 300,
};

/**
 * API configuration
 */
export const API_CONFIG = {
  /** Default limit for list queries */
  DEFAULT_LIST_LIMIT: 100,
  /** Maximum limit for list queries */
  MAX_LIST_LIMIT: 1000,
  /** Default limit for job list queries */
  DEFAULT_JOBS_LIMIT: 50,
};
