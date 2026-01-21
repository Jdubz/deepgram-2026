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
import fsPromises from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import { audioService } from "../services/audio.js";
import { inferenceQueue } from "../services/inference-queue.js";
import { jobEventHub } from "../services/job-event-hub.js";
import { getDefaultProvider } from "../services/provider-factory.js";
import { Provider, ListFilesQuery } from "../types/index.js";
import { MAX_FILE_SIZE_BYTES, API_CONFIG } from "../constants.js";

/**
 * Parse and validate a numeric query parameter
 * Returns undefined if the parameter is missing, or the validated number
 * Throws an error if the parameter is invalid (NaN or negative)
 */
function parseNumericParam(
  value: unknown,
  name: string,
  options: { min?: number; max?: number } = {}
): number | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  const num = Number(value);
  if (isNaN(num)) {
    throw new Error(`Invalid ${name}: must be a number`);
  }
  if (options.min !== undefined && num < options.min) {
    throw new Error(`Invalid ${name}: must be at least ${options.min}`);
  }
  if (options.max !== undefined && num > options.max) {
    throw new Error(`Invalid ${name}: must be at most ${options.max}`);
  }
  return num;
}

const router = Router();

// Configure upload directory
const UPLOAD_DIR = path.resolve(__dirname, "../../uploads");

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Configure multer for disk storage
const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const id = uuidv4();
    const ext = path.extname(file.originalname);
    cb(null, `${id}${ext}`);
  },
});

const upload = multer({
  storage: diskStorage,
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
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

      // Generate unique display name for duplicates
      const displayName = inferenceQueue.generateUniqueDisplayName(req.file.originalname);

      // Extract duration from audio file for filtering support
      // Also validates that file content matches declared type (magic byte check)
      let fileContent: Buffer;
      try {
        fileContent = await fsPromises.readFile(filePath);
      } catch (readErr) {
        console.error("Failed to read uploaded file:", readErr);
        res.status(500).json({ error: "Failed to read uploaded file" });
        return;
      }

      const audioResult = await audioService.validateAndExtract(
        id,
        fileContent,
        req.file.originalname,
        customMetadata,
        req.file.mimetype
      );

      // Handle validation errors with appropriate 400 responses
      if (!audioResult.valid) {
        // Clean up the uploaded file since validation failed
        await fsPromises.unlink(filePath).catch((e) => console.error("Cleanup failed:", e));

        const errorResponse: {
          error: string;
          errorType?: string;
          detectedFormat?: { codec: string; mimeTypes: string[] };
        } = {
          error: audioResult.error || "Invalid audio file",
          errorType: audioResult.errorType,
        };

        // Include detected format info for mismatch errors
        if (audioResult.detectedFormat) {
          errorResponse.detectedFormat = {
            codec: audioResult.detectedFormat.codec,
            mimeTypes: audioResult.detectedFormat.mimeTypes,
          };
        }

        res.status(400).json(errorResponse);
        return;
      }

      // Create submission in queue with auto-processing
      const submission = inferenceQueue.createSubmission({
        id,
        filename,
        filePath,
        originalFilename: displayName,
        mimeType: req.file.mimetype,
        fileSize: req.file.size,
        durationSeconds: audioResult.metadata?.duration,
        metadata: customMetadata,
        autoProcess: true,
        provider,
      });

      // Emit job created event for the auto-created transcribe job
      const jobs = inferenceQueue.getJobsForSubmission(id);
      if (jobs.length > 0) {
        jobEventHub.emitJobCreated(jobs[0]);
        jobEventHub.emitQueueStatus();
      }

      res.status(201).json({
        id: submission.id,
        filename: displayName,
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
 *   - min_confidence: Minimum transcript confidence (0-1)
 *   - limit: Max number of results (default: 100)
 *   - offset: Offset for pagination (default: 0)
 *
 * Example:
 *   curl http://localhost:3001/list?maxduration=300&min_confidence=0.85
 */
router.get("/list", async (req: Request, res: Response): Promise<void> => {
  try {
    // Validate query parameters
    // Note: min_confidence filter removed - confidence is now in jobs table
    const query: ListFilesQuery = {
      maxduration: parseNumericParam(req.query.maxduration, "maxduration", { min: 0 }),
      minduration: parseNumericParam(req.query.minduration, "minduration", { min: 0 }),
      limit: parseNumericParam(req.query.limit, "limit", { min: 1, max: API_CONFIG.MAX_LIST_LIMIT })
        ?? API_CONFIG.DEFAULT_LIST_LIMIT,
      offset: parseNumericParam(req.query.offset, "offset", { min: 0 }) ?? 0,
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
      limit: query.limit ?? API_CONFIG.DEFAULT_LIST_LIMIT,
      offset: query.offset ?? 0,
    };

    res.json(response);
  } catch (error) {
    // Return 400 for validation errors, 500 for internal errors
    if (error instanceof Error && error.message.startsWith("Invalid ")) {
      res.status(400).json({ error: error.message });
      return;
    }
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
    if (!submission.file_path) {
      res.status(404).json({ error: "File not found on disk" });
      return;
    }

    let stat: fs.Stats;
    try {
      stat = await fsPromises.stat(submission.file_path);
    } catch {
      res.status(404).json({ error: "File not found on disk" });
      return;
    }

    const filename = submission.original_filename || submission.filename;
    const mimeType = submission.mime_type || "application/octet-stream";
    const fileSize = stat.size;

    // Handle Range requests for seeking support
    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.status(206);
      res.setHeader("Content-Type", mimeType);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Length", chunkSize);
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);

      const fileStream = fs.createReadStream(submission.file_path, { start, end });
      fileStream.pipe(res);
    } else {
      // Full file request
      res.setHeader("Content-Type", mimeType);
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
      res.setHeader("Content-Length", fileSize);
      res.setHeader("Accept-Ranges", "bytes");

      const fileStream = fs.createReadStream(submission.file_path);
      fileStream.pipe(res);
    }
  } catch (error) {
    console.error("Download error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /info
 *
 * Get transcript and summary for a processed audio file.
 * If the file was created from a stream, includes session and chunk data.
 * Uses JOIN queries to get results from jobs table (single source of truth).
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

    // Get submission with its related jobs (JOIN query)
    const submissionWithJobs = inferenceQueue.getSubmissionWithJobs(id as string);

    if (!submissionWithJobs) {
      res.status(404).json({ error: "Submission not found" });
      return;
    }

    const { transcriptJob, summarizeJob, ...submission } = submissionWithJobs;

    // Determine transcript status from job
    let transcriptStatus: "pending" | "completed" | "failed" = "pending";
    let transcriptError: string | null = null;

    if (submission.status === "failed" && !transcriptJob) {
      // Submission failed before transcription job was created
      transcriptStatus = "failed";
      transcriptError = submission.error_message || "Unknown error";
    } else if (transcriptJob) {
      if (transcriptJob.status === "completed") {
        transcriptStatus = "completed";
      } else if (transcriptJob.status === "failed") {
        transcriptStatus = "failed";
        transcriptError = transcriptJob.error_message || "Unknown error";
      }
    }

    // Determine summary status from job
    let summaryStatus: "pending" | "completed" | "failed" = "pending";
    let summaryError: string | null = null;

    if (submission.status === "failed" && transcriptStatus === "failed") {
      summaryStatus = "failed";
      summaryError = "Transcription failed";
    } else if (summarizeJob) {
      if (summarizeJob.status === "completed") {
        summaryStatus = "completed";
      } else if (summarizeJob.status === "failed") {
        summaryStatus = "failed";
        summaryError = summarizeJob.error_message || "Unknown error";
      }
    }

    // Parse analysis results from summarize job's raw_response
    const analysis = inferenceQueue.parseAnalysisResults(summarizeJob);

    // Check for stream session linked to this submission
    const streamSession = inferenceQueue.getStreamSessionBySubmission(id as string);
    let streamSessionData = null;
    let combinedTranscript: string | null = null;

    if (streamSession) {
      // Get all chunks with their analysis jobs (efficient JOIN query)
      const chunksWithAnalysis = inferenceQueue.getSessionChunksWithAnalysis(streamSession.id);

      // Get unique speakers
      const speakers = [...new Set(chunksWithAnalysis.map(c => c.speaker).filter(s => s !== null))];

      // Build combined transcript from chunks
      if (chunksWithAnalysis.length > 0) {
        combinedTranscript = chunksWithAnalysis.map(c => c.transcript).join(" ");
      }

      streamSessionData = {
        id: streamSession.id,
        durationMs: streamSession.total_duration_ms,
        chunkCount: streamSession.chunk_count,
        speakers,
        status: streamSession.status,
        startedAt: streamSession.started_at,
        endedAt: streamSession.ended_at,
        chunks: chunksWithAnalysis.map(chunk => {
          // Derive analysis status from job
          let analysisStatus: "pending" | "processing" | "completed" | "skipped" = "pending";
          if (!chunk.analysis_job_id) {
            // No job means either pending or skipped (too short)
            analysisStatus = chunk.word_count < 3 ? "skipped" : "pending";
          } else if (chunk.analysisJob) {
            if (chunk.analysisJob.status === "completed") {
              analysisStatus = "completed";
            } else if (chunk.analysisJob.status === "processing" || chunk.analysisJob.status === "pending") {
              analysisStatus = "processing";
            } else {
              analysisStatus = "pending"; // Failed jobs show as pending for retry
            }
          }

          // Parse analysis from job
          const chunkAnalysis = inferenceQueue.parseAnalysisResults(chunk.analysisJob);

          return {
            id: chunk.id,
            index: chunk.chunk_index,
            speaker: chunk.speaker,
            transcript: chunk.transcript,
            startTimeMs: chunk.start_time_ms,
            endTimeMs: chunk.end_time_ms,
            confidence: chunk.confidence,
            analysisStatus,
            topics: chunkAnalysis.topics.length > 0 ? chunkAnalysis.topics : null,
            intents: chunkAnalysis.intents.length > 0 ? chunkAnalysis.intents : null,
            summary: chunkAnalysis.summary,
            sentiment: chunkAnalysis.sentiment,
          };
        }),
      };

      // For stream files, use combined transcript from chunks
      if (submission.status === "streaming" || submission.status === "completed") {
        transcriptStatus = "completed";
      }
    }

    // Get transcript from job or combined chunks
    const transcript = transcriptStatus === "completed"
      ? (transcriptJob?.output_text || combinedTranscript || "")
      : null;

    // Always return file info with job-derived data
    res.json({
      id: submission.id,
      filename: submission.original_filename || submission.filename,
      duration: submission.duration_seconds || 0,
      size: submission.file_size || 0,
      // Transcript section (from transcribe job)
      transcriptStatus,
      transcript,
      transcriptError,
      transcriptProvider: transcriptJob?.provider || null,
      transcriptModel: transcriptJob?.model_used || null,
      transcriptConfidence: transcriptJob?.confidence || null,
      // Summary section (from summarize job)
      summaryStatus,
      summary: summaryStatus === "completed" ? (analysis.summary || "") : null,
      summaryError,
      summaryProvider: summarizeJob?.provider || null,
      summaryModel: summarizeJob?.model_used || null,
      summaryConfidence: summarizeJob?.confidence || null,
      // Text intelligence analysis (from summarize job's raw_response)
      // Return empty arrays (not null) for Deepgram jobs so frontend can show "None detected"
      topics: summarizeJob?.provider === "deepgram" ? analysis.topics : (analysis.topics.length > 0 ? analysis.topics : null),
      intents: summarizeJob?.provider === "deepgram" ? analysis.intents : (analysis.intents.length > 0 ? analysis.intents : null),
      sentiment: analysis.sentiment,
      // Stream session data (if this submission was from a stream)
      streamSession: streamSessionData,
    });
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
 * Note: In production, this endpoint should require authentication
 * to prevent unauthorized deletion of files.
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

/**
 * GET /jobs
 *
 * Get recent jobs with optional limit.
 *
 * Query parameters:
 *   - limit: Max number of jobs to return (default: 50)
 */
router.get("/jobs", async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const jobs = inferenceQueue.getRecentJobs(limit);
    const queueStatus = inferenceQueue.getQueueStatus();

    res.json({
      jobs,
      status: queueStatus,
    });
  } catch (error) {
    console.error("Get jobs error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /jobs/:id
 *
 * Get a specific job by ID.
 */
router.get("/jobs/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const jobId = Number(req.params.id);
    if (isNaN(jobId)) {
      res.status(400).json({ error: "Invalid job ID" });
      return;
    }

    const job = inferenceQueue.getJobWithHeartbeat(jobId);

    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    res.json(job);
  } catch (error) {
    console.error("Get job error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
