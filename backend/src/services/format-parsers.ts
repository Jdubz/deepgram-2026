/**
 * Audio Format Parsers
 *
 * Provides format-specific validation and metadata extraction for audio files.
 * Each parser can:
 * - Identify files by magic bytes
 * - Validate file content matches declared type
 * - Extract duration when music-metadata fails
 */

/**
 * Represents a detected audio format from magic bytes
 */
export interface DetectedFormat {
  codec: string;
  mimeTypes: string[];
  extensions: string[];
}

/**
 * Interface for format-specific audio parsers
 */
export interface FormatParser {
  /** Codec name (e.g., "FLAC", "MP3") */
  codec: string;

  /** Valid MIME types for this format */
  mimeTypes: string[];

  /** Valid file extensions (without dot) */
  extensions: string[];

  /**
   * Check if buffer matches this format's magic bytes
   */
  canParse: (buffer: Buffer) => boolean;

  /**
   * Parse duration from the raw buffer
   * Returns null if unable to parse
   */
  parseDuration: (buffer: Buffer) => number | null;
}

/**
 * FLAC format parser
 * Magic: "fLaC" at offset 0
 */
const flacParser: FormatParser = {
  codec: "FLAC",
  mimeTypes: ["audio/flac", "audio/x-flac"],
  extensions: ["flac"],

  canParse(buffer: Buffer): boolean {
    return buffer.length >= 4 && buffer.slice(0, 4).toString() === "fLaC";
  },

  parseDuration(buffer: Buffer): number | null {
    if (!this.canParse(buffer) || buffer.length < 42) {
      return null;
    }

    // STREAMINFO block starts at byte 8 (after 4-byte magic + 4-byte block header)
    const blockType = buffer[4] & 0x7f;
    if (blockType !== 0) {
      return null; // Not STREAMINFO
    }

    const streaminfo = buffer.slice(8, 8 + 34);

    // Parse sample rate (20 bits starting at byte 10)
    const b10 = streaminfo[10],
      b11 = streaminfo[11],
      b12 = streaminfo[12];
    const sampleRate = (b10 << 12) | (b11 << 4) | (b12 >> 4);

    // Parse total samples (36 bits: 4 bits from byte 13 + 32 bits from bytes 14-17)
    // Use BigInt to avoid integer overflow for long recordings
    const b13 = streaminfo[13],
      b14 = streaminfo[14],
      b15 = streaminfo[15];
    const b16 = streaminfo[16],
      b17 = streaminfo[17];
    const totalSamples = Number(
      (BigInt(b13 & 0x0f) << 32n) |
      (BigInt(b14) << 24n) |
      (BigInt(b15) << 16n) |
      (BigInt(b16) << 8n) |
      BigInt(b17)
    );

    if (sampleRate > 0 && totalSamples > 0) {
      return totalSamples / sampleRate;
    }

    return null;
  },
};

/**
 * WAV format parser
 * Magic: "RIFF" at offset 0, "WAVE" at offset 8
 */
const wavParser: FormatParser = {
  codec: "WAV",
  mimeTypes: ["audio/wav", "audio/x-wav", "audio/wave"],
  extensions: ["wav", "wave"],

  canParse(buffer: Buffer): boolean {
    return (
      buffer.length >= 12 &&
      buffer.slice(0, 4).toString() === "RIFF" &&
      buffer.slice(8, 12).toString() === "WAVE"
    );
  },

  parseDuration(buffer: Buffer): number | null {
    if (!this.canParse(buffer) || buffer.length < 44) {
      return null;
    }

    // Find fmt chunk to get audio parameters
    let offset = 12;
    let sampleRate = 0;
    let bitsPerSample = 0;
    let channels = 0;
    let dataSize = 0;

    while (offset < buffer.length - 8) {
      const chunkId = buffer.slice(offset, offset + 4).toString();
      const chunkSize = buffer.readUInt32LE(offset + 4);

      if (chunkId === "fmt ") {
        if (offset + 24 <= buffer.length) {
          channels = buffer.readUInt16LE(offset + 10);
          sampleRate = buffer.readUInt32LE(offset + 12);
          bitsPerSample = buffer.readUInt16LE(offset + 22);
        }
      } else if (chunkId === "data") {
        dataSize = chunkSize;
      }

      offset += 8 + chunkSize;
      // Align to word boundary
      if (chunkSize % 2 !== 0) offset++;
    }

    if (sampleRate > 0 && channels > 0 && bitsPerSample > 0 && dataSize > 0) {
      const bytesPerSample = bitsPerSample / 8;
      const bytesPerSecond = sampleRate * channels * bytesPerSample;
      return dataSize / bytesPerSecond;
    }

    return null;
  },
};

/**
 * MP3 format parser
 * Magic: ID3 tag (ID3) or frame sync (0xFF 0xFB/FA/F3/F2)
 */
const mp3Parser: FormatParser = {
  codec: "MP3",
  mimeTypes: ["audio/mpeg", "audio/mp3"],
  extensions: ["mp3"],

  canParse(buffer: Buffer): boolean {
    if (buffer.length < 3) return false;

    // Check for ID3v2 tag
    if (buffer.slice(0, 3).toString() === "ID3") {
      return true;
    }

    // Check for MP3 frame sync (0xFF followed by 0xE0-0xFF for MPEG audio)
    if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
      return true;
    }

    return false;
  },

  parseDuration(_buffer: Buffer): number | null {
    // MP3 duration parsing is complex (requires scanning all frames or reading Xing/VBRI headers)
    // For VBR files, we'd need to parse the Xing header
    // For CBR files, we could estimate from file size and bitrate
    // Returning null to fall back to music-metadata or estimation
    return null;
  },
};

/**
 * OGG format parser (Vorbis/Opus)
 * Magic: "OggS" at offset 0
 */
const oggParser: FormatParser = {
  codec: "OGG",
  mimeTypes: ["audio/ogg", "audio/vorbis", "audio/opus"],
  extensions: ["ogg", "oga", "opus"],

  canParse(buffer: Buffer): boolean {
    return buffer.length >= 4 && buffer.slice(0, 4).toString() === "OggS";
  },

  parseDuration(_buffer: Buffer): number | null {
    // OGG duration requires parsing the last page's granule position
    // and the sample rate from the codec headers
    // Complex to implement - fall back to music-metadata
    return null;
  },
};

/**
 * AAC/M4A format parser (MPEG-4 container)
 * Magic: "ftyp" at offset 4 with M4A/MP4 brand
 */
const aacParser: FormatParser = {
  codec: "AAC",
  mimeTypes: ["audio/aac", "audio/mp4", "audio/x-m4a", "audio/m4a"],
  extensions: ["aac", "m4a", "mp4"],

  canParse(buffer: Buffer): boolean {
    if (buffer.length < 12) return false;

    // Check for ftyp box
    if (buffer.slice(4, 8).toString() === "ftyp") {
      const brand = buffer.slice(8, 12).toString();
      // Common audio brands: M4A , M4B , mp41, mp42, isom
      return ["M4A ", "M4B ", "mp41", "mp42", "isom", "dash"].includes(brand);
    }

    // Check for raw ADTS AAC (sync word 0xFFF)
    if (buffer[0] === 0xff && (buffer[1] & 0xf0) === 0xf0) {
      return true;
    }

    return false;
  },

  parseDuration(_buffer: Buffer): number | null {
    // M4A/AAC duration requires parsing the moov/mdat atoms
    // Complex to implement - fall back to music-metadata
    return null;
  },
};

/**
 * WebM format parser
 * Magic: 0x1A 0x45 0xDF 0xA3 (EBML header)
 */
const webmParser: FormatParser = {
  codec: "WEBM",
  mimeTypes: ["audio/webm", "video/webm"],
  extensions: ["webm"],

  canParse(buffer: Buffer): boolean {
    if (buffer.length < 4) return false;

    // EBML header magic bytes
    return (
      buffer[0] === 0x1a &&
      buffer[1] === 0x45 &&
      buffer[2] === 0xdf &&
      buffer[3] === 0xa3
    );
  },

  parseDuration(_buffer: Buffer): number | null {
    // WebM uses EBML format, duration is in the Segment/Info element
    // Complex to implement - fall back to music-metadata
    return null;
  },
};

/**
 * All registered format parsers
 */
export const FORMAT_PARSERS: FormatParser[] = [
  flacParser,
  wavParser,
  mp3Parser,
  oggParser,
  aacParser,
  webmParser,
];

/**
 * Detect audio format from buffer magic bytes
 * Returns the detected format or null if unrecognized
 */
export function detectFormat(buffer: Buffer): DetectedFormat | null {
  for (const parser of FORMAT_PARSERS) {
    if (parser.canParse(buffer)) {
      return {
        codec: parser.codec,
        mimeTypes: parser.mimeTypes,
        extensions: parser.extensions,
      };
    }
  }
  return null;
}

/**
 * Get parser for a specific codec
 */
export function getParser(codec: string): FormatParser | undefined {
  return FORMAT_PARSERS.find(
    (p) => p.codec.toLowerCase() === codec.toLowerCase()
  );
}

/**
 * Try to parse duration using format-specific parser
 * Returns null if no parser matches or parsing fails
 */
export function parseFormatDuration(
  buffer: Buffer,
  codec?: string
): number | null {
  // If codec is specified, try that parser first
  if (codec) {
    const parser = getParser(codec);
    if (parser && parser.canParse(buffer)) {
      return parser.parseDuration(buffer);
    }
  }

  // Otherwise, try all parsers
  for (const parser of FORMAT_PARSERS) {
    if (parser.canParse(buffer)) {
      const duration = parser.parseDuration(buffer);
      if (duration !== null) {
        return duration;
      }
    }
  }

  return null;
}

/**
 * Validation error for format mismatches
 */
export class FormatMismatchError extends Error {
  public readonly detectedFormat: DetectedFormat;
  public readonly declaredExtension: string;
  public readonly declaredMimeType: string;

  constructor(
    detected: DetectedFormat,
    declaredExtension: string,
    declaredMimeType: string
  ) {
    super(
      `File content does not match declared type. ` +
        `Detected: ${detected.codec} (${detected.mimeTypes[0]}), ` +
        `Declared: ${declaredMimeType} (.${declaredExtension})`
    );
    this.name = "FormatMismatchError";
    this.detectedFormat = detected;
    this.declaredExtension = declaredExtension;
    this.declaredMimeType = declaredMimeType;
  }
}

/**
 * Validate that file content matches declared extension and mime type
 * Throws FormatMismatchError if there's a mismatch
 */
export function validateFormatMatch(
  buffer: Buffer,
  filename: string,
  declaredMimeType: string
): DetectedFormat {
  const detected = detectFormat(buffer);

  if (!detected) {
    throw new Error("Unrecognized audio format");
  }

  // Extract extension from filename
  const ext = filename.split(".").pop()?.toLowerCase() || "";

  // Check if extension matches
  const extensionMatches = detected.extensions.includes(ext);

  // Check if mime type matches (normalize to lowercase)
  const normalizedMime = declaredMimeType.toLowerCase();
  const mimeMatches = detected.mimeTypes.some(
    (m) => m.toLowerCase() === normalizedMime
  );

  // Allow some flexibility: if either matches, consider it valid
  // This handles cases like .mp3 with audio/mpeg (valid but different naming)
  if (!extensionMatches && !mimeMatches) {
    throw new FormatMismatchError(detected, ext, declaredMimeType);
  }

  return detected;
}
