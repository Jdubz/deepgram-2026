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
 * - Structured JSON output with Zod validation for text analysis
 * - Fallback handling for malformed LLM responses
 */

import fs from "fs";
import path from "path";
import { z } from "zod";
import {
  Provider,
  InferenceProvider,
  TranscriptionResult,
  SummarizationResult,
  TopicResult,
  IntentResult,
  SentimentResult,
} from "../types/index.js";
import {
  AUDIO_CONTENT_TYPE_MAP,
  TEXT_ANALYSIS_SYSTEM_PROMPT,
  TEXT_ANALYSIS_USER_PROMPT,
  SUMMARIZATION_FALLBACK_PROMPT,
} from "../constants.js";

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

// Zod schemas for validating LLM JSON output
const TopicSchema = z.object({
  topic: z.string(),
  confidence: z.number().min(0).max(1),
});

const IntentSchema = z.object({
  intent: z.string(),
  confidence: z.number().min(0).max(1),
});

const SentimentSchema = z.object({
  sentiment: z.enum(["positive", "negative", "neutral"]),
  // Accept either 'score' or 'sentimentScore' from LLM, normalize to sentimentScore
  score: z.number().min(-1).max(1).optional(),
  sentimentScore: z.number().min(-1).max(1).optional(),
}).transform((data) => ({
  sentiment: data.sentiment,
  sentimentScore: data.sentimentScore ?? data.score ?? 0,
  average: {
    sentiment: data.sentiment,
    sentimentScore: data.sentimentScore ?? data.score ?? 0,
  },
}));

const TextAnalysisResponseSchema = z.object({
  summary: z.string(),
  topics: z.array(TopicSchema).optional().default([]),
  intents: z.array(IntentSchema).optional().default([]),
  sentiment: SentimentSchema.optional(),
});

type TextAnalysisResponse = z.infer<typeof TextAnalysisResponseSchema>;

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
   * Extract JSON from LLM response that may contain markdown or extra text
   */
  private extractJson(text: string): string {
    // Try to find JSON in markdown code blocks
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }

    // Try to find JSON object directly
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return jsonMatch[0];
    }

    return text.trim();
  }

  /**
   * Parse and validate the LLM response as structured analysis
   * Returns null if parsing fails
   */
  private parseAnalysisResponse(content: string): TextAnalysisResponse | null {
    try {
      const jsonStr = this.extractJson(content);
      const parsed = JSON.parse(jsonStr);
      const validated = TextAnalysisResponseSchema.parse(parsed);
      return validated;
    } catch (error) {
      console.warn("[LocalAI] Failed to parse analysis response:", error);
      return null;
    }
  }

  /**
   * Make a chat completion request to LocalAI
   */
  private async chatCompletion(
    systemPrompt: string,
    userPrompt: string,
    options: { temperature?: number; maxTokens?: number } = {}
  ): Promise<{ content: string; tokensUsed: number; rawResponse: unknown }> {
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
              { role: "user", content: userPrompt },
            ],
            temperature: options.temperature ?? 0.3,
            max_tokens: options.maxTokens ?? 800,
          }),
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`LocalAI chat completion failed: ${response.status} - ${error}`);
      }

      interface ChatCompletionResponse {
        choices?: { message?: { content?: string } }[];
        usage?: { total_tokens?: number };
      }
      const rawResponse = (await response.json()) as ChatCompletionResponse;

      return {
        content: rawResponse.choices?.[0]?.message?.content || "",
        tokensUsed: rawResponse.usage?.total_tokens || 0,
        rawResponse,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Generate summary and full text analysis using LocalAI's chat completions
   * Returns structured analysis with topics, intents, sentiment, and summary
   * Falls back to plain summary if JSON parsing fails
   */
  async summarize(transcript: string): Promise<SummarizationResult> {
    const startTime = Date.now();

    // Try structured analysis first
    const userPrompt = TEXT_ANALYSIS_USER_PROMPT.replace("{TEXT}", transcript);
    const { content, tokensUsed, rawResponse } = await this.chatCompletion(
      TEXT_ANALYSIS_SYSTEM_PROMPT,
      userPrompt,
      { temperature: 0.3, maxTokens: 800 }
    );

    // Try to parse as structured JSON
    const analysis = this.parseAnalysisResponse(content);

    if (analysis) {
      // Successfully parsed structured response
      return {
        text: analysis.summary,
        confidence: 0.85,
        model: this.config.llmModel,
        tokensUsed,
        processingTimeMs: Date.now() - startTime,
        rawResponse,
        topics: analysis.topics as TopicResult[],
        intents: analysis.intents as IntentResult[],
        sentiment: analysis.sentiment as SentimentResult | undefined,
      };
    }

    // Fallback: try a simpler summarization prompt
    console.warn("[LocalAI] Structured analysis failed, falling back to simple summary");
    const fallbackPrompt = SUMMARIZATION_FALLBACK_PROMPT.replace("{TEXT}", transcript);
    const fallbackResult = await this.chatCompletion(
      "You are a helpful assistant that summarizes text concisely.",
      fallbackPrompt,
      { temperature: 0.3, maxTokens: 300 }
    );

    return {
      text: fallbackResult.content.trim(),
      confidence: 0.70, // Lower confidence for fallback
      model: this.config.llmModel,
      tokensUsed: tokensUsed + fallbackResult.tokensUsed,
      processingTimeMs: Date.now() - startTime,
      rawResponse: { primary: rawResponse, fallback: fallbackResult.rawResponse },
      // No structured fields in fallback mode
    };
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
   * Note: Returns structured analysis like summarize() but with streaming
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
      const userPrompt = TEXT_ANALYSIS_USER_PROMPT.replace("{TEXT}", transcript);

      const response = await fetch(
        `${this.config.baseUrl}/v1/chat/completions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: this.config.llmModel,
            messages: [
              { role: "system", content: TEXT_ANALYSIS_SYSTEM_PROMPT },
              { role: "user", content: userPrompt },
            ],
            temperature: 0.3,
            max_tokens: 800,
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

      // Parse the accumulated response
      const analysis = this.parseAnalysisResponse(fullText);

      if (analysis) {
        return {
          text: analysis.summary,
          confidence: 0.85,
          model: this.config.llmModel,
          tokensUsed: tokenCount,
          processingTimeMs: Date.now() - startTime,
          rawResponse: { streamed: true, tokenCount },
          topics: analysis.topics as TopicResult[],
          intents: analysis.intents as IntentResult[],
          sentiment: analysis.sentiment as SentimentResult | undefined,
        };
      }

      // Fallback if parsing failed - use raw text as summary
      console.warn("[LocalAI] Streaming: structured analysis failed, using raw text");
      return {
        text: fullText.slice(0, 500), // Truncate to reasonable summary length
        confidence: 0.60,
        model: this.config.llmModel,
        tokensUsed: tokenCount,
        processingTimeMs: Date.now() - startTime,
        rawResponse: { streamed: true, tokenCount, parseError: true },
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
