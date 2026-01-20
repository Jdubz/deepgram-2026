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

export type JobType = "transcribe" | "summarize";
export type JobStatus = "pending" | "processing" | "completed" | "failed";
export type SubmissionStatus = "pending" | "transcribing" | "summarizing" | "completed" | "failed";

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
  transcribed_at: string | null;
  summary: string | null;
  summary_job_id: number | null;
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
    rawResponse?: unknown
  ): void {
    const db = this.getDb();

    const stmt = db.prepare(`
      UPDATE jobs
      SET status = 'completed',
          output_text = ?,
          model_used = ?,
          processing_time_ms = ?,
          raw_response = ?,
          raw_response_type = ?,
          completed_at = datetime('now')
      WHERE id = ?
    `);

    stmt.run(
      outputText,
      modelUsed,
      processingTimeMs,
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
    jobId: number
  ): void {
    const db = this.getDb();

    const stmt = db.prepare(`
      UPDATE audio_submissions
      SET transcript = ?,
          transcript_job_id = ?,
          transcribed_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `);

    stmt.run(transcript, jobId, submissionId);
  }

  /**
   * Update submission with summary
   */
  updateSubmissionSummary(
    submissionId: string,
    summary: string,
    jobId: number
  ): void {
    const db = this.getDb();

    const stmt = db.prepare(`
      UPDATE audio_submissions
      SET summary = ?,
          summary_job_id = ?,
          summarized_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `);

    stmt.run(summary, jobId, submissionId);
  }

  /**
   * Close database connection
   */
  close(): void {
    database.close();
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
    const db = this.getDb();

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
