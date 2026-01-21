-- Migration: Add 'streaming' status to audio_submissions
-- SQLite requires table recreation to modify CHECK constraints

PRAGMA foreign_keys=OFF;

-- Create new table with updated constraint
CREATE TABLE audio_submissions_new (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  original_filename TEXT,
  file_path TEXT NOT NULL,
  mime_type TEXT,
  file_size INTEGER,
  duration_seconds REAL,
  transcript TEXT,
  transcript_job_id INTEGER REFERENCES jobs(id),
  transcribed_at TEXT,
  summary TEXT,
  summary_job_id INTEGER REFERENCES jobs(id),
  summarized_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'streaming', 'transcribing', 'summarizing', 'completed', 'failed')),
  error_message TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  transcript_confidence REAL DEFAULT NULL,
  summary_confidence REAL DEFAULT NULL
);

-- Copy data from old table
INSERT INTO audio_submissions_new SELECT * FROM audio_submissions;

-- Drop old table
DROP TABLE audio_submissions;

-- Rename new table
ALTER TABLE audio_submissions_new RENAME TO audio_submissions;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_submissions_status ON audio_submissions(status);
CREATE INDEX IF NOT EXISTS idx_submissions_created_at ON audio_submissions(created_at);

PRAGMA foreign_keys=ON;
