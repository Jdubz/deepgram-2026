/**
 * Type definitions for the Audio Projects API
 *
 * STUDY EXERCISE: Review these types and understand how they map
 * to the API requirements from the interview prompt.
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
}

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
  summary: string;
  // TODO (Exercise 2): Add more fields for the LLM response
}

/**
 * TODO (Exercise 4 - Multi-Provider Architecture):
 * Define interfaces for LLM providers
 */
export interface LLMProvider {
  name: string;
  // Add methods: summarize, etc.
}

export interface LLMResponse {
  text: string;
  tokensUsed: number;
  model: string;
  latencyMs: number;
}
