/**
 * Stream Service
 *
 * Handles stream sessions and chunks.
 * Extracted from InferenceQueueService for better separation of concerns.
 */

import Database from "better-sqlite3";
import { database } from "../db/database.js";
import { Provider } from "../types/index.js";
import type { Job, JobType, JobStatus } from "./job-service.js";

export type SessionStatus = "active" | "ended";

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
  analysis_job_id: number | null;
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

export interface ChunkWithAnalysis extends StreamChunk {
  analysisJob: Job | null;
}

export class StreamService {
  private getDb(): Database.Database {
    return database.getConnection();
  }

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
   * Get the most recent session (for replay when no in-memory session exists)
   * Returns the most recently started session that has chunks
   */
  getMostRecentSession(): StreamSession | null {
    const db = this.getDb();
    const stmt = db.prepare(`
      SELECT s.* FROM stream_sessions s
      WHERE EXISTS (SELECT 1 FROM stream_chunks c WHERE c.session_id = s.id)
      ORDER BY s.started_at DESC
      LIMIT 1
    `);
    return stmt.get() as StreamSession | null;
  }

  /**
   * Get all chunks from all sessions, ordered by creation time
   * Used to replay full transcript history to viewers
   */
  getAllChunks(): StreamChunk[] {
    const db = this.getDb();
    const stmt = db.prepare(`
      SELECT * FROM stream_chunks
      ORDER BY created_at ASC
    `);
    return stmt.all() as StreamChunk[];
  }

  /**
   * Update stream session
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
   * Create a new stream chunk
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
   * Get chunks that need analysis
   */
  getChunksNeedingAnalysis(sessionId: string): StreamChunk[] {
    const db = this.getDb();
    const stmt = db.prepare(`
      SELECT * FROM stream_chunks
      WHERE session_id = ? AND analysis_job_id IS NULL
      ORDER BY chunk_index ASC
    `);
    return stmt.all(sessionId) as StreamChunk[];
  }

  /**
   * Set the analysis job ID for a chunk
   */
  setChunkAnalysisJob(chunkId: number, jobId: number): void {
    const db = this.getDb();
    db.prepare("UPDATE stream_chunks SET analysis_job_id = ? WHERE id = ?").run(
      jobId,
      chunkId
    );
  }

  /**
   * Get all chunks from all sessions with their analysis jobs
   * Used to replay full transcript history to viewers
   */
  getAllChunksWithAnalysis(): ChunkWithAnalysis[] {
    const db = this.getDb();

    const rows = db.prepare(`
      SELECT
        c.id, c.session_id, c.chunk_index, c.speaker, c.transcript,
        c.confidence, c.start_time_ms, c.end_time_ms, c.word_count,
        c.analysis_job_id, c.created_at,
        j.id as job_id, j.job_type as job_type, j.status as job_status,
        j.provider as job_provider, j.output_text as job_output_text,
        j.error_message as job_error_message, j.created_at as job_created_at,
        j.completed_at as job_completed_at, j.processing_time_ms as job_processing_time_ms,
        j.model_used as job_model_used, j.confidence as job_confidence,
        j.raw_response as job_raw_response
      FROM stream_chunks c
      LEFT JOIN jobs j ON c.analysis_job_id = j.id
      ORDER BY c.created_at ASC
    `).all() as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: row.id as number,
      session_id: row.session_id as string,
      chunk_index: row.chunk_index as number,
      speaker: row.speaker as number | null,
      transcript: row.transcript as string,
      confidence: row.confidence as number | null,
      start_time_ms: row.start_time_ms as number,
      end_time_ms: row.end_time_ms as number,
      word_count: row.word_count as number,
      analysis_job_id: row.analysis_job_id as number | null,
      created_at: row.created_at as string,
      analysisJob: row.job_id ? {
        id: row.job_id as number,
        job_type: row.job_type as JobType,
        status: row.job_status as JobStatus,
        provider: row.job_provider as Provider,
        input_file_path: null,
        input_text: null,
        output_text: row.job_output_text as string | null,
        error_message: row.job_error_message as string | null,
        audio_file_id: null,
        metadata: null,
        created_at: row.job_created_at as string,
        started_at: null,
        completed_at: row.job_completed_at as string | null,
        processing_time_ms: row.job_processing_time_ms as number | null,
        model_used: row.job_model_used as string | null,
        confidence: row.job_confidence as number | null,
        raw_response: row.job_raw_response as string | null,
        raw_response_type: null,
      } : null,
    }));
  }

  /**
   * Get all chunks for a session with their analysis jobs (single efficient query)
   */
  getSessionChunksWithAnalysis(sessionId: string): ChunkWithAnalysis[] {
    const db = this.getDb();

    const rows = db.prepare(`
      SELECT
        c.id, c.session_id, c.chunk_index, c.speaker, c.transcript,
        c.confidence, c.start_time_ms, c.end_time_ms, c.word_count,
        c.analysis_job_id, c.created_at,
        j.id as job_id, j.job_type as job_type, j.status as job_status,
        j.provider as job_provider, j.output_text as job_output_text,
        j.error_message as job_error_message, j.created_at as job_created_at,
        j.completed_at as job_completed_at, j.processing_time_ms as job_processing_time_ms,
        j.model_used as job_model_used, j.confidence as job_confidence,
        j.raw_response as job_raw_response
      FROM stream_chunks c
      LEFT JOIN jobs j ON c.analysis_job_id = j.id
      WHERE c.session_id = ?
      ORDER BY c.chunk_index ASC
    `).all(sessionId) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: row.id as number,
      session_id: row.session_id as string,
      chunk_index: row.chunk_index as number,
      speaker: row.speaker as number | null,
      transcript: row.transcript as string,
      confidence: row.confidence as number | null,
      start_time_ms: row.start_time_ms as number,
      end_time_ms: row.end_time_ms as number,
      word_count: row.word_count as number,
      analysis_job_id: row.analysis_job_id as number | null,
      created_at: row.created_at as string,
      analysisJob: row.job_id ? {
        id: row.job_id as number,
        job_type: row.job_type as JobType,
        status: row.job_status as JobStatus,
        provider: row.job_provider as Provider,
        input_file_path: null,
        input_text: null,
        output_text: row.job_output_text as string | null,
        error_message: row.job_error_message as string | null,
        audio_file_id: null,
        metadata: null,
        created_at: row.job_created_at as string,
        started_at: null,
        completed_at: row.job_completed_at as string | null,
        processing_time_ms: row.job_processing_time_ms as number | null,
        model_used: row.job_model_used as string | null,
        confidence: row.job_confidence as number | null,
        raw_response: row.job_raw_response as string | null,
        raw_response_type: null,
      } : null,
    }));
  }
}

export const streamService = new StreamService();
