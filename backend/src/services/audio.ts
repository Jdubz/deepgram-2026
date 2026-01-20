/**
 * Audio Processing Service
 *
 * Handles audio file validation and metadata extraction using the music-metadata library.
 * Supports various audio formats including WAV, MP3, FLAC, OGG, and more.
 *
 * Features:
 * - File size validation
 * - Audio metadata extraction (duration, channels, sample rate)
 * - FLAC-specific duration parsing for files with missing metadata
 * - Duration estimation fallback based on file size and codec
 * - Filename sanitization for security
 */

import { parseBuffer } from "music-metadata";
import { AudioMetadata } from "../types/index.js";
import {
  MAX_FILE_SIZE_BYTES,
  ALLOWED_AUDIO_MIME_TYPES,
  AVERAGE_AUDIO_BITRATES,
} from "../constants.js";

export interface ValidationResult {
  valid: boolean;
  error?: string;
  metadata?: AudioMetadata;
}

export const audioService = {
  /**
   * Parse FLAC STREAMINFO block to extract duration
   * Some FLAC files don't have total_samples in metadata, so music-metadata can't get duration
   */
  parseFLACDuration(buffer: Buffer): number | null {
    // Check for FLAC magic
    if (buffer.slice(0, 4).toString() !== "fLaC") {
      return null;
    }

    // STREAMINFO block starts at byte 8 (after 4-byte magic + 4-byte block header)
    const blockType = buffer[4] & 0x7f;
    if (blockType !== 0) {
      return null; // Not STREAMINFO
    }

    const streaminfo = buffer.slice(8, 8 + 34);

    // Parse sample rate (20 bits starting at byte 10)
    const b10 = streaminfo[10], b11 = streaminfo[11], b12 = streaminfo[12];
    const sampleRate = (b10 << 12) | (b11 << 4) | (b12 >> 4);

    // Parse total samples (36 bits: 4 bits from byte 13 + 32 bits from bytes 14-17)
    const b13 = streaminfo[13], b14 = streaminfo[14], b15 = streaminfo[15];
    const b16 = streaminfo[16], b17 = streaminfo[17];
    const totalSamples =
      ((b13 & 0x0f) * Math.pow(2, 32)) +
      ((b14 << 24) >>> 0) + (b15 << 16) + (b16 << 8) + b17;

    if (sampleRate > 0 && totalSamples > 0) {
      return totalSamples / sampleRate;
    }

    return null;
  },

  /**
   * Estimate duration from file size and codec
   * Used as fallback when metadata doesn't contain duration
   */
  estimateDuration(fileSize: number, codec: string, sampleRate?: number, channels?: number, bitsPerSample?: number): number {
    // For uncompressed formats, calculate exactly
    if (codec === "WAV" || codec === "WAVE") {
      const sr = sampleRate || 44100;
      const ch = channels || 2;
      const bits = bitsPerSample || 16;
      const bytesPerSecond = sr * ch * (bits / 8);
      // Subtract ~44 bytes for WAV header
      return Math.max(0, (fileSize - 44) / bytesPerSecond);
    }

    // For compressed formats, estimate using average bitrate
    const bitrate = AVERAGE_AUDIO_BITRATES[codec] || 256000;
    return (fileSize * 8) / bitrate;
  },

  /**
   * Validate and extract metadata from an audio buffer
   * @param id - Unique identifier for this audio file (provided by caller)
   */
  async validateAndExtract(
    id: string,
    buffer: Buffer,
    originalFilename: string,
    customMetadata: Record<string, string> = {}
  ): Promise<ValidationResult> {
    // Check file size
    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      return {
        valid: false,
        error: `File too large. Maximum size is ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB`,
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

      const codec = mm.format.codec || mm.format.container || "unknown";
      const mimeType = mm.format.container || "audio/unknown";
      const channels = mm.format.numberOfChannels;
      const sampleRate = mm.format.sampleRate;
      const bitsPerSample = mm.format.bitsPerSample;

      // Try to get duration from music-metadata first
      let duration = mm.format.duration;

      // If duration is missing, try format-specific parsing
      if (!duration && codec === "FLAC") {
        duration = this.parseFLACDuration(buffer) || undefined;
      }

      // If still no duration, estimate from file size
      if (!duration) {
        duration = this.estimateDuration(buffer.length, codec, sampleRate, channels, bitsPerSample);
        console.log(`[AudioService] Estimated duration for ${originalFilename}: ${duration.toFixed(2)}s (codec: ${codec})`);
      }

      const sanitizedFilename = this.sanitizeFilename(originalFilename);

      const metadata: AudioMetadata = {
        id,
        filename: sanitizedFilename,
        originalFilename,
        mimeType,
        size: buffer.length,
        duration: duration || 0,
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
   * Sanitize filename to prevent path traversal and injection attacks.
   * Strips path components and replaces dangerous characters with underscores.
   *
   * Note: For production, consider additional validation:
   * - Maximum filename length
   * - Reserved names (CON, PRN, etc. on Windows)
   * - Unicode normalization
   * - Null byte injection prevention
   */
  sanitizeFilename(filename: string): string {
    // Remove path components (prevents path traversal attacks)
    const basename = filename.split(/[/\\]/).pop() || filename;

    // Replace dangerous characters with underscores
    return basename.replace(/[^a-zA-Z0-9._-]/g, "_");
  },

  /**
   * Check if a MIME type is allowed
   */
  isAllowedMimeType(mimeType: string): boolean {
    return ALLOWED_AUDIO_MIME_TYPES.has(mimeType.toLowerCase());
  },
};
