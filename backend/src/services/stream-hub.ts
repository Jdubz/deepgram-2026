/**
 * Stream Hub Service
 *
 * Manages WebSocket connections for real-time audio streaming:
 * - Single authenticated broadcaster sends audio
 * - Multiple viewers receive live transcription
 * - Relays audio to Deepgram and broadcasts transcripts
 * - Saves streamed audio to files and persists chunks with analysis
 */

import WebSocket from "ws";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { DeepgramStream, TranscriptSegment, UtteranceEndEvent } from "./deepgram-stream.js";
import { inferenceQueue } from "./inference-queue.js";
import { jobEventHub } from "./job-event-hub.js";

// Message types from clients
interface ControlMessage {
  type: "auth" | "stop";
}

// Message types to clients
interface AuthSuccessMessage {
  type: "auth_success";
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

interface SessionCreatedMessage {
  type: "session_created";
  sessionId: string;
  submissionId: string;
}

interface ChunkCreatedMessage {
  type: "chunk_created";
  sessionId: string;
  chunk: {
    id: number;
    index: number;
    speaker: number | null;
    transcript: string;
    startTimeMs: number;
    endTimeMs: number;
    willBeAnalyzed?: boolean; // false for short chunks that won't get analysis
  };
}

interface ChunkSentiment {
  sentiment: "positive" | "negative" | "neutral";
  sentimentScore: number;
  average: {
    sentiment: "positive" | "negative" | "neutral";
    sentimentScore: number;
  };
}

interface ChunkAnalyzedMessage {
  type: "chunk_analyzed";
  sessionId: string;
  chunkId: number;
  topics: Array<{ topic: string; confidence: number }>;
  intents: Array<{ intent: string; confidence: number }>;
  summary: string;
  sentiment: ChunkSentiment | null;
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
  | TranscriptMessage
  | SessionMessage
  | SessionCreatedMessage
  | ChunkCreatedMessage
  | ChunkAnalyzedMessage
  | StatusMessage
  | ErrorMessage;

const MAX_VIEWERS = 50;

// Minimum word count for analysis (skip short utterances)
// All chunks are analyzed regardless of word count
const MIN_WORDS_FOR_ANALYSIS = 0;

// Uploads directory path
const UPLOADS_DIR = path.join(process.cwd(), "uploads");

// WAV file constants (16-bit PCM, 16kHz, mono)
const WAV_SAMPLE_RATE = 16000;
const WAV_BITS_PER_SAMPLE = 16;
const WAV_NUM_CHANNELS = 1;
const WAV_HEADER_SIZE = 44;

/**
 * Create a WAV file header for PCM audio data
 */
function createWavHeader(dataSize: number): Buffer {
  const header = Buffer.alloc(WAV_HEADER_SIZE);
  const byteRate = WAV_SAMPLE_RATE * WAV_NUM_CHANNELS * (WAV_BITS_PER_SAMPLE / 8);
  const blockAlign = WAV_NUM_CHANNELS * (WAV_BITS_PER_SAMPLE / 8);

  // RIFF chunk descriptor
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4); // File size - 8
  header.write("WAVE", 8);

  // fmt sub-chunk
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20); // AudioFormat (1 = PCM)
  header.writeUInt16LE(WAV_NUM_CHANNELS, 22);
  header.writeUInt32LE(WAV_SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(WAV_BITS_PER_SAMPLE, 34);

  // data sub-chunk
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return header;
}

export class StreamHub {
  private broadcaster: WebSocket | null = null;
  private broadcasterAuthenticated = false;
  private viewers: Set<WebSocket> = new Set();
  private deepgramStream: DeepgramStream | null = null;
  private deepgramApiKey: string;
  private sessionStartTime: number | null = null;

  // Audio file persistence
  private currentSubmissionId: string | null = null;
  private currentSessionId: string | null = null;
  private audioFileStream: fs.WriteStream | null = null;
  private audioFilePath: string | null = null;
  private totalAudioBytes = 0;

  // Chunk tracking
  private chunkIndex = 0;
  private accumulatedSegments: TranscriptSegment[] = [];
  private utteranceStartTimeMs = 0;

  // Debounce status broadcasts to avoid flicker from React Strict Mode double-mounting
  private statusBroadcastTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.deepgramApiKey = process.env.DEEPGRAM_API_KEY || "";

    if (!this.deepgramApiKey) {
      console.warn("[StreamHub] DEEPGRAM_API_KEY not set - streaming will fail");
    }
  }

  /**
   * Check if an IP address is localhost
   */
  private isLocalhost(ip: string): boolean {
    return (
      ip === "127.0.0.1" ||
      ip === "::1" ||
      ip === "localhost" ||
      ip === "::ffff:127.0.0.1"
    );
  }

  /**
   * Handle a new broadcaster connection (localhost only)
   */
  handleBroadcaster(ws: WebSocket, clientIp: string): void {
    // Only localhost can broadcast
    if (!this.isLocalhost(clientIp)) {
      this.sendMessage(ws, {
        type: "error",
        message: "Only localhost connections are allowed to broadcast.",
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

    // Auto-authenticate localhost connections
    this.autoAuthenticateBroadcaster(ws, clientIp);

    ws.on("message", (data: Buffer) => {
      this.handleBroadcasterMessage(ws, data);
    });

    ws.on("close", () => {
      this.handleBroadcasterDisconnect();
    });

    ws.on("error", (err) => {
      console.error("[StreamHub] Broadcaster WebSocket error:", err);
      this.handleBroadcasterDisconnect();
    });
  }

  private handleBroadcasterMessage(_ws: WebSocket, data: Buffer): void {
    // Handle control messages (JSON) or raw audio (binary)
    try {
      const message = JSON.parse(data.toString()) as ControlMessage;

      if (message.type === "stop") {
        this.stopStreaming();
      } else if (message.type === "auth") {
        // Client sends auth message after auto-auth; just ignore it
      }
    } catch {
      // Not JSON - treat as raw binary audio data
      this.relayAudio(data);
    }
  }

  /**
   * Auto-authenticate localhost connections without password
   */
  private autoAuthenticateBroadcaster(ws: WebSocket, clientIp: string): void {
    this.broadcasterAuthenticated = true;
    console.log(`[StreamHub] Broadcaster auto-authenticated from localhost (${clientIp})`);

    this.sendMessage(ws, { type: "auth_success" });

    // Initialize session and file storage
    this.initializeSession();

    // Start Deepgram connection
    this.startDeepgramStream();

    // Notify viewers
    this.sessionStartTime = Date.now();
    this.broadcastToViewers({ type: "session_started" });

    // Broadcast session_created with IDs
    if (this.currentSessionId && this.currentSubmissionId) {
      this.broadcastToViewers({
        type: "session_created",
        sessionId: this.currentSessionId,
        submissionId: this.currentSubmissionId,
      });
    }

    this.broadcastStatus();
  }

  private initializeSession(): void {
    // Ensure uploads directory exists
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }

    // Generate IDs
    this.currentSubmissionId = randomUUID();
    this.currentSessionId = randomUUID();

    // Create filename with timestamp (WAV format for raw PCM)
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `stream-${timestamp}.wav`;
    this.audioFilePath = path.join(UPLOADS_DIR, filename);

    // Create audio file write stream
    this.audioFileStream = fs.createWriteStream(this.audioFilePath);
    this.totalAudioBytes = 0;

    // Write placeholder WAV header (will be updated when stream ends)
    const placeholderHeader = createWavHeader(0);
    this.audioFileStream.write(placeholderHeader);

    // Create audio submission record
    inferenceQueue.createSubmission({
      id: this.currentSubmissionId,
      filename: filename,
      filePath: this.audioFilePath,
      originalFilename: filename,
      mimeType: "audio/wav",
      autoProcess: false, // Don't auto-transcribe, we're doing real-time
    });

    // Update submission status to streaming
    inferenceQueue.updateSubmissionStatus(this.currentSubmissionId, "streaming");

    // Create stream session linked to submission
    inferenceQueue.createStreamSession({
      id: this.currentSessionId,
      submissionId: this.currentSubmissionId,
      title: `Live Stream ${timestamp}`,
    });

    // Reset chunk tracking
    this.chunkIndex = 0;
    this.accumulatedSegments = [];
    this.utteranceStartTimeMs = 0;

    console.log(`[StreamHub] Session initialized: ${this.currentSessionId}`);
    console.log(`[StreamHub] Audio file: ${this.audioFilePath}`);
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
        interimResults: process.env.DEEPGRAM_INTERIM_RESULTS !== "false",
        utteranceEndMs: 1500,
        smartFormat: true,
      },
      {
        onTranscript: (segment) => this.handleTranscript(segment),
        onUtteranceEnd: (event) => this.handleUtteranceEnd(event),
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

    // Accumulate final segments for chunk building
    if (segment.isFinal && segment.text.trim()) {
      // Track utterance start time from first segment
      if (this.accumulatedSegments.length === 0) {
        this.utteranceStartTimeMs = segment.start * 1000;
      }
      this.accumulatedSegments.push(segment);
    }

    // Send to broadcaster
    if (this.broadcaster && this.broadcasterAuthenticated) {
      this.sendMessage(this.broadcaster, message);
    }

    // Broadcast to all viewers
    this.broadcastToViewers(message);
  }

  /**
   * Create a chunk from accumulated segments, broadcast it, and queue analysis
   * @param endTimeMs - The end time of the chunk in milliseconds
   * @param logPrefix - Prefix for log messages (e.g., "" or "Final ")
   */
  private createChunkFromSegments(endTimeMs: number, logPrefix: string = ""): void {
    if (!this.currentSessionId || this.accumulatedSegments.length === 0) {
      return;
    }

    // Combine accumulated segments into a single chunk
    const combinedText = this.accumulatedSegments.map((s) => s.text).join(" ");

    // Get the dominant speaker from all segments
    const speakerCounts = new Map<number, number>();
    for (const seg of this.accumulatedSegments) {
      if (seg.speaker !== null) {
        speakerCounts.set(seg.speaker, (speakerCounts.get(seg.speaker) || 0) + 1);
      }
    }
    const speaker =
      speakerCounts.size > 0
        ? [...speakerCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
        : null;

    // Calculate average confidence
    const avgConfidence =
      this.accumulatedSegments.reduce((sum, s) => sum + s.confidence, 0) /
      this.accumulatedSegments.length;

    // Create the chunk in database
    const chunk = inferenceQueue.createStreamChunk({
      sessionId: this.currentSessionId,
      chunkIndex: this.chunkIndex++,
      speaker,
      transcript: combinedText,
      confidence: avgConfidence,
      startTimeMs: this.utteranceStartTimeMs,
      endTimeMs: endTimeMs,
    });

    console.log(
      `[StreamHub] ${logPrefix}Chunk ${chunk.id} created: speaker=${speaker}, words=${chunk.word_count}`
    );

    // Determine if this chunk will be analyzed (enough words)
    const willBeAnalyzed = chunk.word_count >= MIN_WORDS_FOR_ANALYSIS;

    // Broadcast chunk_created to viewers
    const chunkCreatedMessage: ChunkCreatedMessage = {
      type: "chunk_created",
      sessionId: this.currentSessionId,
      chunk: {
        id: chunk.id,
        index: chunk.chunk_index,
        speaker: chunk.speaker,
        transcript: chunk.transcript,
        startTimeMs: chunk.start_time_ms,
        endTimeMs: chunk.end_time_ms,
        willBeAnalyzed,
      },
    };

    if (this.broadcaster && this.broadcasterAuthenticated) {
      this.sendMessage(this.broadcaster, chunkCreatedMessage);
    }
    this.broadcastToViewers(chunkCreatedMessage);

    // Queue analysis job if chunk has enough words
    if (willBeAnalyzed) {
      try {
        const jobId = inferenceQueue.createAnalyzeChunkJob({
          chunkId: chunk.id,
          sessionId: this.currentSessionId,
        });
        console.log(`[StreamHub] Queued analysis job ${jobId} for ${logPrefix.toLowerCase()}chunk ${chunk.id}`);

        // Emit events to notify job processor
        const job = inferenceQueue.getJob(jobId);
        if (job) {
          jobEventHub.emitJobCreated(job);
          jobEventHub.emitQueueStatus();
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[StreamHub] Failed to create analysis job for ${logPrefix.toLowerCase()}chunk ${chunk.id}:`, errorMsg);
      }
    } else {
      console.log(`[StreamHub] ${logPrefix}Chunk ${chunk.id} too short for analysis (${chunk.word_count} words)`);
    }

    // Reset accumulator for next utterance
    this.accumulatedSegments = [];
    this.utteranceStartTimeMs = 0;
  }

  private handleUtteranceEnd(event: UtteranceEndEvent): void {
    if (!this.currentSessionId || this.accumulatedSegments.length === 0) {
      return;
    }

    const endTimeMs = event.lastWordEnd * 1000;
    this.createChunkFromSegments(endTimeMs);
  }

  private relayAudio(audioData: Buffer): void {
    // Write to file stream
    if (this.audioFileStream) {
      this.audioFileStream.write(audioData);
      this.totalAudioBytes += audioData.length;
    }

    // Relay to Deepgram
    if (this.deepgramStream) {
      this.deepgramStream.sendAudio(audioData);
    }
  }

  private stopStreaming(): void {
    if (this.deepgramStream) {
      this.deepgramStream.close();
      this.deepgramStream = null;
    }

    // Finalize any remaining accumulated segments as a chunk
    this.finalizeRemainingSegments();

    // Finalize session
    this.finalizeSession();

    this.sessionStartTime = null;
    this.broadcastToViewers({ type: "session_ended" });
    this.broadcastStatus();

    console.log("[StreamHub] Streaming stopped by broadcaster");
  }

  /**
   * Finalize any remaining accumulated segments as a chunk
   * Called when session ends before UtteranceEnd is received
   */
  private finalizeRemainingSegments(): void {
    if (!this.currentSessionId || this.accumulatedSegments.length === 0) {
      return;
    }

    console.log(
      `[StreamHub] Finalizing ${this.accumulatedSegments.length} remaining segments`
    );

    // Use last segment end time as chunk end
    const lastSegment = this.accumulatedSegments[this.accumulatedSegments.length - 1];
    const endTimeMs = (lastSegment.start + lastSegment.duration) * 1000;

    try {
      this.createChunkFromSegments(endTimeMs, "Final ");
    } catch (err) {
      console.error("[StreamHub] Failed to create final chunk:", err);
      // Clear accumulator even on error
      this.accumulatedSegments = [];
      this.utteranceStartTimeMs = 0;
    }
  }

  private finalizeSession(): void {
    // Close audio file stream
    if (this.audioFileStream) {
      this.audioFileStream.end();
      this.audioFileStream = null;
    }

    // Update WAV header with correct data size
    if (this.audioFilePath && this.totalAudioBytes > 0) {
      try {
        const wavHeader = createWavHeader(this.totalAudioBytes);
        const fd = fs.openSync(this.audioFilePath, "r+");
        fs.writeSync(fd, wavHeader, 0, WAV_HEADER_SIZE, 0);
        fs.closeSync(fd);
        console.log(`[StreamHub] WAV header updated: ${this.totalAudioBytes} bytes of audio data`);
      } catch (err) {
        console.error("[StreamHub] Failed to update WAV header:", err);
      }
    }

    // Calculate session duration from audio data (more accurate than wall clock)
    // 16-bit samples at 16kHz = 2 bytes per sample = 32000 bytes per second
    const durationFromAudio = this.totalAudioBytes / (WAV_SAMPLE_RATE * WAV_NUM_CHANNELS * (WAV_BITS_PER_SAMPLE / 8));
    const durationMs = durationFromAudio * 1000;

    // Update submission with file size
    if (this.currentSubmissionId && this.audioFilePath) {
      try {
        const stats = fs.statSync(this.audioFilePath);

        inferenceQueue.finalizeStreamSubmission(
          this.currentSubmissionId,
          stats.size,
          durationFromAudio // Use accurate duration from audio data
        );

        console.log(
          `[StreamHub] Submission ${this.currentSubmissionId} finalized: ${stats.size} bytes, ${durationFromAudio.toFixed(1)}s`
        );
      } catch (err) {
        console.error("[StreamHub] Failed to update submission:", err);
      }
    }

    // End stream session
    if (this.currentSessionId) {
      inferenceQueue.endStreamSession(this.currentSessionId, durationMs);
      console.log(
        `[StreamHub] Session ${this.currentSessionId} ended: ${durationMs}ms`
      );
    }

    // Reset state
    this.currentSubmissionId = null;
    this.currentSessionId = null;
    this.audioFilePath = null;
    this.totalAudioBytes = 0;
    this.chunkIndex = 0;
    this.accumulatedSegments = [];
  }

  private handleBroadcasterDisconnect(): void {
    console.log("[StreamHub] Broadcaster disconnected");

    if (this.deepgramStream) {
      this.deepgramStream.close();
      this.deepgramStream = null;
    }

    // Finalize any remaining accumulated segments as a chunk
    this.finalizeRemainingSegments();

    // Finalize session before clearing state
    this.finalizeSession();

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

    // Send initial status (isLive) immediately, but defer viewer count
    // to avoid flicker from React Strict Mode double-mounting
    this.sendMessage(ws, {
      type: "status",
      isLive: this.broadcasterAuthenticated && !!this.deepgramStream,
      viewerCount: 0, // Will be updated by debounced broadcast
    });

    // Replay all transcript chunks from the database
    // This allows viewers to see the full conversation history after joining late or refreshing
    this.replayAllChunksToViewer(ws);

    ws.on("close", () => {
      this.viewers.delete(ws);
      console.log(`[StreamHub] Viewer disconnected. Total viewers: ${this.viewers.size}`);
      this.broadcastStatus();
    });

    ws.on("error", () => {
      this.viewers.delete(ws);
    });

    // Broadcast updated viewer count (debounced)
    this.broadcastStatus();
  }

  private broadcastToViewers(message: ServerMessage): void {
    const messageStr = JSON.stringify(message);
    const failedViewers: WebSocket[] = [];

    for (const viewer of this.viewers) {
      if (viewer.readyState === WebSocket.OPEN) {
        try {
          viewer.send(messageStr);
        } catch (err) {
          console.warn("[StreamHub] Failed to send to viewer, removing:", err);
          failedViewers.push(viewer);
        }
      } else if (viewer.readyState === WebSocket.CLOSED || viewer.readyState === WebSocket.CLOSING) {
        // Clean up dead connections
        failedViewers.push(viewer);
      }
    }

    // Remove failed/dead viewers from set
    for (const viewer of failedViewers) {
      this.viewers.delete(viewer);
    }
  }

  private broadcastStatus(): void {
    // Debounce status broadcasts to avoid flicker from React Strict Mode
    // double-mounting (connect -> connect -> disconnect pattern)
    if (this.statusBroadcastTimeout) {
      clearTimeout(this.statusBroadcastTimeout);
    }

    this.statusBroadcastTimeout = setTimeout(() => {
      this.statusBroadcastTimeout = null;

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
    }, 100); // 100ms debounce
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

  /**
   * Broadcast chunk analysis results (called by job processor)
   */
  broadcastChunkAnalyzed(
    sessionId: string,
    chunkId: number,
    results: {
      topics: Array<{ topic: string; confidence: number }>;
      intents: Array<{ intent: string; confidence: number }>;
      summary: string;
      sentiment: ChunkSentiment | null;
    }
  ): void {
    const message: ChunkAnalyzedMessage = {
      type: "chunk_analyzed",
      sessionId,
      chunkId,
      topics: results.topics,
      intents: results.intents,
      summary: results.summary,
      sentiment: results.sentiment,
    };

    // Broadcast to broadcaster if this is the active session
    if (
      this.currentSessionId === sessionId &&
      this.broadcaster &&
      this.broadcasterAuthenticated
    ) {
      this.sendMessage(this.broadcaster, message);
    }

    // Broadcast to all viewers
    this.broadcastToViewers(message);
  }

  /**
   * Replay all chunks from database to a newly connected viewer
   * This allows viewers to see the full transcript history
   */
  private replayAllChunksToViewer(ws: WebSocket): void {
    try {
      const chunks = inferenceQueue.getAllChunksWithAnalysis();
      console.log(`[StreamHub] Replaying ${chunks.length} chunks to new viewer`);

      for (const chunk of chunks) {
        // Send chunk_created message
        // willBeAnalyzed is true only if the chunk has an analysis job
        const chunkCreatedMsg: ChunkCreatedMessage = {
          type: "chunk_created",
          sessionId: chunk.session_id,
          chunk: {
            id: chunk.id,
            index: chunk.chunk_index,
            speaker: chunk.speaker,
            transcript: chunk.transcript,
            startTimeMs: chunk.start_time_ms,
            endTimeMs: chunk.end_time_ms,
            willBeAnalyzed: chunk.analysis_job_id !== null,
          },
        };
        this.sendMessage(ws, chunkCreatedMsg);

        // If chunk has been analyzed, send the analysis results
        if (chunk.analysisJob && chunk.analysisJob.status === "completed") {
          const analysisResults = inferenceQueue.parseAnalysisResults(chunk.analysisJob);
          const chunkAnalyzedMsg: ChunkAnalyzedMessage = {
            type: "chunk_analyzed",
            sessionId: chunk.session_id,
            chunkId: chunk.id,
            topics: analysisResults.topics,
            intents: analysisResults.intents,
            summary: analysisResults.summary || "",
            sentiment: analysisResults.sentiment,
          };
          this.sendMessage(ws, chunkAnalyzedMsg);
        }
      }
    } catch (error) {
      console.error("[StreamHub] Error replaying chunks to viewer:", error);
    }
  }
}

// Export singleton instance
export const streamHub = new StreamHub();
