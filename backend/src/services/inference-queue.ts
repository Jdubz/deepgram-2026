/**
 * Inference Queue Service
 *
 * Provides an interface for the API to:
 * 1. Create audio submissions (tracked in audio_submissions table)
 * 2. Create inference jobs (transcribe, summarize)
 * 3. Query job and submission status
 *
 * Uses SQLite for persistent job queue storage.
 */

import Database from "better-sqlite3";
import fs from "fs";
import { database } from "../db/database.js";
import { Provider } from "../types/index.js";

export type JobType = "transcribe" | "summarize" | "analyze_chunk";
export type JobStatus = "pending" | "processing" | "completed" | "failed";
export type SubmissionStatus = "pending" | "transcribing" | "summarizing" | "completed" | "failed" | "streaming";
export type AnalysisStatus = "pending" | "processing" | "completed" | "skipped";
export type SessionStatus = "active" | "ended";

export interface Job {
  id: number;
  job_type: JobType;
  status: JobStatus;
  provider: Provider;
  input_file_path: string | null;
  input_text: string | null;
  output_text: string | null;
  error_message: string | null;
  audio_file_id: string | null;
  metadata: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  processing_time_ms: number | null;
  model_used: string | null;
  confidence: number | null;
  raw_response: string | null;
  raw_response_type: string | null;
}

export interface AudioSubmission {
  id: string;
  filename: string;
  original_filename: string | null;
  file_path: string;
  mime_type: string | null;
  file_size: number | null;
  duration_seconds: number | null;
  transcript: string | null;
  transcript_job_id: number | null;
  transcript_confidence: number | null;
  transcribed_at: string | null;
  summary: string | null;
  summary_job_id: number | null;
  summary_confidence: number | null;
  summarized_at: string | null;
  status: SubmissionStatus;
  error_message: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSubmissionParams {
  id: string;
  filename: string;
  filePath: string;
  originalFilename?: string;
  mimeType?: string;
  fileSize?: number;
  durationSeconds?: number;
  metadata?: Record<string, unknown>;
  autoProcess?: boolean;
  provider?: Provider;
}

export interface CreateTranscribeJobParams {
  audioFilePath: string;
  audioFileId?: string;
  metadata?: Record<string, unknown>;
  provider?: Provider;
}

export interface CreateSummarizeJobParams {
  text: string;
  audioFileId?: string;
  metadata?: Record<string, unknown>;
  provider?: Provider;
}

export interface QueueStatus {
  totalJobs: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  avgProcessingTimeMs: number | null;
}

// ===========================================================================
// Stream Session and Chunk Types
// ===========================================================================

export interface StreamSession {
  id: string;
  submission_id: string;
  title: string | null;
  started_at: string;
  ended_at: string | null;
  total_duration_ms: number;
  chunk_count: number;
  status: SessionStatus;
}

export interface StreamChunk {
  id: number;
  session_id: string;
  chunk_index: number;
  speaker: number | null;
  transcript: string;
  confidence: number | null;
  start_time_ms: number;
  end_time_ms: number;
  word_count: number;
  topics: string | null;
  intents: string | null;
  summary: string | null;
  analysis_job_id: number | null;
  analysis_status: AnalysisStatus;
  analyzed_at: string | null;
  created_at: string;
}

export interface CreateStreamSessionParams {
  id: string;
  submissionId: string;
  title?: string;
}

export interface CreateStreamChunkParams {
  sessionId: string;
  chunkIndex: number;
  speaker: number | null;
  transcript: string;
  confidence?: number;
  startTimeMs: number;
  endTimeMs: number;
  wordCount?: number;
}

export interface CreateAnalyzeChunkJobParams {
  chunkId: number;
  sessionId: string;
  metadata?: Record<string, unknown>;
}

export interface ChunkAnalysisResult {
  topics: Array<{ topic: string; confidence: number }>;
  intents: Array<{ intent: string; confidence: number }>;
  summary: string;
}

class InferenceQueueService {
  /**
   * Get database connection from the shared database manager
   */
  private getDb(): Database.Database {
    return database.getConnection();
  }

  /**
   * Check if the database is initialized
   */
  isInitialized(): boolean {
    return database.isInitialized();
  }

  // ===========================================================================
  // Audio Submissions
  // ===========================================================================

  /**
   * Create a new audio submission
   */
  createSubmission(params: CreateSubmissionParams): AudioSubmission {
    const db = this.getDb();

    const stmt = db.prepare(`
      INSERT INTO audio_submissions
      (id, filename, file_path, original_filename, mime_type, file_size, duration_seconds, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      params.id,
      params.filename,
      params.filePath,
      params.originalFilename || null,
      params.mimeType || null,
      params.fileSize || null,
      params.durationSeconds || null,
      params.metadata ? JSON.stringify(params.metadata) : null
    );

    // Auto-create transcribe job if requested
    if (params.autoProcess) {
      this.createTranscribeJob({
        audioFilePath: params.filePath,
        audioFileId: params.id,
        metadata: { autoSummarize: true },
        provider: params.provider || Provider.LOCAL,
      });

      // Update status to pending (will be updated to transcribing when job starts)
      db.prepare(
        "UPDATE audio_submissions SET status = 'pending' WHERE id = ?"
      ).run(params.id);
    }

    return this.getSubmission(params.id)!;
  }

  /**
   * Get an audio submission by ID
   */
  getSubmission(submissionId: string): AudioSubmission | null {
    const db = this.getDb();
    const stmt = db.prepare("SELECT * FROM audio_submissions WHERE id = ?");
    return stmt.get(submissionId) as AudioSubmission | null;
  }

  /**
   * Get all audio submissions (with pagination)
   */
  getSubmissions(limit: number = 50, offset: number = 0): AudioSubmission[] {
    const db = this.getDb();
    const stmt = db.prepare(
      "SELECT * FROM audio_submissions ORDER BY created_at DESC LIMIT ? OFFSET ?"
    );
    return stmt.all(limit, offset) as AudioSubmission[];
  }

  /**
   * Get submissions by status
   */
  getSubmissionsByStatus(status: SubmissionStatus): AudioSubmission[] {
    const db = this.getDb();
    const stmt = db.prepare(
      "SELECT * FROM audio_submissions WHERE status = ? ORDER BY created_at DESC"
    );
    return stmt.all(status) as AudioSubmission[];
  }

  // ===========================================================================
  // Jobs
  // ===========================================================================

  /**
   * Create a transcription job
   */
  createTranscribeJob(params: CreateTranscribeJobParams): number {
    const db = this.getDb();

    const stmt = db.prepare(`
      INSERT INTO jobs (job_type, input_file_path, audio_file_id, metadata, provider)
      VALUES ('transcribe', ?, ?, ?, ?)
    `);

    const result = stmt.run(
      params.audioFilePath,
      params.audioFileId || null,
      params.metadata ? JSON.stringify(params.metadata) : null,
      params.provider || Provider.LOCAL
    );

    return result.lastInsertRowid as number;
  }

  /**
   * Create a summarization job
   */
  createSummarizeJob(params: CreateSummarizeJobParams): number {
    const db = this.getDb();

    const stmt = db.prepare(`
      INSERT INTO jobs (job_type, input_text, audio_file_id, metadata, provider)
      VALUES ('summarize', ?, ?, ?, ?)
    `);

    const result = stmt.run(
      params.text,
      params.audioFileId || null,
      params.metadata ? JSON.stringify(params.metadata) : null,
      params.provider || Provider.LOCAL
    );

    return result.lastInsertRowid as number;
  }

  /**
   * Get a job by ID
   */
  getJob(jobId: number): Job | null {
    const db = this.getDb();
    const stmt = db.prepare("SELECT * FROM jobs WHERE id = ?");
    return stmt.get(jobId) as Job | null;
  }

  /**
   * Get jobs for an audio file
   */
  getJobsForSubmission(audioFileId: string): Job[] {
    const db = this.getDb();
    const stmt = db.prepare(
      "SELECT * FROM jobs WHERE audio_file_id = ? ORDER BY created_at DESC"
    );
    return stmt.all(audioFileId) as Job[];
  }

  /**
   * Get recent jobs
   */
  getRecentJobs(limit: number = 20): Job[] {
    const db = this.getDb();
    const stmt = db.prepare(
      "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?"
    );
    return stmt.all(limit) as Job[];
  }

  /**
   * Get pending jobs count
   */
  getPendingCount(): number {
    const db = this.getDb();
    const stmt = db.prepare(
      "SELECT COUNT(*) as count FROM jobs WHERE status = 'pending'"
    );
    const result = stmt.get() as { count: number };
    return result.count;
  }

  /**
   * Get queue status
   */
  getQueueStatus(): QueueStatus {
    const db = this.getDb();

    const statusStmt = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM jobs
      GROUP BY status
    `);
    const statusRows = statusStmt.all() as { status: JobStatus; count: number }[];

    const statusCounts: Record<string, number> = {};
    for (const row of statusRows) {
      statusCounts[row.status] = row.count;
    }

    const totalStmt = db.prepare("SELECT COUNT(*) as total FROM jobs");
    const totalResult = totalStmt.get() as { total: number };

    const avgStmt = db.prepare(`
      SELECT AVG(processing_time_ms) as avg_time
      FROM jobs
      WHERE status = 'completed' AND processing_time_ms IS NOT NULL
    `);
    const avgResult = avgStmt.get() as { avg_time: number | null };

    return {
      totalJobs: totalResult.total,
      pending: statusCounts.pending || 0,
      processing: statusCounts.processing || 0,
      completed: statusCounts.completed || 0,
      failed: statusCounts.failed || 0,
      avgProcessingTimeMs: avgResult.avg_time
        ? Math.round(avgResult.avg_time)
        : null,
    };
  }

  /**
   * Poll for job completion
   */
  async waitForJob(jobId: number, timeoutMs: number = 300000): Promise<Job> {
    const startTime = Date.now();
    const pollInterval = 1000;

    while (Date.now() - startTime < timeoutMs) {
      const job = this.getJob(jobId);

      if (!job) {
        throw new Error(`Job ${jobId} not found`);
      }

      if (job.status === "completed" || job.status === "failed") {
        return job;
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Job ${jobId} timed out after ${timeoutMs}ms`);
  }

  /**
   * Poll for submission completion
   */
  async waitForSubmission(
    submissionId: string,
    timeoutMs: number = 600000
  ): Promise<AudioSubmission> {
    const startTime = Date.now();
    const pollInterval = 1000;

    while (Date.now() - startTime < timeoutMs) {
      const submission = this.getSubmission(submissionId);

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
  // Job Processor Methods
  // ===========================================================================

  /**
   * Initialize database tables if they don't exist
   */
  initializeDatabase(): void {
    // Delegate to the database manager which handles migrations
    database.initialize();
  }

  /**
   * Claim the next pending job atomically
   * Uses UPDATE ... WHERE id = (SELECT ...) pattern to avoid race conditions
   */
  claimNextJob(): Job | null {
    const db = this.getDb();

    // Atomic claim: SELECT + UPDATE in one statement
    const stmt = db.prepare(`
      UPDATE jobs
      SET status = 'processing', started_at = datetime('now')
      WHERE id = (
        SELECT id FROM jobs
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT 1
      )
      RETURNING *
    `);

    const job = stmt.get() as Job | undefined;
    return job || null;
  }

  /**
   * Mark a job as completed with output and raw response
   */
  completeJob(
    jobId: number,
    outputText: string,
    modelUsed: string,
    processingTimeMs: number,
    confidence?: number,
    rawResponse?: unknown
  ): void {
    const db = this.getDb();

    const stmt = db.prepare(`
      UPDATE jobs
      SET status = 'completed',
          output_text = ?,
          model_used = ?,
          processing_time_ms = ?,
          confidence = ?,
          raw_response = ?,
          raw_response_type = ?,
          completed_at = datetime('now')
      WHERE id = ?
    `);

    stmt.run(
      outputText,
      modelUsed,
      processingTimeMs,
      confidence ?? null,
      rawResponse ? JSON.stringify(rawResponse) : null,
      rawResponse ? typeof rawResponse : null,
      jobId
    );
  }

  /**
   * Mark a job as failed with error message
   */
  failJob(jobId: number, errorMessage: string): void {
    const db = this.getDb();

    const stmt = db.prepare(`
      UPDATE jobs
      SET status = 'failed',
          error_message = ?,
          completed_at = datetime('now')
      WHERE id = ?
    `);

    stmt.run(errorMessage, jobId);
  }

  /**
   * Update submission status
   */
  updateSubmissionStatus(
    submissionId: string,
    status: SubmissionStatus,
    errorMessage?: string
  ): void {
    const db = this.getDb();

    if (errorMessage) {
      const stmt = db.prepare(`
        UPDATE audio_submissions
        SET status = ?, error_message = ?, updated_at = datetime('now')
        WHERE id = ?
      `);
      stmt.run(status, errorMessage, submissionId);
    } else {
      const stmt = db.prepare(`
        UPDATE audio_submissions
        SET status = ?, updated_at = datetime('now')
        WHERE id = ?
      `);
      stmt.run(status, submissionId);
    }
  }

  /**
   * Update submission with transcript
   */
  updateSubmissionTranscript(
    submissionId: string,
    transcript: string,
    jobId: number,
    confidence?: number
  ): void {
    const db = this.getDb();

    const stmt = db.prepare(`
      UPDATE audio_submissions
      SET transcript = ?,
          transcript_job_id = ?,
          transcript_confidence = ?,
          transcribed_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `);

    stmt.run(transcript, jobId, confidence ?? null, submissionId);
  }

  /**
   * Update submission with summary
   */
  updateSubmissionSummary(
    submissionId: string,
    summary: string,
    jobId: number,
    confidence?: number
  ): void {
    const db = this.getDb();

    const stmt = db.prepare(`
      UPDATE audio_submissions
      SET summary = ?,
          summary_job_id = ?,
          summary_confidence = ?,
          summarized_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `);

    stmt.run(summary, jobId, confidence ?? null, submissionId);
  }

  /**
   * Close database connection
   */
  close(): void {
    database.close();
  }

  // ===========================================================================
  // Stream Sessions
  // ===========================================================================

  /**
   * Create a new stream session linked to an audio submission
   */
  createStreamSession(params: CreateStreamSessionParams): StreamSession {
    const db = this.getDb();

    const stmt = db.prepare(`
      INSERT INTO stream_sessions (id, submission_id, title)
      VALUES (?, ?, ?)
    `);

    stmt.run(params.id, params.submissionId, params.title || null);

    return this.getStreamSession(params.id)!;
  }

  /**
   * Get a stream session by ID
   */
  getStreamSession(sessionId: string): StreamSession | null {
    const db = this.getDb();
    const stmt = db.prepare("SELECT * FROM stream_sessions WHERE id = ?");
    return stmt.get(sessionId) as StreamSession | null;
  }

  /**
   * Get stream session by submission ID
   */
  getStreamSessionBySubmission(submissionId: string): StreamSession | null {
    const db = this.getDb();
    const stmt = db.prepare("SELECT * FROM stream_sessions WHERE submission_id = ?");
    return stmt.get(submissionId) as StreamSession | null;
  }

  /**
   * Update stream session (for ending session, updating duration/chunk count)
   */
  updateStreamSession(
    sessionId: string,
    updates: {
      status?: SessionStatus;
      endedAt?: string;
      totalDurationMs?: number;
      chunkCount?: number;
    }
  ): void {
    const db = this.getDb();

    const setClauses: string[] = [];
    const params: (string | number)[] = [];

    if (updates.status !== undefined) {
      setClauses.push("status = ?");
      params.push(updates.status);
    }
    if (updates.endedAt !== undefined) {
      setClauses.push("ended_at = ?");
      params.push(updates.endedAt);
    }
    if (updates.totalDurationMs !== undefined) {
      setClauses.push("total_duration_ms = ?");
      params.push(updates.totalDurationMs);
    }
    if (updates.chunkCount !== undefined) {
      setClauses.push("chunk_count = ?");
      params.push(updates.chunkCount);
    }

    if (setClauses.length === 0) return;

    params.push(sessionId);
    const sql = `UPDATE stream_sessions SET ${setClauses.join(", ")} WHERE id = ?`;
    db.prepare(sql).run(...params);
  }

  /**
   * End a stream session
   */
  endStreamSession(sessionId: string, totalDurationMs: number): void {
    const db = this.getDb();

    // Get chunk count
    const countResult = db.prepare(
      "SELECT COUNT(*) as count FROM stream_chunks WHERE session_id = ?"
    ).get(sessionId) as { count: number };

    db.prepare(`
      UPDATE stream_sessions
      SET status = 'ended',
          ended_at = datetime('now'),
          total_duration_ms = ?,
          chunk_count = ?
      WHERE id = ?
    `).run(totalDurationMs, countResult.count, sessionId);
  }

  /**
   * Finalize a stream submission with file size and combined transcript
   */
  finalizeStreamSubmission(
    submissionId: string,
    fileSize: number,
    combinedTranscript?: string
  ): void {
    const db = this.getDb();

    if (combinedTranscript) {
      db.prepare(`
        UPDATE audio_submissions
        SET file_size = ?,
            transcript = ?,
            status = 'completed',
            updated_at = datetime('now')
        WHERE id = ?
      `).run(fileSize, combinedTranscript, submissionId);
    } else {
      db.prepare(`
        UPDATE audio_submissions
        SET file_size = ?,
            status = 'completed',
            updated_at = datetime('now')
        WHERE id = ?
      `).run(fileSize, submissionId);
    }
  }

  // ===========================================================================
  // Stream Chunks
  // ===========================================================================

  /**
   * Create a new stream chunk (utterance with speaker info)
   */
  createStreamChunk(params: CreateStreamChunkParams): StreamChunk {
    const db = this.getDb();

    const stmt = db.prepare(`
      INSERT INTO stream_chunks
      (session_id, chunk_index, speaker, transcript, confidence, start_time_ms, end_time_ms, word_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      params.sessionId,
      params.chunkIndex,
      params.speaker,
      params.transcript,
      params.confidence ?? null,
      params.startTimeMs,
      params.endTimeMs,
      params.wordCount ?? params.transcript.split(/\s+/).filter(Boolean).length
    );

    return this.getStreamChunk(result.lastInsertRowid as number)!;
  }

  /**
   * Get a stream chunk by ID
   */
  getStreamChunk(chunkId: number): StreamChunk | null {
    const db = this.getDb();
    const stmt = db.prepare("SELECT * FROM stream_chunks WHERE id = ?");
    return stmt.get(chunkId) as StreamChunk | null;
  }

  /**
   * Get all chunks for a session, ordered by index
   */
  getSessionChunks(sessionId: string): StreamChunk[] {
    const db = this.getDb();
    const stmt = db.prepare(
      "SELECT * FROM stream_chunks WHERE session_id = ? ORDER BY chunk_index ASC"
    );
    return stmt.all(sessionId) as StreamChunk[];
  }

  /**
   * Update chunk analysis status
   */
  updateChunkAnalysisStatus(
    chunkId: number,
    status: AnalysisStatus,
    jobId?: number
  ): void {
    const db = this.getDb();

    if (jobId !== undefined) {
      db.prepare(`
        UPDATE stream_chunks
        SET analysis_status = ?, analysis_job_id = ?
        WHERE id = ?
      `).run(status, jobId, chunkId);
    } else {
      db.prepare(`
        UPDATE stream_chunks
        SET analysis_status = ?
        WHERE id = ?
      `).run(status, chunkId);
    }
  }

  /**
   * Update chunk with analysis results
   */
  updateChunkAnalysis(
    chunkId: number,
    results: ChunkAnalysisResult
  ): void {
    const db = this.getDb();

    db.prepare(`
      UPDATE stream_chunks
      SET topics = ?,
          intents = ?,
          summary = ?,
          analysis_status = 'completed',
          analyzed_at = datetime('now')
      WHERE id = ?
    `).run(
      JSON.stringify(results.topics),
      JSON.stringify(results.intents),
      results.summary,
      chunkId
    );
  }

  /**
   * Get chunks pending analysis for a session
   */
  getPendingAnalysisChunks(sessionId: string): StreamChunk[] {
    const db = this.getDb();
    const stmt = db.prepare(`
      SELECT * FROM stream_chunks
      WHERE session_id = ? AND analysis_status = 'pending'
      ORDER BY chunk_index ASC
    `);
    return stmt.all(sessionId) as StreamChunk[];
  }

  // ===========================================================================
  // Analyze Chunk Jobs
  // ===========================================================================

  /**
   * Create an analyze_chunk job for a stream chunk
   */
  createAnalyzeChunkJob(params: CreateAnalyzeChunkJobParams): number {
    const db = this.getDb();

    // Get the chunk to get its transcript
    const chunk = this.getStreamChunk(params.chunkId);
    if (!chunk) {
      throw new Error(`Chunk ${params.chunkId} not found`);
    }

    // Create the job with chunk info in metadata
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

    // Update chunk to reference the job
    this.updateChunkAnalysisStatus(params.chunkId, "processing", jobId);

    return jobId;
  }

  // ===========================================================================
  // Additional Query Methods (for routes)
  // ===========================================================================

  /**
   * Get submissions with optional filtering (for GET /list)
   */
  getSubmissionsFiltered(query: {
    maxDuration?: number;
    minDuration?: number;
    minConfidence?: number;
    limit?: number;
    offset?: number;
  }): { submissions: AudioSubmission[]; total: number } {
    const db = this.getDb();

    // Build WHERE clause
    const conditions: string[] = [];
    const params: (number | string)[] = [];

    if (query.maxDuration !== undefined) {
      conditions.push("duration_seconds <= ?");
      params.push(query.maxDuration);
    }
    if (query.minDuration !== undefined) {
      conditions.push("duration_seconds >= ?");
      params.push(query.minDuration);
    }
    if (query.minConfidence !== undefined) {
      conditions.push("transcript_confidence >= ?");
      params.push(query.minConfidence);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Get total count
    const countStmt = db.prepare(`SELECT COUNT(*) as total FROM audio_submissions ${whereClause}`);
    const countResult = countStmt.get(...params) as { total: number };

    // Get paginated results
    const limit = query.limit || 100;
    const offset = query.offset || 0;

    const dataStmt = db.prepare(`
      SELECT * FROM audio_submissions
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);

    const submissions = dataStmt.all(...params, limit, offset) as AudioSubmission[];

    return { submissions, total: countResult.total };
  }

  /**
   * Get a submission by original filename (for GET /download)
   */
  getSubmissionByFilename(filename: string): AudioSubmission | null {
    const db = this.getDb();

    // Try original_filename first, then filename
    const stmt = db.prepare(`
      SELECT * FROM audio_submissions
      WHERE original_filename = ? OR filename = ?
      LIMIT 1
    `);

    return stmt.get(filename, filename) as AudioSubmission | null;
  }

  /**
   * Generate a unique display name for a file
   * If "hello.flac" exists, returns "hello_1.flac", "hello_2.flac", etc.
   */
  generateUniqueDisplayName(originalFilename: string): string {
    const db = this.getDb();

    // Parse filename into base and extension
    const lastDot = originalFilename.lastIndexOf(".");
    const baseName = lastDot > 0 ? originalFilename.slice(0, lastDot) : originalFilename;
    const extension = lastDot > 0 ? originalFilename.slice(lastDot) : "";

    // Check if exact name exists
    const exactMatch = db.prepare(
      "SELECT COUNT(*) as count FROM audio_submissions WHERE original_filename = ?"
    ).get(originalFilename) as { count: number };

    if (exactMatch.count === 0) {
      return originalFilename;
    }

    // Find existing files with pattern "baseName_N"
    // Count how many match the base pattern
    const pattern = `${baseName}_%`;
    const existingCount = db.prepare(`
      SELECT COUNT(*) as count FROM audio_submissions
      WHERE original_filename = ? OR original_filename LIKE ?
    `).get(originalFilename, pattern + extension) as { count: number };

    // Return next index
    return `${baseName}_${existingCount.count}${extension}`;
  }

  /**
   * Delete a submission and its associated data (for DELETE /files/:id)
   * Returns true if the submission was found and deleted
   */
  deleteSubmission(submissionId: string): boolean {
    const db = this.getDb();

    // Get the submission first to find the file path
    const submission = this.getSubmission(submissionId);
    if (!submission) {
      return false;
    }

    // Delete associated jobs
    db.prepare("DELETE FROM jobs WHERE audio_file_id = ?").run(submissionId);

    // Delete the submission
    const result = db.prepare("DELETE FROM audio_submissions WHERE id = ?").run(submissionId);

    // Delete the file from disk if it exists
    if (submission.file_path && fs.existsSync(submission.file_path)) {
      try {
        fs.unlinkSync(submission.file_path);
      } catch (err) {
        console.error(`Failed to delete file ${submission.file_path}:`, err);
      }
    }

    return result.changes > 0;
  }

  // ===========================================================================
  // Heartbeat Methods (for stuck job detection)
  // ===========================================================================

  /**
   * Update job heartbeat - called when job shows progress (e.g., token received)
   */
  updateJobHeartbeat(jobId: number, heartbeatCount: number): void {
    const db = this.getDb();

    const stmt = db.prepare(`
      UPDATE jobs
      SET last_heartbeat = datetime('now'),
          heartbeat_count = ?
      WHERE id = ?
    `);

    stmt.run(heartbeatCount, jobId);
  }

  /**
   * Mark that the model was verified as loaded before job started
   */
  markModelVerified(jobId: number): void {
    const db = this.getDb();

    db.prepare("UPDATE jobs SET model_verified = 1 WHERE id = ?").run(jobId);
  }

  /**
   * Find jobs that are stuck (processing but no heartbeat within timeout)
   * Returns jobs that have been processing longer than their timeout_seconds
   * without receiving a heartbeat
   */
  findStuckJobs(): Job[] {
    const db = this.getDb();

    const stmt = db.prepare(`
      SELECT * FROM jobs
      WHERE status = 'processing'
        AND (
          -- Job started but never got a heartbeat, and started_at is older than timeout
          (last_heartbeat IS NULL
           AND datetime(started_at, '+' || COALESCE(timeout_seconds, 300) || ' seconds') < datetime('now'))
          OR
          -- Job got heartbeats but last one is older than timeout
          (last_heartbeat IS NOT NULL
           AND datetime(last_heartbeat, '+' || COALESCE(timeout_seconds, 300) || ' seconds') < datetime('now'))
        )
    `);

    return stmt.all() as Job[];
  }

  /**
   * Recover a stuck job by marking it as failed
   */
  recoverStuckJob(jobId: number, reason: string): void {
    const job = this.getJob(jobId);
    if (!job) return;

    // Mark job as failed
    this.failJob(jobId, `Job stuck: ${reason}`);

    // Update submission status if linked
    if (job.audio_file_id) {
      this.updateSubmissionStatus(
        job.audio_file_id,
        "failed",
        `Job stuck: ${reason}`
      );
    }
  }

  /**
   * Get job with heartbeat info for monitoring
   */
  getJobWithHeartbeat(jobId: number): (Job & {
    last_heartbeat: string | null;
    heartbeat_count: number;
    model_verified: number;
  }) | null {
    const db = this.getDb();
    const stmt = db.prepare("SELECT * FROM jobs WHERE id = ?");
    return stmt.get(jobId) as (Job & {
      last_heartbeat: string | null;
      heartbeat_count: number;
      model_verified: number;
    }) | null;
  }
}

// Export singleton instance
export const inferenceQueue = new InferenceQueueService();
