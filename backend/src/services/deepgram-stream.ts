/**
 * Deepgram Streaming Service
 *
 * Manages WebSocket connection to Deepgram's real-time transcription API.
 * Supports speaker diarization for multi-speaker transcription.
 */

import WebSocket from "ws";

const DEEPGRAM_WS_URL = "wss://api.deepgram.com/v1/listen";

export interface StreamingConfig {
  apiKey: string;
  model?: string;
  language?: string;
  punctuate?: boolean;
  diarize?: boolean;
  interimResults?: boolean;
  endpointing?: number;
  sampleRate?: number;
  channels?: number;
  encoding?: string;
}

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
  speaker?: number;
  speakerConfidence?: number;
}

export interface TranscriptSegment {
  text: string;
  speaker: number | null;
  confidence: number;
  isFinal: boolean;
  words: TranscriptWord[];
  start: number;
  duration: number;
}

export interface DeepgramStreamEvents {
  onTranscript: (segment: TranscriptSegment) => void;
  onError: (error: Error) => void;
  onClose: () => void;
  onOpen: () => void;
}

const DEFAULT_CONFIG: Partial<StreamingConfig> = {
  model: "nova-2",
  language: "en",
  punctuate: true,
  diarize: true,
  interimResults: true,
  endpointing: 300,
  sampleRate: 16000,
  channels: 1,
  encoding: "linear16",
};

export class DeepgramStream {
  private ws: WebSocket | null = null;
  private config: StreamingConfig;
  private events: DeepgramStreamEvents;
  private isConnected = false;

  constructor(config: StreamingConfig, events: DeepgramStreamEvents) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.events = events;
  }

  connect(): void {
    if (this.ws) {
      this.close();
    }

    const params = new URLSearchParams({
      model: this.config.model!,
      language: this.config.language!,
      punctuate: String(this.config.punctuate),
      diarize: String(this.config.diarize),
      interim_results: String(this.config.interimResults),
      endpointing: String(this.config.endpointing),
      encoding: this.config.encoding!,
      sample_rate: String(this.config.sampleRate),
      channels: String(this.config.channels),
    });

    const url = `${DEEPGRAM_WS_URL}?${params}`;

    this.ws = new WebSocket(url, {
      headers: {
        Authorization: `Token ${this.config.apiKey}`,
      },
    });

    this.ws.on("open", () => {
      this.isConnected = true;
      console.log("[DeepgramStream] Connected to Deepgram");
      this.events.onOpen();
    });

    this.ws.on("message", (data: Buffer) => {
      try {
        const response = JSON.parse(data.toString());
        this.handleResponse(response);
      } catch (err) {
        console.error("[DeepgramStream] Failed to parse response:", err);
      }
    });

    this.ws.on("error", (err) => {
      console.error("[DeepgramStream] WebSocket error:", err);
      this.events.onError(err instanceof Error ? err : new Error(String(err)));
    });

    this.ws.on("close", (code, reason) => {
      console.log(`[DeepgramStream] Connection closed: ${code} - ${reason}`);
      this.isConnected = false;
      this.ws = null;
      this.events.onClose();
    });
  }

  private handleResponse(response: DeepgramResponse): void {
    if (response.type === "Results" && response.channel?.alternatives?.[0]) {
      const alternative = response.channel.alternatives[0];
      const transcript = alternative.transcript || "";

      if (!transcript.trim()) return;

      // Extract speaker from words if diarization is enabled
      let speaker: number | null = null;
      if (alternative.words && alternative.words.length > 0) {
        // Use the most common speaker in this segment
        const speakerCounts = new Map<number, number>();
        for (const word of alternative.words) {
          if (word.speaker !== undefined) {
            speakerCounts.set(word.speaker, (speakerCounts.get(word.speaker) || 0) + 1);
          }
        }
        if (speakerCounts.size > 0) {
          speaker = [...speakerCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
        }
      }

      const segment: TranscriptSegment = {
        text: transcript,
        speaker,
        confidence: alternative.confidence || 0,
        isFinal: response.is_final || false,
        words: (alternative.words || []).map((w) => ({
          word: w.word,
          start: w.start,
          end: w.end,
          confidence: w.confidence,
          speaker: w.speaker,
          speakerConfidence: w.speaker_confidence,
        })),
        start: response.start || 0,
        duration: response.duration || 0,
      };

      this.events.onTranscript(segment);
    }
  }

  sendAudio(audioData: Buffer): void {
    if (this.ws && this.isConnected && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(audioData);
    }
  }

  close(): void {
    if (this.ws) {
      // Send close message to signal end of audio
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "CloseStream" }));
      }
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
    }
  }

  getIsConnected(): boolean {
    return this.isConnected;
  }
}

// Deepgram response types
interface DeepgramWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
  speaker?: number;
  speaker_confidence?: number;
}

interface DeepgramAlternative {
  transcript: string;
  confidence: number;
  words?: DeepgramWord[];
}

interface DeepgramChannel {
  alternatives: DeepgramAlternative[];
}

interface DeepgramResponse {
  type: string;
  channel?: DeepgramChannel;
  is_final?: boolean;
  speech_final?: boolean;
  start?: number;
  duration?: number;
}
