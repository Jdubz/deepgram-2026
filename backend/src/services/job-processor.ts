/**
 * Job Processor Service
 *
 * Background job processor that runs embedded in the Express server.
 * Polls the SQLite queue and processes jobs sequentially (one at a time).
 *
 * Features:
 * - Single-job guarantee via mutex (GPU can only handle one model at a time)
 * - Atomic job claiming via SQLite
 * - Auto-chain: transcribe job -> summarize job
 * - Graceful shutdown (finishes current job before stopping)
 * - Multi-provider support via provider factory
 * - Model availability checking before job starts
 * - Streaming with heartbeat tracking for LLM jobs
 * - Stuck job detection and recovery
 */

import { Provider } from "../types/index.js";
import { inferenceQueue, Job, SubmissionStatus } from "./inference-queue.js";
import { getProvider } from "./provider-factory.js";
import { LocalAIService } from "./localai.js";

export interface ProcessorStatus {
  isRunning: boolean;
  isProcessing: boolean;
  currentJobId: number | null;
  currentJobType: string | null;
}

class JobProcessorService {
  private isRunning = false;
  private isProcessing = false;
  private currentJobId: number | null = null;
  private currentJobType: string | null = null;
  private shutdownRequested = false;
  private pollIntervalMs = 2000;
  private stuckCheckIntervalMs = 30000; // Check for stuck jobs every 30 seconds
  private pollTimeoutId: NodeJS.Timeout | null = null;
  private stuckCheckTimeoutId: NodeJS.Timeout | null = null;

  /**
   * Start the job processor
   */
  start(): void {
    if (this.isRunning) {
      console.log("[JobProcessor] Already running");
      return;
    }

    console.log("[JobProcessor] Starting...");

    // Initialize database tables
    inferenceQueue.initializeDatabase();

    this.isRunning = true;
    this.shutdownRequested = false;
    this.poll();
    this.checkStuckJobs(); // Start stuck job detection loop

    console.log("[JobProcessor] Started - polling every", this.pollIntervalMs, "ms");
    console.log("[JobProcessor] Stuck job detection every", this.stuckCheckIntervalMs, "ms");
  }

  /**
   * Gracefully shutdown the processor
   * Waits for current job to complete before stopping
   */
  async shutdown(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log("[JobProcessor] Shutdown requested...");
    this.shutdownRequested = true;

    // Clear polling timeout
    if (this.pollTimeoutId) {
      clearTimeout(this.pollTimeoutId);
      this.pollTimeoutId = null;
    }

    // Clear stuck job check timeout
    if (this.stuckCheckTimeoutId) {
      clearTimeout(this.stuckCheckTimeoutId);
      this.stuckCheckTimeoutId = null;
    }

    // Wait for current job to finish
    while (this.isProcessing) {
      console.log("[JobProcessor] Waiting for current job to complete...");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    this.isRunning = false;
    console.log("[JobProcessor] Shutdown complete");
  }

  /**
   * Get processor status
   */
  getStatus(): ProcessorStatus {
    return {
      isRunning: this.isRunning,
      isProcessing: this.isProcessing,
      currentJobId: this.currentJobId,
      currentJobType: this.currentJobType,
    };
  }

  /**
   * Polling loop - runs every pollIntervalMs
   */
  private poll(): void {
    if (this.shutdownRequested) {
      return;
    }

    // Don't poll if already processing
    if (!this.isProcessing) {
      this.tryProcessNextJob();
    }

    // Schedule next poll
    this.pollTimeoutId = setTimeout(() => this.poll(), this.pollIntervalMs);
  }

  /**
   * Try to claim and process the next job
   */
  private async tryProcessNextJob(): Promise<void> {
    // Double-check mutex
    if (this.isProcessing) {
      return;
    }

    // Try to claim next job atomically
    const job = inferenceQueue.claimNextJob();

    if (!job) {
      // No pending jobs
      return;
    }

    console.log(`[JobProcessor] Claimed job ${job.id} (${job.job_type}, provider: ${job.provider})`);

    // Set processing state
    this.isProcessing = true;
    this.currentJobId = job.id;
    this.currentJobType = job.job_type;

    try {
      // Update submission status if linked
      if (job.audio_file_id) {
        const status: SubmissionStatus =
          job.job_type === "transcribe" ? "transcribing" : "summarizing";
        inferenceQueue.updateSubmissionStatus(job.audio_file_id, status);
      }

      // Process based on job type
      if (job.job_type === "transcribe") {
        await this.processTranscribeJob(job);
      } else if (job.job_type === "summarize") {
        await this.processSummarizeJob(job);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`[JobProcessor] Job ${job.id} failed:`, errorMessage);

      // Mark job as failed
      inferenceQueue.failJob(job.id, errorMessage);

      // Update submission status if linked
      if (job.audio_file_id) {
        inferenceQueue.updateSubmissionStatus(
          job.audio_file_id,
          "failed",
          errorMessage
        );
      }
    } finally {
      // Clear processing state
      this.isProcessing = false;
      this.currentJobId = null;
      this.currentJobType = null;
    }
  }

  /**
   * Process a transcription job
   */
  private async processTranscribeJob(job: Job): Promise<void> {
    if (!job.input_file_path) {
      throw new Error("Transcribe job missing input_file_path");
    }

    // Get the appropriate provider
    const provider = getProvider(job.provider as Provider);
    console.log(`[JobProcessor] Transcribing with ${provider.name}: ${job.input_file_path}`);

    // Verify model is loaded for LocalAI before starting
    if (job.provider === Provider.LOCAL && provider instanceof LocalAIService) {
      const whisperModel = provider.getConfig().whisperModel;
      const modelLoaded = await provider.isModelLoaded(whisperModel);

      if (!modelLoaded) {
        throw new Error(
          `Whisper model '${whisperModel}' is not loaded. ` +
          `LocalAI server is running but whisper backend failed to load. ` +
          `Check LocalAI logs for backend/model loading errors. ` +
          `Ensure whisper model files are present and backend is configured.`
        );
      }

      // Mark model as verified
      inferenceQueue.markModelVerified(job.id);
    }

    // Call provider for transcription
    const result = await provider.transcribe(job.input_file_path);

    console.log(
      `[JobProcessor] Transcription complete (${result.processingTimeMs}ms, model: ${result.model})`
    );

    // Mark job as completed with raw response
    inferenceQueue.completeJob(
      job.id,
      result.text,
      result.model,
      result.processingTimeMs,
      result.rawResponse
    );

    // Update submission with transcript
    if (job.audio_file_id) {
      inferenceQueue.updateSubmissionTranscript(
        job.audio_file_id,
        result.text,
        job.id
      );

      // Check if auto-summarize is requested
      const metadata = job.metadata ? JSON.parse(job.metadata) : {};
      if (metadata.autoSummarize && result.text.trim()) {
        console.log(`[JobProcessor] Auto-creating summarize job for submission ${job.audio_file_id}`);

        // Create summarize job with the same provider
        inferenceQueue.createSummarizeJob({
          text: result.text,
          audioFileId: job.audio_file_id,
          provider: job.provider as Provider,
        });
      } else if (!metadata.autoSummarize) {
        // No auto-summarize, mark submission as completed
        inferenceQueue.updateSubmissionStatus(job.audio_file_id, "completed");
      }
    }
  }

  /**
   * Process a summarization job
   * Uses streaming with heartbeat for LocalAI to detect stuck jobs
   */
  private async processSummarizeJob(job: Job): Promise<void> {
    if (!job.input_text) {
      throw new Error("Summarize job missing input_text");
    }

    const provider = getProvider(job.provider as Provider);
    console.log(
      `[JobProcessor] Summarizing with ${provider.name} (${job.input_text.length} chars)...`
    );

    let result;

    // Use streaming with heartbeat for LocalAI provider
    if (job.provider === Provider.LOCAL && provider instanceof LocalAIService) {
      // Verify model is loaded before starting
      const modelLoaded = await provider.isModelLoaded(provider.getConfig().llmModel);
      if (!modelLoaded) {
        throw new Error(
          `Model '${provider.getConfig().llmModel}' is not loaded. ` +
          `LocalAI server is running but model failed to load. ` +
          `Check LocalAI logs for model loading errors.`
        );
      }

      // Mark model as verified
      inferenceQueue.markModelVerified(job.id);

      // Use streaming summarize with heartbeat callback
      result = await provider.summarizeWithHeartbeat(
        job.input_text,
        (tokenCount, _partialText) => {
          // Update heartbeat in database on each token
          inferenceQueue.updateJobHeartbeat(job.id, tokenCount);
        }
      );
    } else {
      // Use standard summarize for other providers (Deepgram)
      result = await provider.summarize(job.input_text);
    }

    console.log(
      `[JobProcessor] Summarization complete (${result.processingTimeMs}ms, ${result.tokensUsed} tokens)`
    );

    // Mark job as completed with raw response
    inferenceQueue.completeJob(
      job.id,
      result.text,
      result.model,
      result.processingTimeMs,
      result.rawResponse
    );

    // Update submission with summary and mark as completed
    if (job.audio_file_id) {
      inferenceQueue.updateSubmissionSummary(
        job.audio_file_id,
        result.text,
        job.id
      );
      inferenceQueue.updateSubmissionStatus(job.audio_file_id, "completed");
    }
  }

  /**
   * Check for stuck jobs and recover them
   * Runs on a separate interval from the main poll loop
   */
  private checkStuckJobs(): void {
    if (this.shutdownRequested) {
      return;
    }

    try {
      const stuckJobs = inferenceQueue.findStuckJobs();

      for (const job of stuckJobs) {
        const jobInfo = inferenceQueue.getJobWithHeartbeat(job.id);
        const heartbeatCount = jobInfo?.heartbeat_count || 0;
        const modelVerified = jobInfo?.model_verified || 0;

        let reason: string;
        if (!modelVerified) {
          reason = "Job started but model was never verified as loaded";
        } else if (heartbeatCount === 0) {
          reason = "Job started but never received any tokens (model may have hung)";
        } else {
          reason = `Job stalled after receiving ${heartbeatCount} tokens`;
        }

        console.warn(
          `[JobProcessor] Recovering stuck job ${job.id} (${job.job_type}): ${reason}`
        );

        inferenceQueue.recoverStuckJob(job.id, reason);
      }

      if (stuckJobs.length > 0) {
        console.log(`[JobProcessor] Recovered ${stuckJobs.length} stuck job(s)`);
      }
    } catch (error) {
      console.error("[JobProcessor] Error checking for stuck jobs:", error);
    }

    // Schedule next check
    this.stuckCheckTimeoutId = setTimeout(
      () => this.checkStuckJobs(),
      this.stuckCheckIntervalMs
    );
  }
}

// Export singleton instance
export const jobProcessor = new JobProcessorService();
