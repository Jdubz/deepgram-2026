/**
 * Type definitions for the Audio Projects API
 */

/**
 * Provider enum - unified provider type for all inference operations
 */
export enum Provider {
  LOCAL = "local",
  DEEPGRAM = "deepgram",
}

/**
 * Result of a transcription operation
 */
export interface TranscriptionResult {
  text: string;
  confidence: number; // 0-1 overall confidence score
  model: string;
  processingTimeMs: number;
  rawResponse: unknown;
}

/**
 * Topic detected in text analysis
 */
export interface TopicResult {
  topic: string;
  confidence: number; // 0-1
}

/**
 * Intent detected in text analysis
 */
export interface IntentResult {
  intent: string;
  confidence: number; // 0-1
}

/**
 * Sentiment analysis result
 * Compatible with both Deepgram format and LocalAI simplified format
 */
export interface SentimentResult {
  sentiment: "positive" | "negative" | "neutral";
  sentimentScore: number; // -1 to 1
  average: {
    sentiment: "positive" | "negative" | "neutral";
    sentimentScore: number;
  };
}

/**
 * Result of a summarization operation
 * Extended to include full text analysis when using local provider
 */
export interface SummarizationResult {
  text: string;
  confidence?: number; // 0-1 optional confidence score
  model: string;
  tokensUsed: number;
  processingTimeMs: number;
  rawResponse: unknown;
  // Extended analysis fields (populated by local provider)
  topics?: TopicResult[];
  intents?: IntentResult[];
  sentiment?: SentimentResult;
}

/**
 * Provider interface - abstraction for inference providers
 */
export interface InferenceProvider {
  name: Provider;
  transcribe(audioFilePath: string): Promise<TranscriptionResult>;
  summarize(text: string): Promise<SummarizationResult>;
  healthCheck(): Promise<boolean>;
}

/**
 * Audio file metadata
 */
export interface AudioMetadata {
  id: string;
  filename: string;
  originalFilename: string;
  mimeType: string;
  size: number;
  duration: number; // seconds
  channels?: number;
  sampleRate?: number;
  uploadedAt: Date;
  customMetadata: Record<string, string>;
  transcription?: string;
  summary?: string;
}

/**
 * Audio file with content buffer
 */
export interface AudioFile {
  metadata: AudioMetadata;
  content: Buffer;
}

export interface UploadResponse {
  id: string;
  filename: string;
  duration: number;
  size: number;
  message: string;
}

export interface ListFilesQuery {
  maxduration?: number;
  minduration?: number;
  min_confidence?: number;
  limit?: number;
  offset?: number;
}

export interface ListFilesResponse {
  files: AudioMetadata[];
  total: number;
  limit: number;
  offset: number;
}

export interface AudioInfoResponse {
  filename: string;
  duration: number;
  size: number;
  // Transcript job info
  transcriptStatus: "pending" | "completed" | "failed";
  transcript: string | null;
  transcriptError: string | null;
  transcriptProvider: string | null;
  transcriptModel: string | null;
  transcriptConfidence: number | null;
  // Summary job info
  summaryStatus: "pending" | "completed" | "failed";
  summary: string | null;
  summaryError: string | null;
  summaryProvider: string | null;
  summaryModel: string | null;
  summaryConfidence: number | null;
  // Text intelligence analysis
  topics: TopicResult[] | null;
  intents: IntentResult[] | null;
  sentiment: SentimentResult | null;
}
