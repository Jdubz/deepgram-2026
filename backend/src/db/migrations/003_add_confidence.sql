-- Migration 003: Add confidence scores
-- Adds confidence tracking for transcription and summarization quality

-- Add confidence to jobs table
ALTER TABLE jobs ADD COLUMN confidence REAL DEFAULT NULL;

-- Add confidence to submissions for easy querying
ALTER TABLE audio_submissions ADD COLUMN transcript_confidence REAL DEFAULT NULL;
ALTER TABLE audio_submissions ADD COLUMN summary_confidence REAL DEFAULT NULL;

-- Index for filtering by confidence
CREATE INDEX IF NOT EXISTS idx_submissions_confidence
  ON audio_submissions(transcript_confidence)
  WHERE transcript_confidence IS NOT NULL;
