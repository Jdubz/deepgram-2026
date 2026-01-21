-- Migration: Jobs as single source of truth
-- Remove redundant result columns from audio_submissions and stream_chunks
-- All analysis results are now stored only in the jobs table

-- Step 1: Recreate audio_submissions without result columns
-- Removed: transcript, transcript_job_id, transcript_confidence, transcribed_at,
--          summary, summary_job_id, summary_confidence, summarized_at,
--          topics, intents, sentiment
CREATE TABLE audio_submissions_new (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  original_filename TEXT,
  file_path TEXT NOT NULL,
  mime_type TEXT,
  file_size INTEGER,
  duration_seconds REAL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'streaming', 'transcribing', 'summarizing', 'completed', 'failed')),
  error_message TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO audio_submissions_new (id, filename, original_filename, file_path,
  mime_type, file_size, duration_seconds, status, error_message, metadata, created_at, updated_at)
SELECT id, filename, original_filename, file_path, mime_type, file_size, duration_seconds,
  status, error_message, metadata, created_at, updated_at
FROM audio_submissions;

DROP TABLE audio_submissions;
ALTER TABLE audio_submissions_new RENAME TO audio_submissions;

-- Recreate indexes for audio_submissions
CREATE INDEX idx_submissions_status ON audio_submissions(status);
CREATE INDEX idx_submissions_created_at ON audio_submissions(created_at);

-- Step 2: Recreate stream_chunks without analysis result columns
-- Removed: topics, intents, summary, sentiment, analysis_status, analyzed_at
-- Kept: analysis_job_id (to link to the job for results)
CREATE TABLE stream_chunks_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  speaker INTEGER,
  transcript TEXT NOT NULL,
  confidence REAL,
  start_time_ms INTEGER NOT NULL,
  end_time_ms INTEGER NOT NULL,
  word_count INTEGER DEFAULT 0,
  analysis_job_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES stream_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (analysis_job_id) REFERENCES jobs(id) ON DELETE SET NULL
);

INSERT INTO stream_chunks_new (id, session_id, chunk_index, speaker, transcript,
  confidence, start_time_ms, end_time_ms, word_count, analysis_job_id, created_at)
SELECT id, session_id, chunk_index, speaker, transcript, confidence,
  start_time_ms, end_time_ms, word_count, analysis_job_id, created_at
FROM stream_chunks;

DROP TABLE stream_chunks;
ALTER TABLE stream_chunks_new RENAME TO stream_chunks;

-- Recreate indexes for stream_chunks
CREATE INDEX idx_stream_chunks_session ON stream_chunks(session_id);
CREATE INDEX idx_stream_chunks_analysis_job ON stream_chunks(analysis_job_id);
