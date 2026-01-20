-- Migration 002: Add job heartbeat tracking for stuck job detection
--
-- Problem: Jobs can appear "processing" but be stuck because:
-- 1. Model failed to load silently
-- 2. Inference hung without producing output
-- 3. Network timeout not detected
--
-- Solution: Track actual job progress via heartbeat (token streaming)

-- Last time we received proof of job progress (e.g., a streaming token)
ALTER TABLE jobs ADD COLUMN last_heartbeat TEXT;

-- Number of heartbeat signals received (e.g., tokens generated)
ALTER TABLE jobs ADD COLUMN heartbeat_count INTEGER DEFAULT 0;

-- Timeout in seconds - job is considered stuck if no heartbeat within this window
ALTER TABLE jobs ADD COLUMN timeout_seconds INTEGER DEFAULT 300;

-- Whether the model was verified as loaded before job started
ALTER TABLE jobs ADD COLUMN model_verified INTEGER DEFAULT 0;

-- Add index for finding stuck jobs efficiently
CREATE INDEX IF NOT EXISTS idx_jobs_stuck_detection
  ON jobs(status, last_heartbeat)
  WHERE status = 'processing';
