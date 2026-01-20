-- Deepgram Audio Projects Database Schema
-- This file documents the complete database schema.
-- Actual migrations are in the migrations/ folder.

--------------------------------------------------------------------------------
-- SCHEMA MIGRATIONS TABLE
-- Tracks which migrations have been applied to this database.
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

--------------------------------------------------------------------------------
-- JOBS TABLE
-- Stores inference jobs (transcription and summarization) in a processing queue.
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type TEXT NOT NULL CHECK(job_type IN ('transcribe', 'summarize')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
  provider TEXT NOT NULL DEFAULT 'local' CHECK(provider IN ('local', 'deepgram')),

  -- Input data (one of these will be set depending on job_type)
  input_file_path TEXT,           -- For transcribe jobs: path to audio file
  input_text TEXT,                -- For summarize jobs: transcript text to summarize

  -- Output data
  output_text TEXT,               -- Result: transcript or summary text
  error_message TEXT,             -- Error details if job failed

  -- Link to audio submission
  audio_file_id TEXT REFERENCES audio_submissions(id),

  -- Additional metadata (JSON)
  metadata TEXT,

  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,

  -- Processing metrics
  processing_time_ms INTEGER,
  model_used TEXT,

  -- Raw provider response (JSON, for debugging/audit)
  raw_response TEXT,
  raw_response_type TEXT,

  -- Heartbeat tracking for stuck job detection (added in migration 002)
  last_heartbeat TEXT,            -- Last time job showed progress (e.g., token received)
  heartbeat_count INTEGER DEFAULT 0,  -- Number of heartbeats/tokens received
  timeout_seconds INTEGER DEFAULT 300, -- Timeout before job is considered stuck
  model_verified INTEGER DEFAULT 0    -- 1 if model was verified loaded before job started
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_audio_file_id ON jobs(audio_file_id);

-- Index for efficiently finding stuck jobs
CREATE INDEX IF NOT EXISTS idx_jobs_stuck_detection
  ON jobs(status, last_heartbeat)
  WHERE status = 'processing';

--------------------------------------------------------------------------------
-- AUDIO SUBMISSIONS TABLE
-- Stores uploaded audio files and their processing results.
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audio_submissions (
  id TEXT PRIMARY KEY,

  -- File information
  filename TEXT NOT NULL,         -- Stored filename (UUID-based)
  original_filename TEXT,         -- Original uploaded filename
  file_path TEXT NOT NULL,        -- Full path to file on disk
  mime_type TEXT,
  file_size INTEGER,
  duration_seconds REAL,

  -- Processing results
  transcript TEXT,
  transcript_job_id INTEGER REFERENCES jobs(id),
  transcribed_at TEXT,

  summary TEXT,
  summary_job_id INTEGER REFERENCES jobs(id),
  summarized_at TEXT,

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'transcribing', 'summarizing', 'completed', 'failed')),
  error_message TEXT,

  -- Custom metadata (JSON)
  metadata TEXT,

  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_submissions_status ON audio_submissions(status);
CREATE INDEX IF NOT EXISTS idx_submissions_created_at ON audio_submissions(created_at);
