/**
 * Deepgram Service
 *
 * Provides inference capabilities using Deepgram APIs:
 * - Speech-to-text transcription via /v1/listen
 * - Text summarization via Text Intelligence API /v1/read
 */

import fs from "fs";
import path from "path";
import {
  Provider,
  InferenceProvider,
  TranscriptionResult,
  SummarizationResult,
} from "../types/index.js";

export interface DeepgramConfig {
  apiKey: string;
  baseUrl: string;
  transcriptionModel: string;
  language: string;
  timeoutMs: number;
}

const DEFAULT_CONFIG: DeepgramConfig = {
  apiKey: process.env.DEEPGRAM_API_KEY || "",
  baseUrl: "https://api.deepgram.com",
  transcriptionModel: process.env.DEEPGRAM_MODEL || "nova-2",
  language: process.env.DEEPGRAM_LANGUAGE || "en",
  timeoutMs: 300000, // 5 minutes for long audio
};

class DeepgramService implements InferenceProvider {
  public readonly name = Provider.DEEPGRAM;
  private config: DeepgramConfig;

  constructor(config: Partial<DeepgramConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Transcribe audio file using Deepgram's STT API
   * POST /v1/listen
   */
  async transcribe(audioFilePath: string): Promise<TranscriptionResult> {
    if (!this.config.apiKey) {
      throw new Error("Deepgram API key not configured. Set DEEPGRAM_API_KEY environment variable.");
    }

    const startTime = Date.now();

    // Read file
    const fileBuffer = fs.readFileSync(audioFilePath);

    // Determine content type from extension
    const ext = path.extname(audioFilePath).toLowerCase();
    const contentTypes: Record<string, string> = {
      ".wav": "audio/wav",
      ".mp3": "audio/mpeg",
      ".flac": "audio/flac",
      ".ogg": "audio/ogg",
      ".m4a": "audio/mp4",
      ".webm": "audio/webm",
    };
    const contentType = contentTypes[ext] || "audio/wav";

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const params = new URLSearchParams({
        model: this.config.transcriptionModel,
        language: this.config.language,
        punctuate: "true",
        paragraphs: "true",
      });

      const response = await fetch(
        `${this.config.baseUrl}/v1/listen?${params}`,
        {
          method: "POST",
          headers: {
            Authorization: `Token ${this.config.apiKey}`,
            "Content-Type": contentType,
          },
          body: fileBuffer,
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Deepgram transcription failed: ${response.status} - ${error}`);
      }

      const rawResponse = await response.json();

      // Extract transcript from Deepgram response
      interface DeepgramTranscriptionResponse {
        results?: {
          channels?: {
            alternatives?: {
              transcript?: string;
              confidence?: number;
            }[];
          }[];
        };
        metadata?: {
          model_uuid?: string;
          model_info?: { name?: string };
        };
      }

      const dgResponse = rawResponse as DeepgramTranscriptionResponse;
      const transcript =
        dgResponse.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
      const modelName =
        dgResponse.metadata?.model_info?.name ||
        `deepgram-${this.config.transcriptionModel}`;

      return {
        text: transcript,
        model: modelName,
        processingTimeMs: Date.now() - startTime,
        rawResponse,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Summarize text using Deepgram's Text Intelligence API
   * POST /v1/read
   *
   * Uses the summarize feature of the Text Intelligence API
   */
  async summarize(text: string): Promise<SummarizationResult> {
    if (!this.config.apiKey) {
      throw new Error("Deepgram API key not configured. Set DEEPGRAM_API_KEY environment variable.");
    }

    const startTime = Date.now();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const params = new URLSearchParams({
        summarize: "v2",
        language: this.config.language,
      });

      const response = await fetch(
        `${this.config.baseUrl}/v1/read?${params}`,
        {
          method: "POST",
          headers: {
            Authorization: `Token ${this.config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text }),
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Deepgram summarization failed: ${response.status} - ${error}`);
      }

      const rawResponse = await response.json();

      // Extract summary from Deepgram Text Intelligence response
      interface DeepgramReadResponse {
        results?: {
          summary?: {
            text?: string;
          };
        };
        metadata?: {
          request_id?: string;
        };
      }

      const dgResponse = rawResponse as DeepgramReadResponse;
      const summary = dgResponse.results?.summary?.text || "";

      // Approximate token count (Deepgram doesn't return this for text intelligence)
      const tokensUsed = Math.ceil(text.split(/\s+/).length * 1.3);

      return {
        text: summary,
        model: "deepgram-text-intelligence",
        tokensUsed,
        processingTimeMs: Date.now() - startTime,
        rawResponse,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Health check - verify Deepgram API is accessible
   */
  async healthCheck(): Promise<boolean> {
    if (!this.config.apiKey) {
      return false;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      try {
        // Use projects endpoint to verify API key is valid
        const response = await fetch(`${this.config.baseUrl}/v1/projects`, {
          headers: {
            Authorization: `Token ${this.config.apiKey}`,
          },
          signal: controller.signal,
        });
        return response.ok;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch {
      return false;
    }
  }

  /**
   * Get current configuration (without exposing API key)
   */
  getConfig(): Omit<DeepgramConfig, "apiKey"> & { apiKeyConfigured: boolean } {
    const { apiKey, ...rest } = this.config;
    return {
      ...rest,
      apiKeyConfigured: !!apiKey,
    };
  }
}

// Export singleton instance
export const deepgram = new DeepgramService();

// Also export the class for custom instances
export { DeepgramService };
