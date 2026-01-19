/**
 * Job Processor Service
 *
 * Background job processor that runs embedded in the Express server.
 * Polls the SQLite queue and processes jobs sequentially (one at a time).
 *
 * Features:
 * - Single-job guarantee via mutex (GPU can only handle one model at a time)
 * - Atomic job claiming via SQLite
 * - Auto-chain: transcribe job → summarize job
 * - Graceful shutdown (finishes current job before stopping)
 */

import { inferenceQueue, Job, SubmissionStatus } from "./inference-queue";
import { localAI } from "./localai";

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
  private pollTimeoutId: NodeJS.Timeout | null = null;

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

    console.log("[JobProcessor] Started - polling every", this.pollIntervalMs, "ms");
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

    console.log(`[JobProcessor] Claimed job ${job.id} (${job.job_type})`);

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

    console.log(`[JobProcessor] Transcribing: ${job.input_file_path}`);

    // Call LocalAI for transcription
    const result = await localAI.transcribe(job.input_file_path);

    console.log(
      `[JobProcessor] Transcription complete (${result.processingTimeMs}ms)`
    );

    // Mark job as completed
    inferenceQueue.completeJob(
      job.id,
      result.text,
      result.model,
      result.processingTimeMs
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

        // Create summarize job
        inferenceQueue.createSummarizeJob({
          text: result.text,
          audioFileId: job.audio_file_id,
          provider: "local",
        });
      } else if (!metadata.autoSummarize) {
        // No auto-summarize, mark submission as completed
        inferenceQueue.updateSubmissionStatus(job.audio_file_id, "completed");
      }
    }
  }

  /**
   * Process a summarization job
   */
  private async processSummarizeJob(job: Job): Promise<void> {
    if (!job.input_text) {
      throw new Error("Summarize job missing input_text");
    }

    console.log(
      `[JobProcessor] Summarizing (${job.input_text.length} chars)...`
    );

    // Call LocalAI for summarization
    const result = await localAI.summarize(job.input_text);

    console.log(
      `[JobProcessor] Summarization complete (${result.processingTimeMs}ms, ${result.tokensUsed} tokens)`
    );

    // Mark job as completed
    inferenceQueue.completeJob(
      job.id,
      result.text,
      result.model,
      result.processingTimeMs
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
}

// Export singleton instance
export const jobProcessor = new JobProcessorService();
