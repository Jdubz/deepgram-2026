/**
 * Audio Processing Service
 *
 * Handles audio file validation and metadata extraction.
 *
 * STUDY EXERCISES:
 * - Exercise 8: Implement robust file validation
 * - Understand audio formats and metadata
 */

import { parseBuffer } from "music-metadata";
import { AudioMetadata } from "../types/index.js";
import { v4 as uuidv4 } from "uuid";

// Allowed MIME types for audio files
const ALLOWED_MIME_TYPES = new Set([
  "audio/wav",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp3",
  "audio/ogg",
  "audio/flac",
  "audio/webm",
  "audio/mp4",
  "audio/aac",
]);

// Max file size: 100MB
const MAX_FILE_SIZE = 100 * 1024 * 1024;

export interface ValidationResult {
  valid: boolean;
  error?: string;
  metadata?: AudioMetadata;
}

export const audioService = {
  /**
   * Validate and extract metadata from an audio buffer
   */
  async validateAndExtract(
    buffer: Buffer,
    originalFilename: string,
    customMetadata: Record<string, string> = {}
  ): Promise<ValidationResult> {
    // Check file size
    if (buffer.length > MAX_FILE_SIZE) {
      return {
        valid: false,
        error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`,
      };
    }

    if (buffer.length === 0) {
      return {
        valid: false,
        error: "Empty file",
      };
    }

    try {
      // Parse audio metadata using music-metadata
      const mm = await parseBuffer(buffer);

      const mimeType = mm.format.container || "audio/unknown";
      const duration = mm.format.duration || 0;
      const channels = mm.format.numberOfChannels;
      const sampleRate = mm.format.sampleRate;

      /**
       * TODO (Exercise 8): Add more robust validation
       *
       * 1. Check magic bytes to verify actual file type
       * 2. Validate MIME type against allowed list
       * 3. Check for malformed audio data
       * 4. Sanitize filename to prevent path traversal
       */

      const id = uuidv4();
      const sanitizedFilename = this.sanitizeFilename(originalFilename);

      const metadata: AudioMetadata = {
        id,
        filename: sanitizedFilename,
        originalFilename,
        mimeType,
        size: buffer.length,
        duration,
        channels,
        sampleRate,
        uploadedAt: new Date(),
        customMetadata,
      };

      return { valid: true, metadata };
    } catch (error) {
      return {
        valid: false,
        error: `Could not parse audio file: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },

  /**
   * Sanitize filename to prevent security issues
   *
   * TODO (Exercise 8): Make this more robust
   */
  sanitizeFilename(filename: string): string {
    // Remove path components
    const basename = filename.split(/[/\\]/).pop() || filename;

    // Remove dangerous characters
    return basename.replace(/[^a-zA-Z0-9._-]/g, "_");
  },

  /**
   * Check if a MIME type is allowed
   */
  isAllowedMimeType(mimeType: string): boolean {
    return ALLOWED_MIME_TYPES.has(mimeType.toLowerCase());
  },
};
