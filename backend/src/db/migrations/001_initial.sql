-- Migration 001: Initial Schema
-- Creates the core tables for the audio processing queue system.

-- Jobs table: stores inference jobs (transcribe/summarize)
CREATE TABLE IF NOT EXISTS jobs (
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
  raw_response_type TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_audio_file_id ON jobs(audio_file_id);

-- Audio submissions table: stores uploaded files and processing results
CREATE TABLE IF NOT EXISTS audio_submissions (
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
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_submissions_status ON audio_submissions(status);
CREATE INDEX IF NOT EXISTS idx_submissions_created_at ON audio_submissions(created_at);
