/**
 * Submission Service
 *
 * Handles audio submission CRUD operations.
 * Extracted from InferenceQueueService for better separation of concerns.
 */

import Database from "better-sqlite3";
import fs from "fs";
import { database } from "../db/database.js";
import { Provider } from "../types/index.js";

export type SubmissionStatus = "pending" | "transcribing" | "summarizing" | "completed" | "failed" | "streaming";

export interface AudioSubmission {
  id: string;
  filename: string;
  original_filename: string | null;
  file_path: string;
  mime_type: string | null;
  file_size: number | null;
  duration_seconds: number | null;
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

export class SubmissionService {
  private getDb(): Database.Database {
    return database.getConnection();
  }

  /**
   * Create a new audio submission (without auto-processing - use InferenceQueueService for that)
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
   * Get submissions with optional filtering (for GET /list)
   */
  getSubmissionsFiltered(query: {
    maxDuration?: number;
    minDuration?: number;
    limit?: number;
    offset?: number;
  }): { submissions: AudioSubmission[]; total: number } {
    const db = this.getDb();

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

    const countStmt = db.prepare(`SELECT COUNT(*) as total FROM audio_submissions ${whereClause}`);
    const countResult = countStmt.get(...params) as { total: number };

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
   * Get a submission by original filename
   */
  getSubmissionByFilename(filename: string): AudioSubmission | null {
    const db = this.getDb();
    const stmt = db.prepare(`
      SELECT * FROM audio_submissions
      WHERE original_filename = ? OR filename = ?
      LIMIT 1
    `);
    return stmt.get(filename, filename) as AudioSubmission | null;
  }

  /**
   * Generate a unique display name for a file
   */
  generateUniqueDisplayName(originalFilename: string): string {
    const db = this.getDb();

    const lastDot = originalFilename.lastIndexOf(".");
    const baseName = lastDot > 0 ? originalFilename.slice(0, lastDot) : originalFilename;
    const extension = lastDot > 0 ? originalFilename.slice(lastDot) : "";

    const exactMatch = db.prepare(
      "SELECT COUNT(*) as count FROM audio_submissions WHERE original_filename = ?"
    ).get(originalFilename) as { count: number };

    if (exactMatch.count === 0) {
      return originalFilename;
    }

    const pattern = `${baseName}_%`;
    const existingCount = db.prepare(`
      SELECT COUNT(*) as count FROM audio_submissions
      WHERE original_filename = ? OR original_filename LIKE ?
    `).get(originalFilename, pattern + extension) as { count: number };

    return `${baseName}_${existingCount.count}${extension}`;
  }

  /**
   * Delete a submission and its file from disk
   * Note: Associated jobs should be deleted separately
   */
  deleteSubmission(submissionId: string): boolean {
    const db = this.getDb();

    const submission = this.getSubmission(submissionId);
    if (!submission) {
      return false;
    }

    const result = db.prepare("DELETE FROM audio_submissions WHERE id = ?").run(submissionId);

    if (submission.file_path && fs.existsSync(submission.file_path)) {
      try {
        fs.unlinkSync(submission.file_path);
      } catch (err) {
        console.error(`Failed to delete file ${submission.file_path}:`, err);
      }
    }

    return result.changes > 0;
  }

  /**
   * Finalize a stream submission with file size and duration
   */
  finalizeStreamSubmission(
    submissionId: string,
    fileSize: number,
    durationSeconds: number
  ): void {
    const db = this.getDb();

    db.prepare(`
      UPDATE audio_submissions
      SET file_size = ?,
          duration_seconds = ?,
          status = 'completed',
          updated_at = datetime('now')
      WHERE id = ?
    `).run(fileSize, durationSeconds, submissionId);
  }
}

export const submissionService = new SubmissionService();
