/**
 * LocalAI Service
 *
 * Unified client for LocalAI inference - handles both:
 * - Speech-to-text (Whisper models via /v1/audio/transcriptions)
 * - Text generation (LLM via /v1/chat/completions)
 *
 * LocalAI provides an OpenAI-compatible API, so this uses standard
 * OpenAI endpoint patterns.
 */

import fs from "fs";
import path from "path";
import {
  Provider,
  InferenceProvider,
  TranscriptionResult,
  SummarizationResult,
} from "../types/index.js";

export interface LocalAIConfig {
  baseUrl: string;
  whisperModel: string;
  llmModel: string;
  timeoutMs: number;
}

const DEFAULT_CONFIG: LocalAIConfig = {
  baseUrl: process.env.LOCALAI_URL || "http://localhost:8080",
  whisperModel: process.env.LOCALAI_WHISPER_MODEL || "whisper-1",
  llmModel: process.env.LOCALAI_LLM_MODEL || "llama3",
  timeoutMs: 300000, // 5 minutes for long audio
};

class LocalAIService implements InferenceProvider {
  public readonly name = Provider.LOCAL;
  private config: LocalAIConfig;

  constructor(config: Partial<LocalAIConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Transcribe audio file using LocalAI's Whisper endpoint
   * POST /v1/audio/transcriptions (OpenAI-compatible)
   */
  async transcribe(audioFilePath: string): Promise<TranscriptionResult> {
    const startTime = Date.now();

    // Read file and create form data
    const fileBuffer = fs.readFileSync(audioFilePath);
    const fileName = path.basename(audioFilePath);

    // Determine MIME type from extension
    const ext = path.extname(audioFilePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".wav": "audio/wav",
      ".mp3": "audio/mpeg",
      ".flac": "audio/flac",
      ".ogg": "audio/ogg",
      ".m4a": "audio/mp4",
      ".webm": "audio/webm",
    };
    const mimeType = mimeTypes[ext] || "audio/wav";

    // Create FormData with file
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: mimeType });
    formData.append("file", blob, fileName);
    formData.append("model", this.config.whisperModel);
    formData.append("response_format", "json");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(
        `${this.config.baseUrl}/v1/audio/transcriptions`,
        {
          method: "POST",
          body: formData,
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`LocalAI transcription failed: ${response.status} - ${error}`);
      }

      const rawResponse = await response.json();

      return {
        text: (rawResponse as { text?: string }).text || "",
        model: this.config.whisperModel,
        processingTimeMs: Date.now() - startTime,
        rawResponse,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Generate summary using LocalAI's chat completions endpoint
   * POST /v1/chat/completions (OpenAI-compatible)
   */
  async summarize(transcript: string): Promise<SummarizationResult> {
    const startTime = Date.now();

    const systemPrompt = `You are a helpful assistant that summarizes audio transcripts.
Provide a concise summary including:
- Main topics discussed
- Key points and takeaways
- Overall sentiment/tone
Keep the summary under 200 words.`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(
        `${this.config.baseUrl}/v1/chat/completions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: this.config.llmModel,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: `Summarize this transcript:\n\n${transcript}` },
            ],
            temperature: 0.3,
            max_tokens: 500,
          }),
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`LocalAI summarization failed: ${response.status} - ${error}`);
      }

      interface ChatCompletionResponse {
        choices?: { message?: { content?: string } }[];
        usage?: { total_tokens?: number };
      }
      const rawResponse = (await response.json()) as ChatCompletionResponse;

      return {
        text: rawResponse.choices?.[0]?.message?.content || "",
        model: this.config.llmModel,
        tokensUsed: rawResponse.usage?.total_tokens || 0,
        processingTimeMs: Date.now() - startTime,
        rawResponse,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Health check - verify LocalAI is running
   */
  async healthCheck(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      try {
        const response = await fetch(`${this.config.baseUrl}/readyz`, {
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
   * Get current configuration
   */
  getConfig(): LocalAIConfig {
    return { ...this.config };
  }
}

// Export singleton instance
export const localAI = new LocalAIService();

// Also export the class for custom instances
export { LocalAIService };
