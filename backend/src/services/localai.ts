/**
 * LocalAI Service
 *
 * Unified client for LocalAI inference - handles both:
 * - Speech-to-text (Whisper models via /v1/audio/transcriptions)
 * - Text generation (LLM via /v1/chat/completions)
 *
 * LocalAI provides an OpenAI-compatible API, so this uses standard
 * OpenAI endpoint patterns.
 *
 * Key features:
 * - Model availability checking before inference
 * - Streaming support for LLM calls with heartbeat tracking
 * - Proper error handling for model loading failures
 */

import fs from "fs";
import path from "path";
import {
  Provider,
  InferenceProvider,
  TranscriptionResult,
  SummarizationResult,
} from "../types/index.js";
import { AUDIO_CONTENT_TYPE_MAP, SUMMARIZATION_SYSTEM_PROMPT } from "../constants.js";

/**
 * Heartbeat callback for tracking job progress during streaming
 */
export type HeartbeatCallback = (tokenCount: number, partialText: string) => void;

export interface LocalAIConfig {
  baseUrl: string;
  whisperModel: string;
  llmModel: string;
  timeoutMs: number;
}

const DEFAULT_CONFIG: LocalAIConfig = {
  baseUrl: process.env.LOCALAI_URL || "http://localhost:8080",
  whisperModel: process.env.LOCALAI_WHISPER_MODEL || "whisper-1",
  llmModel: process.env.LOCALAI_LLM_MODEL || "qwen2.5-7b",
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
    const mimeType = AUDIO_CONTENT_TYPE_MAP[ext] || "audio/wav";

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
        confidence: 0.85, // LocalAI doesn't provide confidence, use reasonable default
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
              { role: "system", content: SUMMARIZATION_SYSTEM_PROMPT },
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
        confidence: 0.80, // Optional: LocalAI doesn't provide confidence for summaries
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
   * Check if a specific model is loaded and available for inference
   * This is different from healthCheck - server can be healthy but model not loaded
   */
  async isModelLoaded(modelName: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      try {
        const response = await fetch(`${this.config.baseUrl}/v1/models`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          return false;
        }

        interface ModelsResponse {
          data?: { id: string }[];
        }
        const data = (await response.json()) as ModelsResponse;
        const models = data.data || [];

        return models.some((m) => m.id === modelName || m.id.includes(modelName));
      } finally {
        clearTimeout(timeoutId);
      }
    } catch {
      return false;
    }
  }

  /**
   * Verify both models (whisper + LLM) are loaded before processing
   * Returns { loaded: boolean, missing: string[] }
   */
  async verifyModelsLoaded(): Promise<{ loaded: boolean; missing: string[] }> {
    const missing: string[] = [];

    const whisperLoaded = await this.isModelLoaded(this.config.whisperModel);
    if (!whisperLoaded) {
      missing.push(this.config.whisperModel);
    }

    const llmLoaded = await this.isModelLoaded(this.config.llmModel);
    if (!llmLoaded) {
      missing.push(this.config.llmModel);
    }

    return { loaded: missing.length === 0, missing };
  }

  /**
   * Summarize with streaming - provides heartbeat callbacks for each token
   * This allows detecting stuck jobs by monitoring token generation
   */
  async summarizeWithHeartbeat(
    transcript: string,
    onHeartbeat?: HeartbeatCallback
  ): Promise<SummarizationResult> {
    const startTime = Date.now();

    // First verify the model is loaded
    const llmLoaded = await this.isModelLoaded(this.config.llmModel);
    if (!llmLoaded) {
      throw new Error(
        `Model '${this.config.llmModel}' is not loaded. ` +
        `Server is healthy but model failed to load. ` +
        `Check LocalAI logs for model loading errors.`
      );
    }

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
              { role: "system", content: SUMMARIZATION_SYSTEM_PROMPT },
              { role: "user", content: `Summarize this transcript:\n\n${transcript}` },
            ],
            temperature: 0.3,
            max_tokens: 500,
            stream: true, // Enable streaming for heartbeat tracking
          }),
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`LocalAI summarization failed: ${response.status} - ${error}`);
      }

      // Process streaming response
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body for streaming");
      }

      const decoder = new TextDecoder();
      let fullText = "";
      let tokenCount = 0;
      let lastChunkTime = Date.now();

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n").filter((line) => line.trim() !== "");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);

            if (data === "[DONE]") {
              continue;
            }

            try {
              interface StreamChunk {
                choices?: { delta?: { content?: string } }[];
              }
              const parsed = JSON.parse(data) as StreamChunk;
              const content = parsed.choices?.[0]?.delta?.content || "";

              if (content) {
                fullText += content;
                tokenCount++;
                lastChunkTime = Date.now();

                // Call heartbeat callback with progress
                if (onHeartbeat) {
                  onHeartbeat(tokenCount, fullText);
                }
              }
            } catch {
              // Skip malformed JSON chunks
            }
          }
        }

        // Check for stuck streaming (no tokens in 30 seconds)
        if (Date.now() - lastChunkTime > 30000) {
          throw new Error(
            `Streaming stalled: no tokens received for 30 seconds. ` +
            `Received ${tokenCount} tokens before stall.`
          );
        }
      }

      return {
        text: fullText,
        model: this.config.llmModel,
        tokensUsed: tokenCount,
        processingTimeMs: Date.now() - startTime,
        rawResponse: { streamed: true, tokenCount },
      };
    } finally {
      clearTimeout(timeoutId);
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
