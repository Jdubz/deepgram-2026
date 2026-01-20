/**
 * Stream Hub Service
 *
 * Manages WebSocket connections for real-time audio streaming:
 * - Single authenticated broadcaster sends audio
 * - Multiple viewers receive live transcription
 * - Relays audio to Deepgram and broadcasts transcripts
 */

import WebSocket from "ws";
import { DeepgramStream, TranscriptSegment } from "./deepgram-stream.js";

// Message types from clients
interface AuthMessage {
  type: "auth";
  password: string;
}

interface AudioMessage {
  type: "audio";
  data: string; // base64 encoded audio
}

interface StopMessage {
  type: "stop";
}

type BroadcasterMessage = AuthMessage | AudioMessage | StopMessage;

// Message types to clients
interface AuthSuccessMessage {
  type: "auth_success";
}

interface AuthFailedMessage {
  type: "auth_failed";
  error: string;
}

interface TranscriptMessage {
  type: "transcript";
  speaker: number | null;
  text: string;
  confidence: number;
  isFinal: boolean;
  timestamp: number;
}

interface SessionMessage {
  type: "session_started" | "session_ended";
}

interface StatusMessage {
  type: "status";
  isLive: boolean;
  viewerCount: number;
}

interface ErrorMessage {
  type: "error";
  message: string;
}

type ServerMessage =
  | AuthSuccessMessage
  | AuthFailedMessage
  | TranscriptMessage
  | SessionMessage
  | StatusMessage
  | ErrorMessage;

// Rate limiting for auth attempts
interface RateLimitEntry {
  attempts: number;
  lastAttempt: number;
}

const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const MAX_AUTH_ATTEMPTS = 5;
const MAX_VIEWERS = 50;

export class StreamHub {
  private broadcaster: WebSocket | null = null;
  private broadcasterAuthenticated = false;
  private viewers: Set<WebSocket> = new Set();
  private deepgramStream: DeepgramStream | null = null;
  private broadcastPassword: string;
  private deepgramApiKey: string;
  private rateLimitMap: Map<string, RateLimitEntry> = new Map();
  private sessionStartTime: number | null = null;

  constructor() {
    this.broadcastPassword = process.env.STREAM_PASSWORD || "";
    this.deepgramApiKey = process.env.DEEPGRAM_API_KEY || "";

    if (!this.broadcastPassword) {
      console.warn("[StreamHub] STREAM_PASSWORD not set - streaming disabled");
    }
    if (!this.deepgramApiKey) {
      console.warn("[StreamHub] DEEPGRAM_API_KEY not set - streaming will fail");
    }
  }

  /**
   * Handle a new broadcaster connection
   */
  handleBroadcaster(ws: WebSocket, clientIp: string): void {
    // Check if streaming is configured
    if (!this.broadcastPassword) {
      this.sendMessage(ws, {
        type: "error",
        message: "Streaming not configured. Set STREAM_PASSWORD environment variable.",
      });
      ws.close();
      return;
    }

    // Only one broadcaster allowed
    if (this.broadcaster && this.broadcasterAuthenticated) {
      this.sendMessage(ws, {
        type: "error",
        message: "Another broadcaster is already connected",
      });
      ws.close();
      return;
    }

    // Replace any unauthenticated broadcaster
    if (this.broadcaster) {
      this.broadcaster.close();
    }

    this.broadcaster = ws;
    this.broadcasterAuthenticated = false;
    console.log(`[StreamHub] Broadcaster connected from ${clientIp}`);

    ws.on("message", (data: Buffer) => {
      this.handleBroadcasterMessage(ws, data, clientIp);
    });

    ws.on("close", () => {
      this.handleBroadcasterDisconnect();
    });

    ws.on("error", (err) => {
      console.error("[StreamHub] Broadcaster WebSocket error:", err);
      this.handleBroadcasterDisconnect();
    });
  }

  private handleBroadcasterMessage(ws: WebSocket, data: Buffer, clientIp: string): void {
    // If not authenticated, expect auth message (JSON)
    if (!this.broadcasterAuthenticated) {
      try {
        const message = JSON.parse(data.toString()) as BroadcasterMessage;

        if (message.type === "auth") {
          this.handleAuth(ws, message.password, clientIp);
        } else {
          this.sendMessage(ws, {
            type: "error",
            message: "Authentication required. Send auth message first.",
          });
        }
      } catch {
        this.sendMessage(ws, {
          type: "error",
          message: "Invalid message format. Expected JSON auth message.",
        });
      }
      return;
    }

    // After authentication, handle audio or control messages
    try {
      // Try to parse as JSON control message
      const message = JSON.parse(data.toString()) as BroadcasterMessage;

      if (message.type === "stop") {
        this.stopStreaming();
      } else if (message.type === "audio" && message.data) {
        // Base64 encoded audio
        const audioBuffer = Buffer.from(message.data, "base64");
        this.relayAudio(audioBuffer);
      }
    } catch {
      // Not JSON - treat as raw binary audio data
      this.relayAudio(data);
    }
  }

  private handleAuth(ws: WebSocket, password: string, clientIp: string): void {
    // Check rate limit
    const rateLimitKey = clientIp;
    const now = Date.now();
    const entry = this.rateLimitMap.get(rateLimitKey);

    if (entry) {
      // Reset if window expired
      if (now - entry.lastAttempt > RATE_LIMIT_WINDOW_MS) {
        entry.attempts = 0;
      }

      if (entry.attempts >= MAX_AUTH_ATTEMPTS) {
        this.sendMessage(ws, {
          type: "auth_failed",
          error: "Too many authentication attempts. Try again later.",
        });
        ws.close();
        return;
      }

      entry.attempts++;
      entry.lastAttempt = now;
    } else {
      this.rateLimitMap.set(rateLimitKey, { attempts: 1, lastAttempt: now });
    }

    // Validate password
    if (password !== this.broadcastPassword) {
      this.sendMessage(ws, {
        type: "auth_failed",
        error: "Invalid password",
      });
      console.log(`[StreamHub] Auth failed from ${clientIp}`);
      return;
    }

    // Authentication successful
    this.broadcasterAuthenticated = true;
    console.log(`[StreamHub] Broadcaster authenticated from ${clientIp}`);

    // Clear rate limit on success
    this.rateLimitMap.delete(rateLimitKey);

    this.sendMessage(ws, { type: "auth_success" });

    // Start Deepgram connection
    this.startDeepgramStream();

    // Notify viewers
    this.sessionStartTime = Date.now();
    this.broadcastToViewers({ type: "session_started" });
    this.broadcastStatus();
  }

  private startDeepgramStream(): void {
    if (!this.deepgramApiKey) {
      console.error("[StreamHub] Cannot start Deepgram stream - no API key");
      if (this.broadcaster) {
        this.sendMessage(this.broadcaster, {
          type: "error",
          message: "Deepgram API key not configured",
        });
      }
      return;
    }

    this.deepgramStream = new DeepgramStream(
      {
        apiKey: this.deepgramApiKey,
        model: process.env.DEEPGRAM_MODEL || "nova-2",
        language: process.env.DEEPGRAM_LANGUAGE || "en",
        diarize: true,
        interimResults: true,
      },
      {
        onTranscript: (segment) => this.handleTranscript(segment),
        onError: (error) => {
          console.error("[StreamHub] Deepgram error:", error);
          if (this.broadcaster) {
            this.sendMessage(this.broadcaster, {
              type: "error",
              message: `Deepgram error: ${error.message}`,
            });
          }
        },
        onClose: () => {
          console.log("[StreamHub] Deepgram connection closed");
        },
        onOpen: () => {
          console.log("[StreamHub] Deepgram connection established");
        },
      }
    );

    this.deepgramStream.connect();
  }

  private handleTranscript(segment: TranscriptSegment): void {
    const message: TranscriptMessage = {
      type: "transcript",
      speaker: segment.speaker,
      text: segment.text,
      confidence: segment.confidence,
      isFinal: segment.isFinal,
      timestamp: Date.now(),
    };

    // Send to broadcaster
    if (this.broadcaster && this.broadcasterAuthenticated) {
      this.sendMessage(this.broadcaster, message);
    }

    // Broadcast to all viewers
    this.broadcastToViewers(message);
  }

  private relayAudio(audioData: Buffer): void {
    if (this.deepgramStream) {
      this.deepgramStream.sendAudio(audioData);
    }
  }

  private stopStreaming(): void {
    if (this.deepgramStream) {
      this.deepgramStream.close();
      this.deepgramStream = null;
    }

    this.sessionStartTime = null;
    this.broadcastToViewers({ type: "session_ended" });
    this.broadcastStatus();

    console.log("[StreamHub] Streaming stopped by broadcaster");
  }

  private handleBroadcasterDisconnect(): void {
    console.log("[StreamHub] Broadcaster disconnected");

    if (this.deepgramStream) {
      this.deepgramStream.close();
      this.deepgramStream = null;
    }

    this.broadcaster = null;
    this.broadcasterAuthenticated = false;
    this.sessionStartTime = null;

    // Notify viewers
    this.broadcastToViewers({ type: "session_ended" });
    this.broadcastStatus();
  }

  /**
   * Handle a new viewer connection
   */
  handleViewer(ws: WebSocket): void {
    if (this.viewers.size >= MAX_VIEWERS) {
      this.sendMessage(ws, {
        type: "error",
        message: "Maximum viewer capacity reached",
      });
      ws.close();
      return;
    }

    this.viewers.add(ws);
    console.log(`[StreamHub] Viewer connected. Total viewers: ${this.viewers.size}`);

    // Send current status
    this.sendMessage(ws, {
      type: "status",
      isLive: this.broadcasterAuthenticated && !!this.deepgramStream,
      viewerCount: this.viewers.size,
    });

    ws.on("close", () => {
      this.viewers.delete(ws);
      console.log(`[StreamHub] Viewer disconnected. Total viewers: ${this.viewers.size}`);
      this.broadcastStatus();
    });

    ws.on("error", () => {
      this.viewers.delete(ws);
    });

    // Broadcast updated viewer count
    this.broadcastStatus();
  }

  private broadcastToViewers(message: ServerMessage): void {
    const messageStr = JSON.stringify(message);
    for (const viewer of this.viewers) {
      if (viewer.readyState === WebSocket.OPEN) {
        viewer.send(messageStr);
      }
    }
  }

  private broadcastStatus(): void {
    const status: StatusMessage = {
      type: "status",
      isLive: this.broadcasterAuthenticated && !!this.deepgramStream,
      viewerCount: this.viewers.size,
    };

    // Send to broadcaster
    if (this.broadcaster && this.broadcaster.readyState === WebSocket.OPEN) {
      this.sendMessage(this.broadcaster, status);
    }

    // Send to all viewers
    this.broadcastToViewers(status);
  }

  private sendMessage(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Get current hub status
   */
  getStatus(): {
    isLive: boolean;
    viewerCount: number;
    sessionDurationMs: number | null;
  } {
    return {
      isLive: this.broadcasterAuthenticated && !!this.deepgramStream,
      viewerCount: this.viewers.size,
      sessionDurationMs: this.sessionStartTime ? Date.now() - this.sessionStartTime : null,
    };
  }
}

// Export singleton instance
export const streamHub = new StreamHub();
