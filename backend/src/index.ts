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

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
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
app.listen(PORT, () => {
  console.log(`
====================================
  Audio Projects API Server
====================================

  Server running on http://localhost:${PORT}

  Endpoints:
    POST   /files              Upload audio file
    GET    /list               List files (supports filtering)
    GET    /download?name=     Download file
    GET    /info?name=         Get AI summary
    GET    /files/:id          Get file metadata
    DELETE /files/:id          Delete file
    GET    /health             Health check

====================================
  `);
});

export default app;
