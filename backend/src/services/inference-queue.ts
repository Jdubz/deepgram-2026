/**
 * Inference Queue Service
 *
 * Facade that provides a unified interface for:
 * - Audio submissions (delegates to SubmissionService)
 * - Jobs (delegates to JobService)
 * - Stream sessions/chunks (delegates to StreamService)
 * - Job health monitoring (delegates to JobHealthService)
 *
 * This service maintains backward compatibility while delegating
 * to focused services for better separation of concerns.
 */

import { database } from "../db/database.js";
import { Provider, SentimentResult } from "../types/index.js";

// Import focused services
import {
  submissionService,
  SubmissionService,
  AudioSubmission,
  SubmissionStatus,
  CreateSubmissionParams,
} from "./submission-service.js";

import {
  jobService,
  JobService,
  Job,
  JobType,
  JobStatus,
  QueueStatus,
  CreateTranscribeJobParams,
  CreateSummarizeJobParams,
} from "./job-service.js";

import {
  streamService,
  StreamService,
  StreamSession,
  StreamChunk,
  SessionStatus,
  CreateStreamSessionParams,
  CreateStreamChunkParams,
  ChunkWithAnalysis,
} from "./stream-service.js";

import {
  jobHealthService,
  JobHealthService,
  JobWithHeartbeat,
} from "./job-health-service.js";

// Re-export types for backward compatibility
export type {
  AudioSubmission,
  SubmissionStatus,
  CreateSubmissionParams,
  Job,
  JobType,
  JobStatus,
  QueueStatus,
  CreateTranscribeJobParams,
  CreateSummarizeJobParams,
  StreamSession,
  StreamChunk,
  SessionStatus,
  CreateStreamSessionParams,
  CreateStreamChunkParams,
  ChunkWithAnalysis,
};

export type AnalysisStatus = "pending" | "processing" | "completed" | "skipped";

// Re-export SentimentResult as ChunkSentiment for backward compatibility
export type ChunkSentiment = SentimentResult;

export interface ChunkAnalysisResult {
  topics: Array<{ topic: string; confidence: number }>;
  intents: Array<{ intent: string; confidence: number }>;
  summary: string;
  sentiment: ChunkSentiment | null;
}

export interface CreateAnalyzeChunkJobParams {
  chunkId: number;
  sessionId: string;
  metadata?: Record<string, unknown>;
}

export interface SubmissionWithJobs extends AudioSubmission {
  transcriptJob: Job | null;
  summarizeJob: Job | null;
}

export interface ParsedAnalysisResults {
  topics: Array<{ topic: string; confidence: number }>;
  intents: Array<{ intent: string; confidence: number }>;
  sentiment: ChunkSentiment | null;
  summary: string | null;
}

class InferenceQueueService {
  // Expose underlying services for direct access if needed
  readonly submissions: SubmissionService = submissionService;
  readonly jobs: JobService = jobService;
  readonly streams: StreamService = streamService;
  readonly health: JobHealthService = jobHealthService;

  isInitialized(): boolean {
    return database.isInitialized();
  }

  initializeDatabase(): void {
    database.initialize();
  }

  close(): void {
    database.close();
  }

  // ===========================================================================
  // Submission Methods (delegated to SubmissionService)
  // ===========================================================================

  createSubmission(params: CreateSubmissionParams): AudioSubmission {
    const submission = submissionService.createSubmission(params);

    // Handle auto-processing if requested
    if (params.autoProcess) {
      this.createTranscribeJob({
        audioFilePath: params.filePath,
        audioFileId: params.id,
        metadata: { autoSummarize: true },
        provider: params.provider || Provider.LOCAL,
      });
      submissionService.updateSubmissionStatus(params.id, "pending");
    }

    return submission;
  }

  getSubmission(submissionId: string): AudioSubmission | null {
    return submissionService.getSubmission(submissionId);
  }

  getSubmissions(limit?: number, offset?: number): AudioSubmission[] {
    return submissionService.getSubmissions(limit, offset);
  }

  getSubmissionsByStatus(status: SubmissionStatus): AudioSubmission[] {
    return submissionService.getSubmissionsByStatus(status);
  }

  updateSubmissionStatus(submissionId: string, status: SubmissionStatus, errorMessage?: string): void {
    submissionService.updateSubmissionStatus(submissionId, status, errorMessage);
  }

  getSubmissionsFiltered(query: {
    maxDuration?: number;
    minDuration?: number;
    limit?: number;
    offset?: number;
  }): { submissions: AudioSubmission[]; total: number } {
    return submissionService.getSubmissionsFiltered(query);
  }

  getSubmissionByFilename(filename: string): AudioSubmission | null {
    return submissionService.getSubmissionByFilename(filename);
  }

  generateUniqueDisplayName(originalFilename: string): string {
    return submissionService.generateUniqueDisplayName(originalFilename);
  }

  deleteSubmission(submissionId: string): boolean {
    // Delete associated jobs first
    jobService.deleteJobsForSubmission(submissionId);
    return submissionService.deleteSubmission(submissionId);
  }

  finalizeStreamSubmission(submissionId: string, fileSize: number, durationSeconds: number): void {
    submissionService.finalizeStreamSubmission(submissionId, fileSize, durationSeconds);
  }

  // ===========================================================================
  // Job Methods (delegated to JobService)
  // ===========================================================================

  createTranscribeJob(params: CreateTranscribeJobParams): number {
    return jobService.createTranscribeJob(params);
  }

  createSummarizeJob(params: CreateSummarizeJobParams): number {
    return jobService.createSummarizeJob(params);
  }

  getJob(jobId: number): Job | null {
    return jobService.getJob(jobId);
  }

  getJobsForSubmission(audioFileId: string): Job[] {
    return jobService.getJobsForSubmission(audioFileId);
  }

  getRecentJobs(limit?: number): Job[] {
    return jobService.getRecentJobs(limit);
  }

  getPendingCount(): number {
    return jobService.getPendingCount();
  }

  getQueueStatus(): QueueStatus {
    return jobService.getQueueStatus();
  }

  claimNextJob(): Job | null {
    return jobService.claimNextJob();
  }

  completeJob(
    jobId: number,
    outputText: string,
    modelUsed: string,
    processingTimeMs: number,
    confidence?: number,
    rawResponse?: unknown
  ): void {
    jobService.completeJob(jobId, outputText, modelUsed, processingTimeMs, confidence, rawResponse);
  }

  failJob(jobId: number, errorMessage: string): void {
    jobService.failJob(jobId, errorMessage);
  }

  async waitForJob(jobId: number, timeoutMs?: number): Promise<Job> {
    return jobService.waitForJob(jobId, timeoutMs);
  }

  async waitForSubmission(submissionId: string, timeoutMs: number = 600000): Promise<AudioSubmission> {
    const startTime = Date.now();
    const pollInterval = 1000;

    while (Date.now() - startTime < timeoutMs) {
      const submission = submissionService.getSubmission(submissionId);

      if (!submission) {
        throw new Error(`Submission ${submissionId} not found`);
      }

      if (submission.status === "completed" || submission.status === "failed") {
        return submission;
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Submission ${submissionId} timed out after ${timeoutMs}ms`);
  }

  // ===========================================================================
  // Stream Methods (delegated to StreamService)
  // ===========================================================================

  createStreamSession(params: CreateStreamSessionParams): StreamSession {
    return streamService.createStreamSession(params);
  }

  getStreamSession(sessionId: string): StreamSession | null {
    return streamService.getStreamSession(sessionId);
  }

  getStreamSessionBySubmission(submissionId: string): StreamSession | null {
    return streamService.getStreamSessionBySubmission(submissionId);
  }

  updateStreamSession(sessionId: string, updates: {
    status?: SessionStatus;
    endedAt?: string;
    totalDurationMs?: number;
    chunkCount?: number;
  }): void {
    streamService.updateStreamSession(sessionId, updates);
  }

  endStreamSession(sessionId: string, totalDurationMs: number): void {
    streamService.endStreamSession(sessionId, totalDurationMs);
  }

  createStreamChunk(params: CreateStreamChunkParams): StreamChunk {
    return streamService.createStreamChunk(params);
  }

  getStreamChunk(chunkId: number): StreamChunk | null {
    return streamService.getStreamChunk(chunkId);
  }

  getSessionChunks(sessionId: string): StreamChunk[] {
    return streamService.getSessionChunks(sessionId);
  }

  getChunksNeedingAnalysis(sessionId: string): StreamChunk[] {
    return streamService.getChunksNeedingAnalysis(sessionId);
  }

  setChunkAnalysisJob(chunkId: number, jobId: number): void {
    streamService.setChunkAnalysisJob(chunkId, jobId);
  }

  getSessionChunksWithAnalysis(sessionId: string): ChunkWithAnalysis[] {
    return streamService.getSessionChunksWithAnalysis(sessionId);
  }

  getAllChunksWithAnalysis(): ChunkWithAnalysis[] {
    return streamService.getAllChunksWithAnalysis();
  }

  // ===========================================================================
  // Health Methods (delegated to JobHealthService)
  // ===========================================================================

  updateJobHeartbeat(jobId: number, heartbeatCount: number): void {
    jobHealthService.updateJobHeartbeat(jobId, heartbeatCount);
  }

  markModelVerified(jobId: number): void {
    jobHealthService.markModelVerified(jobId);
  }

  findStuckJobs(): Job[] {
    return jobHealthService.findStuckJobs();
  }

  recoverStuckJob(jobId: number, reason: string): void {
    jobHealthService.recoverStuckJob(jobId, reason);
  }

  getJobWithHeartbeat(jobId: number): JobWithHeartbeat | null {
    return jobHealthService.getJobWithHeartbeat(jobId);
  }

  // ===========================================================================
  // Analyze Chunk Jobs (cross-cutting concern)
  // ===========================================================================

  createAnalyzeChunkJob(params: CreateAnalyzeChunkJobParams): number {
    const db = database.getConnection();

    const chunk = streamService.getStreamChunk(params.chunkId);
    if (!chunk) {
      throw new Error(`Chunk ${params.chunkId} not found`);
    }

    // Validate chunk state to prevent duplicate jobs
    if (chunk.analysis_job_id) {
      const existingJob = jobService.getJob(chunk.analysis_job_id);
      if (existingJob) {
        if (existingJob.status === "processing" || existingJob.status === "pending") {
          throw new Error(
            `Chunk ${params.chunkId} already has a pending analysis job (job_id: ${chunk.analysis_job_id})`
          );
        }
        if (existingJob.status === "completed") {
          throw new Error(
            `Chunk ${params.chunkId} has already been analyzed`
          );
        }
      }
    }

    if (!chunk.transcript || !chunk.transcript.trim()) {
      throw new Error(
        `Chunk ${params.chunkId} has empty transcript, skipping analysis`
      );
    }

    const metadata = {
      ...params.metadata,
      chunkId: params.chunkId,
      sessionId: params.sessionId,
    };

    const stmt = db.prepare(`
      INSERT INTO jobs (job_type, input_text, metadata, provider)
      VALUES ('analyze_chunk', ?, ?, ?)
    `);

    const result = stmt.run(
      chunk.transcript,
      JSON.stringify(metadata),
      Provider.DEEPGRAM
    );

    const jobId = result.lastInsertRowid as number;
    streamService.setChunkAnalysisJob(params.chunkId, jobId);

    return jobId;
  }

  // ===========================================================================
  // Joined Query Methods
  // ===========================================================================

  getSubmissionWithJobs(submissionId: string): SubmissionWithJobs | null {
    const db = database.getConnection();

    const submission = submissionService.getSubmission(submissionId);
    if (!submission) return null;

    const transcriptJob = db.prepare(`
      SELECT * FROM jobs
      WHERE audio_file_id = ? AND job_type = 'transcribe'
      ORDER BY created_at DESC
      LIMIT 1
    `).get(submissionId) as Job | undefined;

    const summarizeJob = db.prepare(`
      SELECT * FROM jobs
      WHERE audio_file_id = ? AND job_type = 'summarize'
      ORDER BY created_at DESC
      LIMIT 1
    `).get(submissionId) as Job | undefined;

    return {
      ...submission,
      transcriptJob: transcriptJob || null,
      summarizeJob: summarizeJob || null,
    };
  }

  getChunkWithAnalysis(chunkId: number): ChunkWithAnalysis | null {
    const chunk = streamService.getStreamChunk(chunkId);
    if (!chunk) return null;

    let analysisJob: Job | null = null;
    if (chunk.analysis_job_id) {
      analysisJob = jobService.getJob(chunk.analysis_job_id);
    }

    return { ...chunk, analysisJob };
  }

  parseAnalysisResults(job: Job | null): ParsedAnalysisResults {
    const empty: ParsedAnalysisResults = {
      topics: [],
      intents: [],
      sentiment: null,
      summary: null,
    };

    if (!job || !job.raw_response) {
      if (job?.output_text) {
        return { ...empty, summary: job.output_text };
      }
      return empty;
    }

    try {
      const raw = JSON.parse(job.raw_response);

      const results = raw.results;
      if (!results) {
        return {
          topics: raw.topics || [],
          intents: raw.intents || [],
          sentiment: raw.sentiment || null,
          summary: raw.summary || job.output_text || null,
        };
      }

      // Collect and transform topics (Deepgram uses confidence_score, we use confidence)
      const topicsMap = new Map<string, number>();
      if (results.topics?.segments) {
        for (const segment of results.topics.segments) {
          for (const t of segment.topics || []) {
            if (t.topic) {
              const confidence = t.confidence_score ?? t.confidence ?? 0;
              const existing = topicsMap.get(t.topic) || 0;
              topicsMap.set(t.topic, Math.max(existing, confidence));
            }
          }
        }
      }
      const topics = [...topicsMap.entries()]
        .map(([topic, confidence]) => ({ topic, confidence }))
        .sort((a, b) => b.confidence - a.confidence);

      // Collect and transform intents (Deepgram uses confidence_score, we use confidence)
      const intentsMap = new Map<string, number>();
      if (results.intents?.segments) {
        for (const segment of results.intents.segments) {
          for (const i of segment.intents || []) {
            if (i.intent) {
              const confidence = i.confidence_score ?? i.confidence ?? 0;
              const existing = intentsMap.get(i.intent) || 0;
              intentsMap.set(i.intent, Math.max(existing, confidence));
            }
          }
        }
      }
      const intents = [...intentsMap.entries()]
        .map(([intent, confidence]) => ({ intent, confidence }))
        .sort((a, b) => b.confidence - a.confidence);

      let sentiment: ChunkSentiment | null = null;
      if (results.sentiments?.average) {
        const avgSentiment = results.sentiments.average.sentiment;
        const avgScore = results.sentiments.average.sentiment_score;
        sentiment = {
          sentiment: avgSentiment,
          sentimentScore: avgScore,
          average: {
            sentiment: avgSentiment,
            sentimentScore: avgScore,
          },
        };
      }

      const summary = results.summary?.text || job.output_text || null;

      return { topics, intents, sentiment, summary };
    } catch {
      return { ...empty, summary: job.output_text };
    }
  }
}

// Export singleton instance
export const inferenceQueue = new InferenceQueueService();

// Also export the class
export { InferenceQueueService };
