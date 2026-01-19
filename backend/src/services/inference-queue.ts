/**
 * Inference Queue Service
 *
 * Provides an interface for the API to:
 * 1. Create audio submissions (tracked in audio_submissions table)
 * 2. Create inference jobs (transcribe, summarize)
 * 3. Query job and submission status
 *
 * Uses the same SQLite database as the Python worker.
 */

import Database from "better-sqlite3";
import path from "path";

// Path to shared SQLite database
const DB_PATH = path.resolve(__dirname, "../../../llm-inference/queue.db");

export type JobType = "transcribe" | "summarize";
export type JobStatus = "pending" | "processing" | "completed" | "failed";
export type SubmissionStatus = "pending" | "transcribing" | "summarizing" | "completed" | "failed";
export type TranscribeProvider = "local" | "deepgram";
export type SummarizeProvider = "local" | "openai" | "anthropic";

export interface Job {
  id: number;
  job_type: JobType;
  status: JobStatus;
  provider: string;
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
  autoProcess?: boolean; // If true, auto-create transcribe job
  transcribeProvider?: TranscribeProvider; // Provider for transcription (default: local)
}

export interface CreateTranscribeJobParams {
  audioFilePath: string;
  audioFileId?: string;
  metadata?: Record<string, unknown>;
  provider?: TranscribeProvider;
}

export interface CreateSummarizeJobParams {
  text: string;
  audioFileId?: string;
  metadata?: Record<string, unknown>;
  provider?: SummarizeProvider;
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
  private db: Database.Database | null = null;

  /**
   * Get database connection (lazy initialization)
   */
  private getDb(): Database.Database {
    if (!this.db) {
      this.db = new Database(DB_PATH);
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("busy_timeout = 30000");
    }
    return this.db;
  }

  /**
   * Check if the database is initialized
   */
  isInitialized(): boolean {
    try {
      const db = this.getDb();
      const result = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'"
        )
        .get();
      return !!result;
    } catch {
      return false;
    }
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
        provider: params.transcribeProvider || "local",
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
      params.provider || "local"
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
      params.provider || "local"
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

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// Export singleton instance
export const inferenceQueue = new InferenceQueueService();
