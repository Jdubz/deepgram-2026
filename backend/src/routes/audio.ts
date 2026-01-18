/**
 * Audio API Routes
 *
 * Implements the required endpoints from the interview prompt:
 * - POST /files - Upload audio with metadata
 * - GET /list - List files with filtering
 * - GET /download - Download file content
 * - GET /info - Get AI summary
 */

import { Router, Request, Response } from "express";
import multer from "multer";
import { storage } from "../services/storage.js";
import { audioService } from "../services/audio.js";
import { llmService } from "../services/llm.js";
import {
  ListFilesQuery,
  ListFilesResponse,
  UploadResponse,
  AudioInfoResponse,
} from "../types/index.js";

const router = Router();

// Configure multer for file uploads (memory storage for now)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
});

/**
 * POST /files
 *
 * Upload raw audio data and store it with metadata.
 *
 * Example:
 *   curl -X POST -F "file=@myfile.wav" -F "title=My Recording" http://localhost:3000/files
 */
router.post(
  "/files",
  upload.single("file"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }

      // Extract custom metadata from form fields
      const customMetadata: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.body)) {
        if (typeof value === "string") {
          customMetadata[key] = value;
        }
      }

      // Validate and extract audio metadata
      const result = await audioService.validateAndExtract(
        req.file.buffer,
        req.file.originalname,
        customMetadata
      );

      if (!result.valid || !result.metadata) {
        res.status(422).json({ error: result.error });
        return;
      }

      // Store the file
      await storage.store(result.metadata.id, {
        metadata: result.metadata,
        content: req.file.buffer,
      });

      const response: UploadResponse = {
        id: result.metadata.id,
        filename: result.metadata.filename,
        duration: result.metadata.duration,
        size: result.metadata.size,
        message: "File uploaded successfully",
      };

      res.status(201).json(response);
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * GET /list
 *
 * Get a list of stored files with optional filtering.
 *
 * Query parameters:
 *   - maxduration: Maximum duration in seconds
 *   - minduration: Minimum duration in seconds
 *   - limit: Max number of results (default: 100)
 *   - offset: Offset for pagination (default: 0)
 *
 * Example:
 *   curl http://localhost:3000/list?maxduration=300
 */
router.get("/list", async (req: Request, res: Response): Promise<void> => {
  try {
    const query: ListFilesQuery = {
      maxduration: req.query.maxduration ? Number(req.query.maxduration) : undefined,
      minduration: req.query.minduration ? Number(req.query.minduration) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : 100,
      offset: req.query.offset ? Number(req.query.offset) : 0,
    };

    let files = await storage.listAll();

    // Apply filters
    if (query.maxduration !== undefined) {
      files = files.filter((f) => f.duration <= query.maxduration!);
    }
    if (query.minduration !== undefined) {
      files = files.filter((f) => f.duration >= query.minduration!);
    }

    const total = files.length;

    // Apply pagination
    const limit = query.limit || 100;
    const offset = query.offset || 0;
    files = files.slice(offset, offset + limit);

    const response: ListFilesResponse = {
      files,
      total,
      limit,
      offset,
    };

    res.json(response);
  } catch (error) {
    console.error("List error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /download
 *
 * Download the content of a stored file.
 *
 * Query parameters:
 *   - name: Filename to download
 *   - id: File ID to download (alternative to name)
 *
 * Example:
 *   curl http://localhost:3000/download?name=myfile.wav -o downloaded.wav
 */
router.get("/download", async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, id } = req.query;

    if (!name && !id) {
      res.status(400).json({ error: "Must provide 'name' or 'id' query parameter" });
      return;
    }

    let file;
    if (id) {
      file = await storage.getById(id as string);
    } else {
      file = await storage.getByFilename(name as string);
    }

    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    res.setHeader("Content-Type", file.metadata.mimeType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${file.metadata.filename}"`
    );
    res.setHeader("Content-Length", file.content.length);
    res.send(file.content);
  } catch (error) {
    console.error("Download error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /info
 *
 * Get a summary of the uploaded file using an LLM.
 *
 * Query parameters:
 *   - name: Filename to analyze
 *   - id: File ID to analyze (alternative to name)
 *
 * Example:
 *   curl http://localhost:3000/info?name=myfile.wav
 */
router.get("/info", async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, id } = req.query;

    if (!name && !id) {
      res.status(400).json({ error: "Must provide 'name' or 'id' query parameter" });
      return;
    }

    let file;
    if (id) {
      file = await storage.getById(id as string);
    } else {
      file = await storage.getByFilename(name as string);
    }

    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    // Generate summary using LLM service
    const llmResponse = await llmService.summarize(file.metadata);

    const response: AudioInfoResponse = {
      filename: file.metadata.filename,
      duration: file.metadata.duration,
      size: file.metadata.size,
      summary: llmResponse.text,
    };

    res.json(response);
  } catch (error) {
    console.error("Info error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /files/:id
 *
 * Get metadata for a specific file by ID.
 */
router.get("/files/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const file = await storage.getById(req.params.id);

    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    res.json(file.metadata);
  } catch (error) {
    console.error("Get file error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * DELETE /files/:id
 *
 * Delete a file by ID.
 *
 * TODO (Exercise 7): Add authentication check
 */
router.delete("/files/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const deleted = await storage.delete(req.params.id);

    if (!deleted) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    res.json({ message: "File deleted successfully" });
  } catch (error) {
    console.error("Delete error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
