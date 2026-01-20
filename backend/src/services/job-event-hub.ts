/**
 * Job Event Hub Service
 *
 * Manages WebSocket connections for real-time job queue updates.
 * Broadcasts job state changes to all connected clients.
 */

import WebSocket from "ws";
import { Job, QueueStatus, inferenceQueue } from "./inference-queue.js";

// Event types sent to clients
interface JobCreatedEvent {
  type: "job_created";
  job: JobSummary;
}

interface JobClaimedEvent {
  type: "job_claimed";
  jobId: number;
  jobType: string;
  provider: string;
  startedAt: string;
}

interface JobProgressEvent {
  type: "job_progress";
  jobId: number;
  tokenCount: number;
  elapsedMs: number;
}

interface JobCompletedEvent {
  type: "job_completed";
  jobId: number;
  processingTimeMs: number;
  confidence: number | null;
  completedAt: string;
}

interface JobFailedEvent {
  type: "job_failed";
  jobId: number;
  errorMessage: string;
  failedAt: string;
}

interface QueueStatusEvent {
  type: "queue_status";
  status: QueueStatus;
}

interface InitialStateEvent {
  type: "initial_state";
  jobs: JobSummary[];
  status: QueueStatus;
}

type JobEvent =
  | JobCreatedEvent
  | JobClaimedEvent
  | JobProgressEvent
  | JobCompletedEvent
  | JobFailedEvent
  | QueueStatusEvent
  | InitialStateEvent;

// Simplified job structure for events (excludes large text fields)
export interface JobSummary {
  id: number;
  job_type: string;
  status: string;
  provider: string;
  audio_file_id: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  processing_time_ms: number | null;
  error_message: string | null;
}

function toJobSummary(job: Job): JobSummary {
  return {
    id: job.id,
    job_type: job.job_type,
    status: job.status,
    provider: job.provider,
    audio_file_id: job.audio_file_id,
    created_at: job.created_at,
    started_at: job.started_at,
    completed_at: job.completed_at,
    processing_time_ms: job.processing_time_ms,
    error_message: job.error_message,
  };
}

class JobEventHubService {
  private clients: Set<WebSocket> = new Set();
  private jobStartTimes: Map<number, number> = new Map();

  /**
   * Handle a new client connection
   */
  handleClient(ws: WebSocket): void {
    this.clients.add(ws);
    console.log(`[JobEventHub] Client connected. Total clients: ${this.clients.size}`);

    // Send current state to new client
    this.sendInitialState(ws);

    ws.on("close", () => {
      this.clients.delete(ws);
      console.log(`[JobEventHub] Client disconnected. Total clients: ${this.clients.size}`);
    });

    ws.on("error", (err) => {
      console.error("[JobEventHub] WebSocket error:", err);
      this.clients.delete(ws);
    });
  }

  /**
   * Send initial state to a new client
   */
  private sendInitialState(ws: WebSocket): void {
    try {
      const jobs = inferenceQueue.getRecentJobs(50);
      const status = inferenceQueue.getQueueStatus();

      const event: InitialStateEvent = {
        type: "initial_state",
        jobs: jobs.map(toJobSummary),
        status,
      };

      this.sendToClient(ws, event);
    } catch (err) {
      console.error("[JobEventHub] Error sending initial state:", err);
    }
  }

  /**
   * Broadcast an event to all connected clients
   */
  private broadcast(event: JobEvent): void {
    const message = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  /**
   * Send an event to a single client
   */
  private sendToClient(ws: WebSocket, event: JobEvent): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }

  /**
   * Emit event when a job is created
   */
  emitJobCreated(job: Job): void {
    const event: JobCreatedEvent = {
      type: "job_created",
      job: toJobSummary(job),
    };
    this.broadcast(event);
    console.log(`[JobEventHub] Job created: ${job.id} (${job.job_type})`);
  }

  /**
   * Emit event when a job is claimed by the processor
   */
  emitJobClaimed(jobId: number, jobType: string, provider: string): void {
    this.jobStartTimes.set(jobId, Date.now());

    const event: JobClaimedEvent = {
      type: "job_claimed",
      jobId,
      jobType,
      provider,
      startedAt: new Date().toISOString(),
    };
    this.broadcast(event);
    console.log(`[JobEventHub] Job claimed: ${jobId}`);
  }

  /**
   * Emit event for job progress (during streaming/heartbeat)
   */
  emitJobProgress(jobId: number, tokenCount: number): void {
    const startTime = this.jobStartTimes.get(jobId);
    const elapsedMs = startTime ? Date.now() - startTime : 0;

    const event: JobProgressEvent = {
      type: "job_progress",
      jobId,
      tokenCount,
      elapsedMs,
    };
    this.broadcast(event);
  }

  /**
   * Emit event when a job completes successfully
   */
  emitJobCompleted(jobId: number, processingTimeMs: number, confidence: number | null): void {
    this.jobStartTimes.delete(jobId);

    const event: JobCompletedEvent = {
      type: "job_completed",
      jobId,
      processingTimeMs,
      confidence,
      completedAt: new Date().toISOString(),
    };
    this.broadcast(event);
    console.log(`[JobEventHub] Job completed: ${jobId} (${processingTimeMs}ms)`);
  }

  /**
   * Emit event when a job fails
   */
  emitJobFailed(jobId: number, errorMessage: string): void {
    this.jobStartTimes.delete(jobId);

    const event: JobFailedEvent = {
      type: "job_failed",
      jobId,
      errorMessage,
      failedAt: new Date().toISOString(),
    };
    this.broadcast(event);
    console.log(`[JobEventHub] Job failed: ${jobId} - ${errorMessage}`);
  }

  /**
   * Emit current queue status
   */
  emitQueueStatus(): void {
    const status = inferenceQueue.getQueueStatus();
    const event: QueueStatusEvent = {
      type: "queue_status",
      status,
    };
    this.broadcast(event);
  }

  /**
   * Get current client count
   */
  getClientCount(): number {
    return this.clients.size;
  }
}

// Export singleton instance
export const jobEventHub = new JobEventHubService();
