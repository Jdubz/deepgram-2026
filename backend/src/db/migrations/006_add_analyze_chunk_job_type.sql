-- Migration: Add 'analyze_chunk' job type to jobs table
-- SQLite requires table recreation to modify CHECK constraints

-- Disable foreign keys for this migration
PRAGMA foreign_keys=OFF;

-- Create new table with updated constraint
CREATE TABLE jobs_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type TEXT NOT NULL CHECK(job_type IN ('transcribe', 'summarize', 'analyze_chunk')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
  provider TEXT NOT NULL DEFAULT 'local' CHECK(provider IN ('local', 'deepgram')),
  input_file_path TEXT,
  input_text TEXT,
  output_text TEXT,
  error_message TEXT,
  audio_file_id TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,
  processing_time_ms INTEGER,
  model_used TEXT,
  raw_response TEXT,
  raw_response_type TEXT,
  last_heartbeat TEXT,
  heartbeat_count INTEGER DEFAULT 0,
  timeout_seconds INTEGER DEFAULT 300,
  model_verified INTEGER DEFAULT 0,
  confidence REAL DEFAULT NULL
);

-- Copy data from old table
INSERT INTO jobs_new SELECT * FROM jobs;

-- Drop old table
DROP TABLE jobs;

-- Rename new table
ALTER TABLE jobs_new RENAME TO jobs;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(job_type);
CREATE INDEX IF NOT EXISTS idx_jobs_audio_file ON jobs(audio_file_id);

-- Note: foreign_keys will be re-enabled on next connection
