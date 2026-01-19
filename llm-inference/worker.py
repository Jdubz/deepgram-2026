#!/usr/bin/env python3
"""
LLM Inference Worker

A single-file service that processes inference jobs from a SQLite queue.
Handles two job types:
- transcribe: Audio file -> Text transcript (using Whisper)
- summarize: Text -> Summary (using Ollama/Llama)

Models are loaded and unloaded for each job to manage GPU memory.

Usage:
    python worker.py                    # Run worker (processes queue)
    python worker.py --init             # Initialize database only
    python worker.py --status           # Show queue status
"""

import sqlite3
import json
import os
import sys
import time
import argparse
import gc
from datetime import datetime
from pathlib import Path
from enum import Enum
from typing import Optional
import logging
from dotenv import load_dotenv

# Load environment variables
load_dotenv(Path(__file__).parent / ".env")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# Paths
BASE_DIR = Path(__file__).parent.parent  # deepgram-2026 root
DB_PATH = BASE_DIR / "llm-inference" / "queue.db"
MODELS_DIR = BASE_DIR.parent / "models"  # ../models (outside repo for large files)
AUDIO_DIR = BASE_DIR / "uploads"  # Where audio files are stored

# Ensure directories exist
AUDIO_DIR.mkdir(parents=True, exist_ok=True)


class JobStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class JobType(str, Enum):
    TRANSCRIBE = "transcribe"
    SUMMARIZE = "summarize"


class TranscribeProvider(str, Enum):
    LOCAL = "local"          # Local Whisper (faster-whisper)
    DEEPGRAM = "deepgram"    # Deepgram API


class SummarizeProvider(str, Enum):
    LOCAL = "local"          # Local Ollama (Llama)
    OPENAI = "openai"        # OpenAI API (future)
    ANTHROPIC = "anthropic"  # Anthropic API (future)


# =============================================================================
# Database Operations
# =============================================================================

def get_db_connection() -> sqlite3.Connection:
    """Get a database connection with row factory."""
    conn = sqlite3.connect(str(DB_PATH), timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")  # Better concurrent access
    conn.execute("PRAGMA busy_timeout=30000")
    return conn


def init_database():
    """Initialize the SQLite database schema."""
    conn = get_db_connection()
    cursor = conn.cursor()

    # Audio submissions table - tracks all uploaded audio with transcripts and summaries
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS audio_submissions (
            id TEXT PRIMARY KEY,                -- UUID from main API
            filename TEXT NOT NULL,
            original_filename TEXT,
            file_path TEXT NOT NULL,            -- Path to audio file
            mime_type TEXT,
            file_size INTEGER,
            duration_seconds REAL,

            -- Transcription
            transcript TEXT,
            transcript_job_id INTEGER,
            transcribed_at TIMESTAMP,

            -- Summary
            summary TEXT,
            summary_job_id INTEGER,
            summarized_at TIMESTAMP,

            -- Status
            status TEXT DEFAULT 'pending'
                CHECK(status IN ('pending', 'transcribing', 'summarizing', 'completed', 'failed')),
            error_message TEXT,

            -- Metadata
            metadata TEXT,                      -- JSON blob for custom metadata
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Jobs table - the processing queue
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_type TEXT NOT NULL CHECK(job_type IN ('transcribe', 'summarize')),
            status TEXT NOT NULL DEFAULT 'pending'
                CHECK(status IN ('pending', 'processing', 'completed', 'failed')),

            -- Provider selection
            provider TEXT NOT NULL DEFAULT 'local'
                CHECK(provider IN ('local', 'deepgram', 'openai', 'anthropic')),

            -- Input data
            input_file_path TEXT,           -- For transcribe: path to audio file
            input_text TEXT,                -- For summarize: text to summarize

            -- Output data
            output_text TEXT,               -- Result (transcript or summary)
            error_message TEXT,             -- Error details if failed

            -- Metadata
            audio_file_id TEXT,             -- Reference to audio_submissions.id
            metadata TEXT,                  -- JSON blob for extra data

            -- Timestamps
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            started_at TIMESTAMP,
            completed_at TIMESTAMP,

            -- Processing info
            processing_time_ms INTEGER,
            model_used TEXT,

            FOREIGN KEY (audio_file_id) REFERENCES audio_submissions(id)
        )
    """)

    # Index for queue processing (get pending jobs efficiently)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_jobs_status_created
        ON jobs(status, created_at)
    """)

    # Index for looking up jobs by audio file
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_jobs_audio_file_id
        ON jobs(audio_file_id)
    """)

    # Index for audio submissions status
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_audio_submissions_status
        ON audio_submissions(status, created_at)
    """)

    conn.commit()
    conn.close()
    logger.info(f"Database initialized at {DB_PATH}")


def create_job(
    job_type: JobType,
    input_file_path: Optional[str] = None,
    input_text: Optional[str] = None,
    audio_file_id: Optional[str] = None,
    metadata: Optional[dict] = None,
    provider: str = "local"
) -> int:
    """Create a new job in the queue. Returns job ID."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        INSERT INTO jobs (job_type, input_file_path, input_text, audio_file_id, metadata, provider)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (
        job_type.value,
        input_file_path,
        input_text,
        audio_file_id,
        json.dumps(metadata) if metadata else None,
        provider
    ))

    job_id = cursor.lastrowid
    conn.commit()
    conn.close()

    logger.info(f"Created job {job_id}: {job_type.value} (provider: {provider})")
    return job_id


def get_next_pending_job() -> Optional[dict]:
    """Get the next pending job and mark it as processing (atomic)."""
    conn = get_db_connection()
    cursor = conn.cursor()

    # Atomic select + update
    cursor.execute("""
        UPDATE jobs
        SET status = 'processing', started_at = CURRENT_TIMESTAMP
        WHERE id = (
            SELECT id FROM jobs
            WHERE status = 'pending'
            ORDER BY created_at ASC
            LIMIT 1
        )
        RETURNING *
    """)

    row = cursor.fetchone()
    conn.commit()
    conn.close()

    if row:
        return dict(row)
    return None


def complete_job(job_id: int, output_text: str, model_used: str, processing_time_ms: int):
    """Mark a job as completed with results."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        UPDATE jobs
        SET status = 'completed',
            output_text = ?,
            model_used = ?,
            processing_time_ms = ?,
            completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
    """, (output_text, model_used, processing_time_ms, job_id))

    conn.commit()
    conn.close()
    logger.info(f"Job {job_id} completed in {processing_time_ms}ms")


def fail_job(job_id: int, error_message: str):
    """Mark a job as failed with error message."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        UPDATE jobs
        SET status = 'failed',
            error_message = ?,
            completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
    """, (error_message, job_id))

    conn.commit()
    conn.close()
    logger.error(f"Job {job_id} failed: {error_message}")


def get_job(job_id: int) -> Optional[dict]:
    """Get a job by ID."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
    row = cursor.fetchone()
    conn.close()

    if row:
        return dict(row)
    return None


# =============================================================================
# Audio Submissions Operations
# =============================================================================

def create_audio_submission(
    submission_id: str,
    filename: str,
    file_path: str,
    original_filename: Optional[str] = None,
    mime_type: Optional[str] = None,
    file_size: Optional[int] = None,
    duration_seconds: Optional[float] = None,
    metadata: Optional[dict] = None
) -> str:
    """Create a new audio submission record."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        INSERT INTO audio_submissions
        (id, filename, file_path, original_filename, mime_type, file_size, duration_seconds, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        submission_id,
        filename,
        file_path,
        original_filename,
        mime_type,
        file_size,
        duration_seconds,
        json.dumps(metadata) if metadata else None
    ))

    conn.commit()
    conn.close()
    logger.info(f"Created audio submission: {submission_id}")
    return submission_id


def get_audio_submission(submission_id: str) -> Optional[dict]:
    """Get an audio submission by ID."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM audio_submissions WHERE id = ?", (submission_id,))
    row = cursor.fetchone()
    conn.close()

    if row:
        return dict(row)
    return None


def update_audio_submission_transcript(submission_id: str, transcript: str, job_id: int):
    """Update audio submission with transcript."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        UPDATE audio_submissions
        SET transcript = ?,
            transcript_job_id = ?,
            transcribed_at = CURRENT_TIMESTAMP,
            status = 'summarizing',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    """, (transcript, job_id, submission_id))

    conn.commit()
    conn.close()
    logger.info(f"Updated transcript for submission: {submission_id}")


def update_audio_submission_summary(submission_id: str, summary: str, job_id: int):
    """Update audio submission with summary."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        UPDATE audio_submissions
        SET summary = ?,
            summary_job_id = ?,
            summarized_at = CURRENT_TIMESTAMP,
            status = 'completed',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    """, (summary, job_id, submission_id))

    conn.commit()
    conn.close()
    logger.info(f"Updated summary for submission: {submission_id}")


def update_audio_submission_status(submission_id: str, status: str, error_message: Optional[str] = None):
    """Update audio submission status."""
    conn = get_db_connection()
    cursor = conn.cursor()

    if error_message:
        cursor.execute("""
            UPDATE audio_submissions
            SET status = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (status, error_message, submission_id))
    else:
        cursor.execute("""
            UPDATE audio_submissions
            SET status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (status, submission_id))

    conn.commit()
    conn.close()


def get_queue_status() -> dict:
    """Get queue statistics."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT
            status,
            COUNT(*) as count
        FROM jobs
        GROUP BY status
    """)

    status_counts = {row['status']: row['count'] for row in cursor.fetchall()}

    cursor.execute("""
        SELECT COUNT(*) as total FROM jobs
    """)
    total = cursor.fetchone()['total']

    cursor.execute("""
        SELECT AVG(processing_time_ms) as avg_time
        FROM jobs
        WHERE status = 'completed' AND processing_time_ms IS NOT NULL
    """)
    avg_time = cursor.fetchone()['avg_time']

    conn.close()

    return {
        'total_jobs': total,
        'pending': status_counts.get('pending', 0),
        'processing': status_counts.get('processing', 0),
        'completed': status_counts.get('completed', 0),
        'failed': status_counts.get('failed', 0),
        'avg_processing_time_ms': round(avg_time) if avg_time else None
    }


# =============================================================================
# Model Operations
# =============================================================================

def free_gpu_memory():
    """Force garbage collection and free GPU memory."""
    gc.collect()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.synchronize()
    except ImportError:
        pass
    logger.debug("GPU memory freed")


def transcribe_audio_local(file_path: str) -> tuple[str, str, int]:
    """
    Transcribe audio file using local Whisper (faster-whisper).
    Returns: (transcript, model_name, processing_time_ms)
    """
    import time
    start_time = time.time()

    # Set HuggingFace cache to our models directory
    os.environ['HF_HOME'] = str(MODELS_DIR)

    logger.info(f"Loading Whisper model...")
    from faster_whisper import WhisperModel

    model = WhisperModel(
        "large-v3",
        device="cuda",
        compute_type="float16",
        download_root=str(MODELS_DIR)
    )

    logger.info(f"Transcribing (local): {file_path}")
    segments, info = model.transcribe(file_path, beam_size=5)

    # Collect all segments
    transcript_parts = []
    for segment in segments:
        transcript_parts.append(segment.text)

    transcript = " ".join(transcript_parts).strip()

    # Unload model
    del model
    free_gpu_memory()

    processing_time_ms = int((time.time() - start_time) * 1000)
    logger.info(f"Transcription complete: {len(transcript)} chars in {processing_time_ms}ms")

    return transcript, "whisper-large-v3", processing_time_ms


def transcribe_audio_deepgram(file_path: str) -> tuple[str, str, int]:
    """
    Transcribe audio file using Deepgram API.
    Returns: (transcript, model_name, processing_time_ms)
    """
    import time
    import requests

    start_time = time.time()

    api_key = os.getenv("DEEPGRAM_API_KEY")
    if not api_key:
        raise ValueError("DEEPGRAM_API_KEY not set in environment")

    logger.info(f"Transcribing (Deepgram): {file_path}")

    # Read audio file
    with open(file_path, "rb") as f:
        audio_data = f.read()

    # Determine content type from file extension
    ext = Path(file_path).suffix.lower()
    content_types = {
        ".wav": "audio/wav",
        ".mp3": "audio/mpeg",
        ".flac": "audio/flac",
        ".ogg": "audio/ogg",
        ".m4a": "audio/mp4",
        ".webm": "audio/webm",
    }
    content_type = content_types.get(ext, "audio/wav")

    # Call Deepgram API
    response = requests.post(
        "https://api.deepgram.com/v1/listen",
        headers={
            "Authorization": f"Token {api_key}",
            "Content-Type": content_type,
        },
        params={
            "model": "nova-2",
            "smart_format": "true",
            "punctuate": "true",
            "paragraphs": "true",
        },
        data=audio_data,
        timeout=300,  # 5 minute timeout for long audio
    )

    if response.status_code != 200:
        raise Exception(f"Deepgram API error: {response.status_code} - {response.text}")

    result = response.json()

    # Extract transcript from response
    transcript = ""
    if "results" in result and "channels" in result["results"]:
        channels = result["results"]["channels"]
        if channels and "alternatives" in channels[0]:
            alternatives = channels[0]["alternatives"]
            if alternatives:
                transcript = alternatives[0].get("transcript", "")

    if not transcript:
        raise Exception("No transcript returned from Deepgram")

    processing_time_ms = int((time.time() - start_time) * 1000)
    logger.info(f"Transcription complete: {len(transcript)} chars in {processing_time_ms}ms")

    return transcript, "deepgram-nova-2", processing_time_ms


def transcribe_audio(file_path: str, provider: str = "local") -> tuple[str, str, int]:
    """
    Transcribe audio file using specified provider.
    Returns: (transcript, model_name, processing_time_ms)
    """
    if provider == TranscribeProvider.DEEPGRAM.value:
        return transcribe_audio_deepgram(file_path)
    else:
        return transcribe_audio_local(file_path)


def summarize_text(text: str) -> tuple[str, str, int]:
    """
    Summarize text using Ollama/Llama.
    Returns: (summary, model_name, processing_time_ms)
    """
    import time
    import requests

    start_time = time.time()

    # Ensure Ollama is running
    try:
        requests.get("http://localhost:11434/api/tags", timeout=2)
    except requests.exceptions.ConnectionError:
        logger.info("Starting Ollama service...")
        os.system("ollama serve > /dev/null 2>&1 &")
        time.sleep(3)

    prompt = f"""Summarize the following transcript concisely. Include:
- Main topics discussed
- Key points and takeaways
- Overall sentiment/tone

Transcript:
{text}

Summary:"""

    logger.info("Generating summary with Llama 3.1...")

    response = requests.post(
        "http://localhost:11434/api/generate",
        json={
            "model": "llama3.1:8b",
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": 0.3,
                "num_predict": 500
            }
        },
        timeout=120
    )

    if response.status_code != 200:
        raise Exception(f"Ollama API error: {response.status_code} - {response.text}")

    result = response.json()
    summary = result.get("response", "").strip()

    # Unload model to free VRAM
    logger.info("Unloading Llama model...")
    try:
        requests.post(
            "http://localhost:11434/api/generate",
            json={"model": "llama3.1:8b", "keep_alive": 0},
            timeout=10
        )
    except:
        pass

    free_gpu_memory()

    processing_time_ms = int((time.time() - start_time) * 1000)
    logger.info(f"Summary complete: {len(summary)} chars in {processing_time_ms}ms")

    return summary, "llama3.1:8b", processing_time_ms


# =============================================================================
# Worker Loop
# =============================================================================

def process_job(job: dict):
    """Process a single job."""
    job_id = job['id']
    job_type = job['job_type']
    provider = job.get('provider', 'local')
    audio_file_id = job.get('audio_file_id')
    metadata = json.loads(job['metadata']) if job.get('metadata') else {}

    logger.info(f"Processing job {job_id} ({job_type}) with provider: {provider}")

    try:
        if job_type == JobType.TRANSCRIBE.value:
            if not job['input_file_path']:
                raise ValueError("No input file path for transcribe job")

            file_path = job['input_file_path']
            if not os.path.exists(file_path):
                raise FileNotFoundError(f"Audio file not found: {file_path}")

            # Update submission status
            if audio_file_id:
                update_audio_submission_status(audio_file_id, 'transcribing')

            output, model, time_ms = transcribe_audio(file_path, provider)
            complete_job(job_id, output, model, time_ms)

            # Update audio submission with transcript
            if audio_file_id:
                update_audio_submission_transcript(audio_file_id, output, job_id)

                # Auto-create summarize job if requested
                if metadata.get('autoSummarize', False):
                    logger.info(f"Auto-creating summarize job for {audio_file_id}")
                    create_job(
                        job_type=JobType.SUMMARIZE,
                        input_text=output,
                        audio_file_id=audio_file_id,
                        metadata={'autoSummarize': True, 'sourceJobId': job_id}
                    )

        elif job_type == JobType.SUMMARIZE.value:
            if not job['input_text']:
                raise ValueError("No input text for summarize job")

            # Update submission status
            if audio_file_id:
                update_audio_submission_status(audio_file_id, 'summarizing')

            output, model, time_ms = summarize_text(job['input_text'])
            complete_job(job_id, output, model, time_ms)

            # Update audio submission with summary
            if audio_file_id:
                update_audio_submission_summary(audio_file_id, output, job_id)

        else:
            raise ValueError(f"Unknown job type: {job_type}")

    except Exception as e:
        logger.exception(f"Job {job_id} failed")
        fail_job(job_id, str(e))

        # Update audio submission status on failure
        if audio_file_id:
            update_audio_submission_status(audio_file_id, 'failed', str(e))


def run_worker(poll_interval: float = 2.0):
    """Main worker loop - processes jobs from the queue."""
    logger.info("=" * 50)
    logger.info("LLM Inference Worker Started")
    logger.info(f"Database: {DB_PATH}")
    logger.info(f"Models directory: {MODELS_DIR}")
    logger.info(f"Poll interval: {poll_interval}s")
    logger.info("=" * 50)

    # Initialize database if needed
    if not DB_PATH.exists():
        init_database()

    while True:
        try:
            job = get_next_pending_job()

            if job:
                process_job(job)
                # Small delay between jobs to let GPU memory settle
                time.sleep(1)
            else:
                # No jobs, wait before polling again
                time.sleep(poll_interval)

        except KeyboardInterrupt:
            logger.info("Worker stopped by user")
            break
        except Exception as e:
            logger.exception("Worker error")
            time.sleep(5)  # Wait before retrying on error


def print_status():
    """Print queue status."""
    if not DB_PATH.exists():
        print("Database not initialized. Run: python worker.py --init")
        return

    status = get_queue_status()
    print("\n" + "=" * 40)
    print("  LLM Inference Queue Status")
    print("=" * 40)
    print(f"  Total jobs:     {status['total_jobs']}")
    print(f"  Pending:        {status['pending']}")
    print(f"  Processing:     {status['processing']}")
    print(f"  Completed:      {status['completed']}")
    print(f"  Failed:         {status['failed']}")
    if status['avg_processing_time_ms']:
        print(f"  Avg time:       {status['avg_processing_time_ms']}ms")
    print("=" * 40 + "\n")


# =============================================================================
# CLI
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description="LLM Inference Worker")
    parser.add_argument("--init", action="store_true", help="Initialize database")
    parser.add_argument("--status", action="store_true", help="Show queue status")
    parser.add_argument("--poll-interval", type=float, default=2.0,
                        help="Seconds between queue polls (default: 2)")

    args = parser.parse_args()

    if args.init:
        init_database()
    elif args.status:
        print_status()
    else:
        run_worker(poll_interval=args.poll_interval)


if __name__ == "__main__":
    main()
