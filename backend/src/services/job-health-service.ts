/**
 * Job Health Service
 *
 * Handles job heartbeats, stuck job detection, and recovery.
 * Extracted from InferenceQueueService for better separation of concerns.
 */

import Database from "better-sqlite3";
import { database } from "../db/database.js";
import type { Job } from "./job-service.js";
import { submissionService } from "./submission-service.js";

export interface JobWithHeartbeat extends Job {
  last_heartbeat: string | null;
  heartbeat_count: number;
  model_verified: number;
}

export class JobHealthService {
  private getDb(): Database.Database {
    return database.getConnection();
  }

  /**
   * Update job heartbeat - called when job shows progress
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

    const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as Job | null;
    if (!job) return;

    // Mark job as failed
    db.prepare(`
      UPDATE jobs
      SET status = 'failed',
          error_message = ?,
          completed_at = datetime('now')
      WHERE id = ? AND status = 'processing'
    `).run(`Job stuck: ${reason}`, jobId);

    // Update submission status if linked
    if (job.audio_file_id) {
      submissionService.updateSubmissionStatus(
        job.audio_file_id,
        "failed",
        `Job stuck: ${reason}`
      );
    }
  }

  /**
   * Get job with heartbeat info for monitoring
   */
  getJobWithHeartbeat(jobId: number): JobWithHeartbeat | null {
    const db = this.getDb();
    const stmt = db.prepare("SELECT * FROM jobs WHERE id = ?");
    return stmt.get(jobId) as JobWithHeartbeat | null;
  }
}

export const jobHealthService = new JobHealthService();
