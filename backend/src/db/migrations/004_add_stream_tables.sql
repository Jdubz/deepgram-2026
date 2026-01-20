-- Migration 004: Stream sessions and chunks
-- Adds tables for persistent streaming with real-time analysis

-- Stream sessions table - links to existing audio_submissions
CREATE TABLE IF NOT EXISTS stream_sessions (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  title TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  total_duration_ms INTEGER DEFAULT 0,
  chunk_count INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'ended')),
  FOREIGN KEY (submission_id) REFERENCES audio_submissions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_stream_sessions_submission
  ON stream_sessions(submission_id);
CREATE INDEX IF NOT EXISTS idx_stream_sessions_status
  ON stream_sessions(status);

-- Stream chunks table - utterances with speaker diarization
CREATE TABLE IF NOT EXISTS stream_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  speaker INTEGER,                    -- Speaker ID (0, 1, 2...)
  transcript TEXT NOT NULL,
  confidence REAL,
  start_time_ms INTEGER NOT NULL,
  end_time_ms INTEGER NOT NULL,
  word_count INTEGER DEFAULT 0,
  -- Analysis results (populated by analyze_chunk jobs)
  topics TEXT,                        -- JSON: [{topic, confidence}]
  intents TEXT,                       -- JSON: [{intent, confidence}]
  summary TEXT,
  analysis_job_id INTEGER,
  analysis_status TEXT NOT NULL DEFAULT 'pending'
    CHECK(analysis_status IN ('pending', 'processing', 'completed', 'skipped')),
  analyzed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES stream_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (analysis_job_id) REFERENCES jobs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_stream_chunks_session
  ON stream_chunks(session_id);
CREATE INDEX IF NOT EXISTS idx_stream_chunks_analysis_status
  ON stream_chunks(analysis_status);
