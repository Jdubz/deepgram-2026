/**
 * Audio Storage Service
 *
 * Currently uses in-memory storage for simplicity.
 *
 * STUDY EXERCISES:
 * - Exercise 6: Implement file system storage
 * - Exercise 6 Advanced: Implement S3 storage with pre-signed URLs
 */

import { AudioFile, AudioMetadata } from "../types/index.js";

// In-memory storage (fine for interview, discuss alternatives)
const audioStore: Map<string, AudioFile> = new Map();

export const storage = {
  /**
   * Store an audio file
   */
  async store(id: string, file: AudioFile): Promise<void> {
    audioStore.set(id, file);
  },

  /**
   * Get an audio file by ID
   */
  async getById(id: string): Promise<AudioFile | undefined> {
    return audioStore.get(id);
  },

  /**
   * Get an audio file by filename
   */
  async getByFilename(filename: string): Promise<AudioFile | undefined> {
    for (const file of audioStore.values()) {
      if (file.metadata.filename === filename) {
        return file;
      }
    }
    return undefined;
  },

  /**
   * Get all files (metadata only)
   */
  async listAll(): Promise<AudioMetadata[]> {
    return Array.from(audioStore.values()).map((f) => f.metadata);
  },

  /**
   * Delete a file by ID
   */
  async delete(id: string): Promise<boolean> {
    return audioStore.delete(id);
  },

  /**
   * Get storage stats
   */
  async getStats(): Promise<{ count: number; totalSize: number }> {
    let totalSize = 0;
    for (const file of audioStore.values()) {
      totalSize += file.metadata.size;
    }
    return { count: audioStore.size, totalSize };
  },
};

/**
 * TODO (Exercise 6): Implement FileSystemStorage
 *
 * class FileSystemStorage {
 *   private basePath: string;
 *
 *   async store(id: string, file: AudioFile): Promise<void> {
 *     // Write to disk
 *   }
 *
 *   async getById(id: string): Promise<AudioFile | undefined> {
 *     // Read from disk
 *   }
 * }
 */

/**
 * TODO (Exercise 6 Advanced): Implement S3Storage
 *
 * class S3Storage {
 *   private s3Client: S3Client;
 *   private bucket: string;
 *
 *   async store(id: string, file: AudioFile): Promise<string> {
 *     // Upload to S3, return key
 *   }
 *
 *   async getDownloadUrl(key: string): Promise<string> {
 *     // Generate pre-signed URL
 *   }
 * }
 */
