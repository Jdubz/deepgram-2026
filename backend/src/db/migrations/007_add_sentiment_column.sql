-- Migration: Add sentiment column to stream_chunks
-- Stores sentiment analysis results from Deepgram Text Intelligence API

ALTER TABLE stream_chunks ADD COLUMN sentiment TEXT;
-- JSON: {sentiment: "positive"|"negative"|"neutral", sentimentScore: number, average: {...}}
