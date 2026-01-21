-- Migration: Add text intelligence fields to audio_submissions
-- Allows reusing the same Deepgram analysis (topics, intents, sentiment) for file uploads

ALTER TABLE audio_submissions ADD COLUMN topics TEXT DEFAULT NULL;
-- JSON: [{topic: string, confidence: number}]

ALTER TABLE audio_submissions ADD COLUMN intents TEXT DEFAULT NULL;
-- JSON: [{intent: string, confidence: number}]

ALTER TABLE audio_submissions ADD COLUMN sentiment TEXT DEFAULT NULL;
-- JSON: {sentiment: "positive"|"negative"|"neutral", sentimentScore: number, average: {...}}
