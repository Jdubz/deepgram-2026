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
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { audioService } from "../services/audio.js";
import { inferenceQueue } from "../services/inference-queue.js";
import { getDefaultProvider } from "../services/provider-factory.js";
import {
  Provider,
  ListFilesQuery,
  ListFilesResponse,
  AudioInfoResponse,
} from "../types/index.js";

const router = Router();

// Configure upload directory
const UPLOAD_DIR = path.resolve(__dirname, "../../uploads");

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Configure multer for disk storage
const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const id = uuidv4();
    const ext = path.extname(file.originalname);
    cb(null, `${id}${ext}`);
  },
});

const upload = multer({
  storage: diskStorage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
});

/**
 * POST /files
 *
 * Upload raw audio data and queue it for processing.
 *
 * The file is saved to disk and a submission is created in the queue.
 * Processing happens asynchronously - use GET /submissions/:id to check status.
 *
 * Form fields:
 *   - file: The audio file (required)
 *   - provider: Inference provider - "local" or "deepgram" (optional, defaults to env or "local")
 *   - Any other fields are stored as custom metadata
 *
 * Example:
 *   curl -X POST -F "file=@myfile.wav" -F "provider=deepgram" http://localhost:3000/files
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

      // Extract provider from form fields (default to env or LOCAL)
      const providerParam = req.body.provider as string | undefined;
      let provider: Provider;
      if (providerParam && Object.values(Provider).includes(providerParam as Provider)) {
        provider = providerParam as Provider;
      } else {
        provider = getDefaultProvider();
      }

      // Extract custom metadata from form fields (excluding provider)
      const customMetadata: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.body)) {
        if (typeof value === "string" && key !== "provider") {
          customMetadata[key] = value;
        }
      }

      // Get file info from disk storage
      const filePath = req.file.path;
      const filename = req.file.filename;
      const id = path.basename(filename, path.extname(filename));

      // Extract duration from audio file for filtering support
      const fileContent = fs.readFileSync(filePath);
      const audioResult = await audioService.validateAndExtract(
        fileContent,
        req.file.originalname,
        customMetadata
      );

      // Create submission in queue with auto-processing
      const submission = inferenceQueue.createSubmission({
        id,
        filename,
        filePath,
        originalFilename: req.file.originalname,
        mimeType: req.file.mimetype,
        fileSize: req.file.size,
        durationSeconds: audioResult.metadata?.duration,
        metadata: customMetadata,
        autoProcess: true,
        provider,
      });

      res.status(201).json({
        id: submission.id,
        filename: submission.filename,
        status: submission.status,
        provider,
        message: "File uploaded and queued for processing",
      });
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

    // Query SQLite with filtering and pagination
    const { submissions, total } = inferenceQueue.getSubmissionsFiltered({
      maxDuration: query.maxduration,
      minDuration: query.minduration,
      limit: query.limit,
      offset: query.offset,
    });

    // Map submissions to the expected response format
    const files = submissions.map((s) => ({
      id: s.id,
      filename: s.original_filename || s.filename,
      duration: s.duration_seconds || 0,
      size: s.file_size || 0,
      mimeType: s.mime_type || "audio/unknown",
      uploadedAt: s.created_at,
      status: s.status,
    }));

    const response = {
      files,
      total,
      limit: query.limit || 100,
      offset: query.offset || 0,
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

    // Look up submission in SQLite
    let submission;
    if (id) {
      submission = inferenceQueue.getSubmission(id as string);
    } else {
      submission = inferenceQueue.getSubmissionByFilename(name as string);
    }

    if (!submission) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    // Check if file exists on disk
    if (!submission.file_path || !fs.existsSync(submission.file_path)) {
      res.status(404).json({ error: "File not found on disk" });
      return;
    }

    const filename = submission.original_filename || submission.filename;
    const mimeType = submission.mime_type || "application/octet-stream";
    const stat = fs.statSync(submission.file_path);

    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", stat.size);

    // Stream file from disk instead of loading into memory
    const fileStream = fs.createReadStream(submission.file_path);
    fileStream.pipe(res);
  } catch (error) {
    console.error("Download error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /info
 *
 * Get transcript and summary for a processed audio file.
 *
 * Query parameters:
 *   - id: Submission ID (required)
 *
 * Returns processing status if not yet complete.
 *
 * Example:
 *   curl http://localhost:3000/info?id=abc123
 */
router.get("/info", async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.query;

    if (!id) {
      res.status(400).json({ error: "Must provide 'id' query parameter" });
      return;
    }

    // Get submission from queue
    const submission = inferenceQueue.getSubmission(id as string);

    if (!submission) {
      res.status(404).json({ error: "Submission not found" });
      return;
    }

    // If still processing, return status
    if (submission.status !== "completed" && submission.status !== "failed") {
      res.json({
        id: submission.id,
        filename: submission.original_filename || submission.filename,
        status: submission.status,
        message: `Processing: ${submission.status}`,
      });
      return;
    }

    // If failed, return error
    if (submission.status === "failed") {
      res.json({
        id: submission.id,
        filename: submission.original_filename || submission.filename,
        status: "failed",
        error: submission.error_message,
      });
      return;
    }

    // Return completed submission info
    const response: AudioInfoResponse = {
      filename: submission.original_filename || submission.filename,
      duration: submission.duration_seconds || 0,
      size: submission.file_size || 0,
      summary: submission.summary || "",
      transcript: submission.transcript || "",
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
    const submission = inferenceQueue.getSubmission(req.params.id);

    if (!submission) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    // Return metadata in expected format
    res.json({
      id: submission.id,
      filename: submission.original_filename || submission.filename,
      originalFilename: submission.original_filename,
      mimeType: submission.mime_type,
      size: submission.file_size,
      duration: submission.duration_seconds,
      uploadedAt: submission.created_at,
      status: submission.status,
    });
  } catch (error) {
    console.error("Get file error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * DELETE /files/:id
 *
 * Delete a file by ID.
 * Also deletes associated jobs and the file from disk.
 *
 * TODO (Exercise 7): Add authentication check
 */
router.delete("/files/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const deleted = inferenceQueue.deleteSubmission(req.params.id);

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

/**
 * GET /submissions/:id
 *
 * Get full submission details including associated jobs.
 */
router.get("/submissions/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const submission = inferenceQueue.getSubmission(req.params.id);

    if (!submission) {
      res.status(404).json({ error: "Submission not found" });
      return;
    }

    // Get associated jobs
    const jobs = inferenceQueue.getJobsForSubmission(req.params.id);

    res.json({
      submission,
      jobs,
    });
  } catch (error) {
    console.error("Get submission error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
