/**
 * Audio Processing Service
 *
 * Handles audio file validation and metadata extraction using the music-metadata library.
 * Supports various audio formats including WAV, MP3, FLAC, OGG, and more.
 *
 * Features:
 * - File size validation
 * - Magic byte validation (detects actual format vs declared type)
 * - Audio metadata extraction (duration, channels, sample rate)
 * - Format-specific duration parsing for files with missing metadata
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
import {
  validateFormatMatch,
  parseFormatDuration,
  FormatMismatchError,
  DetectedFormat,
} from "./format-parsers.js";

export interface ValidationResult {
  valid: boolean;
  error?: string;
  errorType?: "size" | "empty" | "format_mismatch" | "unrecognized" | "parse";
  metadata?: AudioMetadata;
  detectedFormat?: DetectedFormat;
}

export const audioService = {
  /**
   * Estimate duration from file size and codec
   * Used as fallback when metadata doesn't contain duration
   */
  estimateDuration(
    fileSize: number,
    codec: string,
    sampleRate?: number,
    channels?: number,
    bitsPerSample?: number
  ): number {
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
   *
   * Validation steps:
   * 1. Check file size limits
   * 2. Detect actual format from magic bytes
   * 3. Validate format matches declared extension/mime type
   * 4. Extract metadata (duration, channels, sample rate)
   *
   * @param id - Unique identifier for this audio file (provided by caller)
   * @param buffer - Raw audio file data
   * @param originalFilename - Original filename with extension
   * @param declaredMimeType - MIME type from upload request
   * @param customMetadata - Optional custom metadata to attach
   */
  async validateAndExtract(
    id: string,
    buffer: Buffer,
    originalFilename: string,
    customMetadata: Record<string, string> = {},
    declaredMimeType?: string
  ): Promise<ValidationResult> {
    // Check file size
    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      return {
        valid: false,
        error: `File too large. Maximum size is ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB`,
        errorType: "size",
      };
    }

    if (buffer.length === 0) {
      return {
        valid: false,
        error: "Empty file",
        errorType: "empty",
      };
    }

    // Validate format matches declared type (magic byte check)
    let detectedFormat: DetectedFormat;
    try {
      // Use declared mime type if provided, otherwise infer from extension
      const mimeForValidation =
        declaredMimeType || this.mimeTypeFromExtension(originalFilename);
      detectedFormat = validateFormatMatch(
        buffer,
        originalFilename,
        mimeForValidation
      );
    } catch (error) {
      if (error instanceof FormatMismatchError) {
        return {
          valid: false,
          error: error.message,
          errorType: "format_mismatch",
          detectedFormat: error.detectedFormat,
        };
      }
      return {
        valid: false,
        error:
          error instanceof Error
            ? error.message
            : "Unrecognized audio format",
        errorType: "unrecognized",
      };
    }

    try {
      // Parse audio metadata using music-metadata
      const mm = await parseBuffer(buffer);

      const codec =
        mm.format.codec || mm.format.container || detectedFormat.codec;
      const mimeType = detectedFormat.mimeTypes[0] || "audio/unknown";
      const channels = mm.format.numberOfChannels;
      const sampleRate = mm.format.sampleRate;
      const bitsPerSample = mm.format.bitsPerSample;

      // Try to get duration from music-metadata first
      let duration = mm.format.duration;

      // If duration is missing, try format-specific parsing
      if (!duration) {
        duration = parseFormatDuration(buffer, codec) || undefined;
      }

      // If still no duration, estimate from file size
      if (!duration) {
        duration = this.estimateDuration(
          buffer.length,
          codec,
          sampleRate,
          channels,
          bitsPerSample
        );
        console.log(
          `[AudioService] Estimated duration for ${originalFilename}: ${duration.toFixed(2)}s (codec: ${codec})`
        );
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

      return { valid: true, metadata, detectedFormat };
    } catch (error) {
      return {
        valid: false,
        error: `Could not parse audio file: ${error instanceof Error ? error.message : "Unknown error"}`,
        errorType: "parse",
      };
    }
  },

  /**
   * Infer MIME type from file extension
   */
  mimeTypeFromExtension(filename: string): string {
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    const mimeMap: Record<string, string> = {
      wav: "audio/wav",
      wave: "audio/wav",
      mp3: "audio/mpeg",
      flac: "audio/flac",
      ogg: "audio/ogg",
      oga: "audio/ogg",
      opus: "audio/ogg",
      aac: "audio/aac",
      m4a: "audio/mp4",
      mp4: "audio/mp4",
      webm: "audio/webm",
    };
    return mimeMap[ext] || "audio/unknown";
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

// Re-export error class for route handlers
export { FormatMismatchError } from "./format-parsers.js";
