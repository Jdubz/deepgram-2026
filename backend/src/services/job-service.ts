/**
 * Job Service
 *
 * Handles inference job CRUD, claiming, and completion.
 * Extracted from InferenceQueueService for better separation of concerns.
 */

import Database from "better-sqlite3";
import { database } from "../db/database.js";
import { Provider } from "../types/index.js";

export type JobType = "transcribe" | "summarize" | "analyze_chunk";
export type JobStatus = "pending" | "processing" | "completed" | "failed";

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

export interface QueueStatus {
  totalJobs: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  avgProcessingTimeMs: number | null;
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

export class JobService {
  private getDb(): Database.Database {
    return database.getConnection();
  }

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
   * Claim the next pending job atomically
   */
  claimNextJob(): Job | null {
    const db = this.getDb();

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
      WHERE id = ? AND status = 'processing'
    `);

    const result = stmt.run(
      outputText,
      modelUsed,
      processingTimeMs,
      confidence ?? null,
      rawResponse ? JSON.stringify(rawResponse) : null,
      rawResponse ? typeof rawResponse : null,
      jobId
    );

    if (result.changes === 0) {
      const job = this.getJob(jobId);
      if (!job) {
        console.warn(`[JobService] completeJob: Job ${jobId} not found`);
      } else if (job.status !== "processing") {
        console.warn(
          `[JobService] completeJob: Job ${jobId} was in '${job.status}' state, not 'processing'`
        );
      }
    }
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
      WHERE id = ? AND status = 'processing'
    `);

    const result = stmt.run(errorMessage, jobId);

    if (result.changes === 0) {
      const job = this.getJob(jobId);
      if (!job) {
        console.warn(`[JobService] failJob: Job ${jobId} not found`);
      } else if (job.status !== "processing") {
        console.warn(
          `[JobService] failJob: Job ${jobId} was in '${job.status}' state, not 'processing'`
        );
      }
    }
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
   * Delete jobs for a submission
   */
  deleteJobsForSubmission(audioFileId: string): void {
    const db = this.getDb();
    db.prepare("DELETE FROM jobs WHERE audio_file_id = ?").run(audioFileId);
  }
}

export const jobService = new JobService();
