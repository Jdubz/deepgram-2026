/**
 * Audio Projects API Server
 *
 * Deepgram Interview Project - Backend AI Engineer
 *
 * This server provides endpoints for:
 * - Uploading audio files with metadata
 * - Listing and filtering stored files
 * - Downloading audio content
 * - Getting AI-generated summaries
 */

import express from "express";
import cors from "cors";
import audioRoutes from "./routes/audio.js";
import { jobProcessor } from "./services/job-processor.js";
import { inferenceQueue } from "./services/inference-queue.js";
import { localAI } from "./services/localai.js";

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint with service status
app.get("/health", async (req, res) => {
  const localAIHealthy = await localAI.healthCheck();
  const processorStatus = jobProcessor.getStatus();

  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    services: {
      localAI: {
        healthy: localAIHealthy,
        config: localAI.getConfig(),
      },
      jobProcessor: processorStatus,
    },
  });
});

// Queue status endpoint
app.get("/queue/status", (req, res) => {
  const queueStatus = inferenceQueue.getQueueStatus();
  const processorStatus = jobProcessor.getStatus();

  res.json({
    queue: queueStatus,
    processor: processorStatus,
  });
});

// Mount audio routes
app.use("/", audioRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// Start server
const server = app.listen(PORT, () => {
  // Start job processor
  jobProcessor.start();

  console.log(`
====================================
  Audio Projects API Server
====================================

  Server running on http://localhost:${PORT}

  Endpoints:
    POST   /files              Upload audio file
    GET    /list               List files (supports filtering)
    GET    /download?name=     Download file
    GET    /info?id=           Get file info with transcript/summary
    GET    /files/:id          Get file metadata
    DELETE /files/:id          Delete file
    GET    /health             Health check (with service status)
    GET    /queue/status       Queue and processor status
    GET    /submissions/:id    Get submission with jobs

====================================
  `);
});

// Graceful shutdown
const shutdown = async (signal: string) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);

  // Stop accepting new connections
  server.close(() => {
    console.log("HTTP server closed");
  });

  // Shutdown job processor (waits for current job)
  await jobProcessor.shutdown();

  // Close database connection
  inferenceQueue.close();

  console.log("Shutdown complete");
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default app;
