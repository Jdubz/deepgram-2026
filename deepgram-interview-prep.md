# Deepgram Backend AI Engineer - Interview Preparation Guide

**GitHub Repository:** https://github.com/Jdubz/deepgram-2026

## Table of Contents
1. [Project Requirements](#project-requirements)
2. [Implementation Overview](#implementation-overview)
3. [Discussion Questions Deep Dive](#discussion-questions-deep-dive)
4. [Study Guide](#study-guide)
5. [Hands-On Exercises](#hands-on-exercises)
6. [Potential Follow-up Tasks](#potential-follow-up-tasks)
7. [Questions to Ask Them](#questions-to-ask-them)

---

## Project Requirements

### Core API Endpoints

| Endpoint | Method | Purpose | Example |
|----------|--------|---------|---------|
| `/files` | POST | Upload raw audio with metadata | `curl -X POST -F "file=@myfile.wav" http://localhost:3000/files` |
| `/list` | GET | List files with filtering | `curl http://localhost:3000/list?maxduration=300` |
| `/download` | GET | Download file content | `curl http://localhost:3000/download?name=myfile.wav` |
| `/info` | GET | Get AI-generated summary | `curl http://localhost:3000/info?name=myfile.wav` |

### Key Requirements
- Store raw audio data
- Support metadata on upload
- Filter results by query parameters (e.g., maxduration)
- Return results as JSON
- LLM summary endpoint (can be mocked)

---

## Implementation Overview

### Tech Stack: Node.js + Express + TypeScript

**Why This Stack:**
- TypeScript provides type safety and better IDE support
- Express is lightweight and flexible for API development
- Strong ecosystem for audio processing (music-metadata)
- Easy to extend with middleware patterns
- Familiar to most backend developers

### Project Structure
```
deepgram-2026/
├── backend/
│   ├── src/
│   │   ├── index.ts              # Express server entry point
│   │   ├── routes/
│   │   │   └── audio.ts          # API route handlers
│   │   ├── services/
│   │   │   ├── storage.ts        # Audio storage (in-memory)
│   │   │   ├── audio.ts          # Audio validation/metadata extraction
│   │   │   ├── llm.ts            # LLM service (mocked)
│   │   │   ├── localai.ts        # LocalAI HTTP client
│   │   │   ├── job-processor.ts  # Background job processor
│   │   │   └── inference-queue.ts # SQLite queue management
│   │   └── types/
│   │       └── index.ts          # TypeScript interfaces
│   ├── data/                     # SQLite database (gitignored)
│   ├── uploads/                  # Uploaded audio files (gitignored)
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx               # Main React component
│   │   └── main.tsx              # Entry point
│   ├── package.json
│   └── vite.config.ts
├── scripts/
│   ├── test-api.sh               # API test suite
│   └── curl-examples.sh          # Example curl commands
└── README.md
```

### Key Implementation Details

#### Type Definitions (`backend/src/types/index.ts`)

```typescript
export interface AudioMetadata {
  id: string;
  filename: string;
  originalFilename: string;
  mimeType: string;
  size: number;
  duration: number; // seconds
  channels?: number;
  sampleRate?: number;
  uploadedAt: Date;
  customMetadata: Record<string, string>;
}

export interface AudioFile {
  metadata: AudioMetadata;
  content: Buffer;
}

export interface ListFilesQuery {
  maxduration?: number;
  minduration?: number;
  limit?: number;
  offset?: number;
}

export interface LLMResponse {
  text: string;
  tokensUsed: number;
  model: string;
  latencyMs: number;
}
```

#### Route Handler Example (`backend/src/routes/audio.ts`)

```typescript
import { Router, Request, Response } from "express";
import multer from "multer";
import { storage } from "../services/storage.js";
import { audioService } from "../services/audio.js";
import { llmService } from "../services/llm.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
});

/**
 * POST /files - Upload audio with metadata
 */
router.post("/files", upload.single("file"), async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  // Extract custom metadata from form fields
  const customMetadata: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.body)) {
    if (typeof value === "string") customMetadata[key] = value;
  }

  // Validate and extract audio metadata
  const result = await audioService.validateAndExtract(
    req.file.buffer,
    req.file.originalname,
    customMetadata
  );

  if (!result.valid || !result.metadata) {
    return res.status(422).json({ error: result.error });
  }

  // Store the file
  await storage.store(result.metadata.id, {
    metadata: result.metadata,
    content: req.file.buffer,
  });

  res.status(201).json({
    id: result.metadata.id,
    filename: result.metadata.filename,
    duration: result.metadata.duration,
    size: result.metadata.size,
    message: "File uploaded successfully",
  });
});

/**
 * GET /list - List files with filtering
 */
router.get("/list", async (req: Request, res: Response) => {
  let files = await storage.listAll();

  // Apply duration filters
  const maxduration = req.query.maxduration ? Number(req.query.maxduration) : undefined;
  const minduration = req.query.minduration ? Number(req.query.minduration) : undefined;

  if (maxduration !== undefined) {
    files = files.filter((f) => f.duration <= maxduration);
  }
  if (minduration !== undefined) {
    files = files.filter((f) => f.duration >= minduration);
  }

  // Apply pagination
  const limit = Number(req.query.limit) || 100;
  const offset = Number(req.query.offset) || 0;
  const total = files.length;
  files = files.slice(offset, offset + limit);

  res.json({ files, total, limit, offset });
});

/**
 * GET /info - Get AI summary of file
 */
router.get("/info", async (req: Request, res: Response) => {
  const { name, id } = req.query;

  const file = id
    ? await storage.getById(id as string)
    : await storage.getByFilename(name as string);

  if (!file) {
    return res.status(404).json({ error: "File not found" });
  }

  const llmResponse = await llmService.summarize(file.metadata);

  res.json({
    filename: file.metadata.filename,
    duration: file.metadata.duration,
    size: file.metadata.size,
    summary: llmResponse.text,
  });
});
```

---

## Discussion Questions Deep Dive

### 1. LLM Orchestration Frameworks

**Frameworks to Know:**
- **LangChain.js**: Popular TypeScript/JavaScript framework for LLM apps
- **LlamaIndex**: Specialized for RAG and data indexing
- **Semantic Kernel**: Microsoft's framework (C#/Python, limited TS)
- **Vercel AI SDK**: Lightweight, streaming-focused

**When to Use:**
```
USE orchestration when:
├── Multi-step pipelines (transcribe → summarize → extract)
├── Need prompt versioning and management
├── Building agent-based systems
├── Want observability/tracing for each step
└── Complex routing between models

AVOID when:
├── Simple single API calls
├── Overhead outweighs benefits
└── Need maximum performance (adds latency)
```

**Architecture Example:**

```typescript
// LangChain-style pipeline for audio processing
import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";

class AudioPipeline {
  private summarizeChain: RunnableSequence;
  private extractChain: RunnableSequence;

  constructor() {
    const llm = new ChatOpenAI({ modelName: "gpt-4" });

    const summaryPrompt = PromptTemplate.fromTemplate(
      "Summarize this transcript concisely:\n{transcript}"
    );

    const extractPrompt = PromptTemplate.fromTemplate(
      "Extract key topics from this transcript:\n{transcript}"
    );

    this.summarizeChain = RunnableSequence.from([summaryPrompt, llm]);
    this.extractChain = RunnableSequence.from([extractPrompt, llm]);
  }

  async process(transcript: string) {
    const [summary, topics] = await Promise.all([
      this.summarizeChain.invoke({ transcript }),
      this.extractChain.invoke({ transcript }),
    ]);

    return { summary: summary.content, topics: topics.content };
  }
}
```

---

### 2. Validating and Monitoring AI Outputs

**Validation Strategies:**

| Strategy | Description | Implementation |
|----------|-------------|----------------|
| **Structured Output** | Force JSON schema compliance | Zod + function calling |
| **Guardrails** | Check for PII, toxicity, off-topic | Regex, classifier models |
| **Confidence Thresholds** | Reject low-confidence outputs | Logprobs analysis |
| **Output Parsing** | Validate format/structure | Try-catch with fallbacks |
| **LLM-as-Judge** | Use another LLM to evaluate | Separate eval prompt |

**Monitoring Strategies:**

| Metric | What to Track |
|--------|---------------|
| **Latency** | p50, p95, p99 response times |
| **Error Rate** | Failed generations, parsing errors |
| **Token Usage** | Input/output tokens per request |
| **Quality Scores** | Human ratings, automated evals |
| **Hallucination Rate** | Fact-checking against source |

**Implementation Example:**

```typescript
import { z } from "zod";

// Define expected output schema
const AudioSummarySchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(10),
  topics: z.array(z.string()),
  sentiment: z.enum(["positive", "negative", "neutral"]),
  confidence: z.number().min(0).max(1),
});

type AudioSummary = z.infer<typeof AudioSummarySchema>;

async function getValidatedSummary(transcript: string): Promise<AudioSummary> {
  const response = await llm.generate({
    prompt: SUMMARY_PROMPT.replace("{transcript}", transcript),
    responseFormat: { type: "json_object" },
  });

  // Parse and validate
  const parsed = JSON.parse(response.text);
  const validated = AudioSummarySchema.parse(parsed);

  // Check confidence threshold
  if (validated.confidence < 0.7) {
    throw new Error("Confidence too low, needs human review");
  }

  // Log for monitoring
  await metrics.record({
    latency: response.latencyMs,
    tokens: response.tokensUsed,
    confidence: validated.confidence,
  });

  return validated;
}
```

---

### 3. When to Use RAG

**RAG (Retrieval-Augmented Generation) Use Cases:**

```
USE RAG when:
├── Large corpus of documents to search
├── Information changes frequently
├── Need citations/sources
├── Domain-specific knowledge required
├── Want to reduce hallucinations with grounding
└── Multi-document question answering

DON'T USE RAG when:
├── Single document analysis
├── Information is static (fine-tune instead)
├── Real-time requirements (adds latency)
└── Simple tasks that don't need external knowledge
```

**RAG Architecture for Audio:**
```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Audio File  │────▶│ Transcribe  │────▶│   Chunk     │
└─────────────┘     └─────────────┘     └─────────────┘
                                               │
                                               ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Answer    │◀────│  LLM + ctx  │◀────│  Retrieve   │
└─────────────┘     └─────────────┘     └─────────────┘
                                               ▲
                                               │
                                        ┌─────────────┐
                                        │ Vector DB   │
                                        │ (pgvector,  │
                                        │  Pinecone)  │
                                        └─────────────┘
```

**Implementation:**

```typescript
import { Pipeline } from "@xenova/transformers";

class AudioRAG {
  private embedder: Pipeline | null = null;
  private vectorStore: Array<{
    fileId: string;
    chunkId: number;
    text: string;
    embedding: number[];
  }> = [];

  async initialize() {
    // Load embedding model
    this.embedder = await Pipeline.getInstance(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2"
    );
  }

  async indexTranscript(fileId: string, transcript: string): Promise<void> {
    const chunks = this.chunkText(transcript, 500, 50);

    for (let i = 0; i < chunks.length; i++) {
      const embedding = await this.embed(chunks[i]);
      this.vectorStore.push({
        fileId,
        chunkId: i,
        text: chunks[i],
        embedding,
      });
    }
  }

  async retrieve(query: string, topK: number = 5): Promise<string[]> {
    const queryEmbedding = await this.embed(query);

    const similarities = this.vectorStore.map((doc) => ({
      text: doc.text,
      similarity: this.cosineSimilarity(queryEmbedding, doc.embedding),
    }));

    similarities.sort((a, b) => b.similarity - a.similarity);
    return similarities.slice(0, topK).map((s) => s.text);
  }

  async answer(query: string): Promise<string> {
    const context = await this.retrieve(query);
    const prompt = `Based on the following audio transcripts:

${context.join("\n\n")}

Answer: ${query}`;

    return await llm.generate(prompt);
  }

  private chunkText(text: string, size: number, overlap: number): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += size - overlap) {
      chunks.push(text.slice(i, i + size));
    }
    return chunks;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    return dot / (magA * magB);
  }
}
```

---

### 4. Multi-Provider LLM Architecture

**Design Pattern: Provider Abstraction**

```typescript
// Provider interface
interface LLMProvider {
  name: string;
  summarize(text: string, options?: LLMOptions): Promise<LLMResponse>;
  embed(text: string): Promise<number[]>;
}

interface LLMOptions {
  maxTokens?: number;
  temperature?: number;
}

interface LLMResponse {
  text: string;
  tokensUsed: number;
  model: string;
  latencyMs: number;
}

// OpenAI implementation
class OpenAIProvider implements LLMProvider {
  name = "openai";
  private client: OpenAI;

  constructor(apiKey: string, private model: string = "gpt-4") {
    this.client = new OpenAI({ apiKey });
  }

  async summarize(text: string, options?: LLMOptions): Promise<LLMResponse> {
    const start = Date.now();
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: "user", content: `Summarize: ${text}` }],
      max_tokens: options?.maxTokens ?? 500,
      temperature: options?.temperature ?? 0.3,
    });

    return {
      text: response.choices[0].message.content ?? "",
      tokensUsed: response.usage?.total_tokens ?? 0,
      model: this.model,
      latencyMs: Date.now() - start,
    };
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });
    return response.data[0].embedding;
  }
}

// Anthropic implementation
class AnthropicProvider implements LLMProvider {
  name = "anthropic";
  private client: Anthropic;

  constructor(apiKey: string, private model: string = "claude-3-sonnet-20240229") {
    this.client = new Anthropic({ apiKey });
  }

  async summarize(text: string, options?: LLMOptions): Promise<LLMResponse> {
    const start = Date.now();
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: options?.maxTokens ?? 500,
      messages: [{ role: "user", content: `Summarize: ${text}` }],
    });

    return {
      text: response.content[0].type === "text" ? response.content[0].text : "",
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
      model: this.model,
      latencyMs: Date.now() - start,
    };
  }

  async embed(text: string): Promise<number[]> {
    // Anthropic doesn't have embeddings - use OpenAI or local model
    throw new Error("Use OpenAI or local embeddings");
  }
}

// Router with fallback
class LLMRouter {
  private providers = new Map<string, LLMProvider>();
  private defaultProvider: string = "openai";

  register(provider: LLMProvider): void {
    this.providers.set(provider.name, provider);
  }

  get(name?: string): LLMProvider {
    const provider = this.providers.get(name ?? this.defaultProvider);
    if (!provider) throw new Error(`Provider ${name} not registered`);
    return provider;
  }

  async summarizeWithFallback(text: string): Promise<LLMResponse> {
    const providerOrder = [this.defaultProvider, ...this.providers.keys()];
    const errors: Array<{ provider: string; error: Error }> = [];

    for (const name of providerOrder) {
      try {
        const provider = this.providers.get(name);
        if (provider) {
          return await provider.summarize(text);
        }
      } catch (error) {
        errors.push({ provider: name, error: error as Error });
      }
    }

    throw new Error(`All providers failed: ${JSON.stringify(errors)}`);
  }
}

// Usage
const router = new LLMRouter();
router.register(new OpenAIProvider(process.env.OPENAI_API_KEY!));
router.register(new AnthropicProvider(process.env.ANTHROPIC_API_KEY!));

// Easy to swap providers
const response = await router.get("anthropic").summarize(transcript);
```

**Alternative: Use a Unified Library**

```typescript
// LiteLLM-style unified interface (conceptual)
import { generateText } from "ai"; // Vercel AI SDK

const response = await generateText({
  model: openai("gpt-4"), // or anthropic("claude-3-sonnet")
  prompt: "Summarize this transcript...",
});
```

---

### 5. Caching, Batching, and Routing Strategies

**Caching Strategies:**

| Type | Use Case | Implementation |
|------|----------|----------------|
| **Exact Match** | Identical inputs | Hash input → Redis lookup |
| **Semantic Cache** | Similar inputs | Embed → vector similarity search |
| **TTL Cache** | Time-sensitive data | Expire after N seconds |
| **User-scoped** | Per-user results | Include user_id in cache key |

```typescript
import { createHash } from "crypto";
import Redis from "ioredis";

class LLMCache {
  private redis: Redis;
  private semanticThreshold = 0.95;

  constructor() {
    this.redis = new Redis(process.env.REDIS_URL);
  }

  private hashKey(prompt: string): string {
    return createHash("sha256").update(prompt).digest("hex");
  }

  async getExact(prompt: string): Promise<string | null> {
    const key = this.hashKey(prompt);
    return this.redis.get(`llm:exact:${key}`);
  }

  async getSemantic(prompt: string, embedder: LLMProvider): Promise<string | null> {
    const embedding = await embedder.embed(prompt);
    // Search vector store for similar prompts (threshold: 0.95)
    // Return cached response if found
    return null; // Implement with your vector store
  }

  async set(prompt: string, response: string, ttl: number = 3600): Promise<void> {
    const key = this.hashKey(prompt);
    await this.redis.setex(`llm:exact:${key}`, ttl, response);
  }

  async getOrGenerate(
    prompt: string,
    generator: () => Promise<string>
  ): Promise<string> {
    // Try exact cache
    const exactCached = await this.getExact(prompt);
    if (exactCached) return exactCached;

    // Generate and cache
    const response = await generator();
    await this.set(prompt, response);
    return response;
  }
}
```

**Batching Strategy:**

```typescript
class BatchProcessor {
  private queue: Array<{
    prompt: string;
    resolve: (value: string) => void;
    reject: (error: Error) => void;
  }> = [];
  private batchSize = 10;
  private maxWaitMs = 100;
  private timer: NodeJS.Timeout | null = null;

  async process(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.queue.push({ prompt, resolve, reject });

      if (this.queue.length >= this.batchSize) {
        this.flushBatch();
      } else if (!this.timer) {
        this.timer = setTimeout(() => this.flushBatch(), this.maxWaitMs);
      }
    });
  }

  private async flushBatch(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const batch = this.queue.splice(0, this.batchSize);
    if (batch.length === 0) return;

    try {
      const prompts = batch.map((b) => b.prompt);
      const responses = await this.llm.batchGenerate(prompts);

      batch.forEach((item, i) => item.resolve(responses[i]));
    } catch (error) {
      batch.forEach((item) => item.reject(error as Error));
    }
  }
}
```

**Smart Routing:**

```typescript
class SmartRouter {
  private cheapModel = "gpt-3.5-turbo"; // Fast, cheap
  private expensiveModel = "gpt-4";      // Slow, accurate

  async route(prompt: string, taskType: string): Promise<string> {
    // Simple tasks → cheap model
    if (["classification", "extraction", "simple_qa"].includes(taskType)) {
      return this.generate(this.cheapModel, prompt);
    }

    // Complex reasoning → expensive model
    if (["analysis", "summarization", "reasoning"].includes(taskType)) {
      return this.generate(this.expensiveModel, prompt);
    }

    // Estimate complexity from prompt
    if (prompt.length < 500) {
      return this.generate(this.cheapModel, prompt);
    }

    return this.generate(this.expensiveModel, prompt);
  }
}
```

---

### 6. Audio Storage Strategies

**Options Comparison:**

| Storage | Pros | Cons | Best For |
|---------|------|------|----------|
| **In-Memory** | Fastest, simple | No persistence, limited size | Interview/dev |
| **Local Filesystem** | Simple, fast reads | Single server, no redundancy | Small deployments |
| **S3/GCS/Azure Blob** | Scalable, cheap, CDN | Network latency, complexity | Production |
| **Database BLOBs** | Transactional, consistent | Expensive, slow for large files | Small files with strong consistency needs |

**Production Architecture:**
```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Client     │────▶│   API        │────▶│  PostgreSQL  │
│              │     │   Server     │     │  (metadata)  │
└──────────────┘     └──────────────┘     └──────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │     S3       │
                     │ (audio data) │
                     └──────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │  CloudFront  │
                     │    (CDN)     │
                     └──────────────┘
```

**Implementation:**

```typescript
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

class S3AudioStorage {
  private s3: S3Client;
  private bucket: string;

  constructor() {
    this.s3 = new S3Client({ region: process.env.AWS_REGION });
    this.bucket = process.env.S3_BUCKET!;
  }

  async store(fileId: string, content: Buffer, metadata: AudioMetadata): Promise<string> {
    const key = `audio/${fileId}/${metadata.filename}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: content,
        ContentType: metadata.mimeType,
        Metadata: {
          originalFilename: metadata.originalFilename,
          duration: String(metadata.duration),
        },
      })
    );

    return key;
  }

  async getDownloadUrl(key: string, expiresIn: number = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return getSignedUrl(this.s3, command, { expiresIn });
  }

  async getUploadUrl(fileId: string, filename: string): Promise<string> {
    const key = `audio/${fileId}/${filename}`;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return getSignedUrl(this.s3, command, { expiresIn: 3600 });
  }
}
```

---

### 7. Authentication and Security

**Authentication Methods:**

| Method | Pros | Cons | Best For |
|--------|------|------|----------|
| **API Keys** | Simple, stateless | No user identity, hard to revoke | Service-to-service |
| **JWT** | Stateless, self-contained | Can't revoke easily | Web apps, mobile |
| **OAuth2** | Standard, delegation | Complex setup | Third-party integrations |
| **Session Cookies** | Simple, revocable | Stateful, CSRF risk | Traditional web apps |

**Security Layers:**

```
┌─────────────────────────────────────────────────────────────┐
│                    SECURITY LAYERS                          │
├─────────────────────────────────────────────────────────────┤
│  1. Transport: HTTPS/TLS only                               │
│  2. Authentication: Verify identity (JWT, API key)          │
│  3. Authorization: Check permissions (RBAC, ABAC)           │
│  4. Input Validation: Sanitize all inputs                   │
│  5. Rate Limiting: Prevent abuse                            │
│  6. Audit Logging: Track all access                         │
│  7. Encryption at Rest: S3 SSE, DB encryption               │
└─────────────────────────────────────────────────────────────┘
```

**Implementation:**

```typescript
import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";

interface User {
  id: string;
  email: string;
  roles: string[];
}

interface AuthRequest extends Request {
  user?: User;
}

// JWT Middleware
function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing authorization header" });
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as User;
    req.user = payload;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: "Token expired" });
    }
    return res.status(401).json({ error: "Invalid token" });
  }
}

// Role-based access control
function requireRole(role: string) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user?.roles.includes(role)) {
      return res.status(403).json({ error: `Role ${role} required` });
    }
    next();
  };
}

// Usage in routes
router.get("/files", authenticate, async (req: AuthRequest, res) => {
  // Users can only see their own files
  const files = await storage.listByOwner(req.user!.id);
  res.json(files);
});

router.delete("/files/:id", authenticate, requireRole("admin"), async (req, res) => {
  // Only admins can delete
  await storage.delete(req.params.id);
  res.json({ message: "Deleted" });
});
```

---

### 8. Data Integrity and Validation

**Validation Strategies:**

| Check | Purpose | Implementation |
|-------|---------|----------------|
| **Magic Bytes** | Verify actual file type | `file-type` library |
| **Size Limits** | Prevent DoS | Check before processing |
| **Content-Type** | Basic type check | Validate header matches content |
| **Audio Parsing** | Verify valid audio | Try to decode with audio library |
| **Filename Sanitization** | Prevent path traversal | Strip `..`, `/`, special chars |
| **Checksum** | Verify integrity | MD5/SHA256 on upload |

**Implementation:**

```typescript
import { fileTypeFromBuffer } from "file-type";
import { parseBuffer } from "music-metadata";
import { createHash } from "crypto";

const ALLOWED_MIMES = new Set([
  "audio/wav",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp3",
  "audio/ogg",
  "audio/flac",
  "audio/webm",
]);

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

interface ValidationResult {
  valid: boolean;
  error?: string;
  metadata?: {
    filename: string;
    mimeType: string;
    size: number;
    duration: number;
    checksum: string;
  };
}

class AudioValidator {
  static sanitizeFilename(filename: string): string {
    // Remove path traversal attempts
    let safe = filename.replace(/\.\./g, "").replace(/[/\\]/g, "");
    // Keep only safe characters
    safe = safe.replace(/[^a-zA-Z0-9._-]/g, "_");
    return safe;
  }

  static async validate(
    content: Buffer,
    filename: string
  ): Promise<ValidationResult> {
    // 1. Check size
    if (content.length > MAX_FILE_SIZE) {
      return {
        valid: false,
        error: `File too large. Max: ${MAX_FILE_SIZE / 1024 / 1024}MB`,
      };
    }

    if (content.length === 0) {
      return { valid: false, error: "Empty file" };
    }

    // 2. Check magic bytes (actual content type)
    const fileType = await fileTypeFromBuffer(content);
    if (!fileType || !ALLOWED_MIMES.has(fileType.mime)) {
      return {
        valid: false,
        error: `Invalid audio format: ${fileType?.mime ?? "unknown"}`,
      };
    }

    // 3. Sanitize filename
    const safeFilename = this.sanitizeFilename(filename);

    // 4. Try to parse as audio
    let duration = 0;
    try {
      const mm = await parseBuffer(content);
      duration = mm.format.duration ?? 0;
    } catch (error) {
      return {
        valid: false,
        error: `Could not parse audio file: ${error}`,
      };
    }

    // 5. Calculate checksum
    const checksum = createHash("sha256").update(content).digest("hex");

    return {
      valid: true,
      metadata: {
        filename: safeFilename,
        mimeType: fileType.mime,
        size: content.length,
        duration,
        checksum,
      },
    };
  }
}
```

---

## Study Guide

### Core Concepts to Master

#### 1. Express.js Deep Dive
- [ ] Middleware patterns (auth, logging, error handling)
- [ ] Request/Response lifecycle
- [ ] File uploads with multer
- [ ] Error handling best practices
- [ ] Router organization

#### 2. TypeScript Patterns
- [ ] Interface design for APIs
- [ ] Generic types for reusability
- [ ] Type guards and narrowing
- [ ] Module organization
- [ ] Async/await patterns

#### 3. Audio Processing
- [ ] Common audio formats (WAV, MP3, FLAC, OGG)
- [ ] Audio metadata extraction (music-metadata)
- [ ] File validation with magic bytes
- [ ] Duration, sample rate, channels

#### 4. LLM Integration
- [ ] OpenAI API (chat completions, function calling)
- [ ] Anthropic API (messages, tools)
- [ ] Prompt engineering best practices
- [ ] Structured output / JSON mode
- [ ] Token counting and context limits
- [ ] Streaming responses

#### 5. Vector Databases & Embeddings
- [ ] Embedding models (OpenAI, sentence-transformers)
- [ ] Vector similarity search (cosine, dot product)
- [ ] pgvector, Pinecone, Qdrant
- [ ] Chunking strategies
- [ ] Hybrid search (vector + keyword)

#### 6. Caching & Performance
- [ ] Redis fundamentals
- [ ] Cache invalidation strategies
- [ ] TTL management
- [ ] Request batching
- [ ] Async patterns

#### 7. Security
- [ ] JWT tokens (structure, signing, validation)
- [ ] API key management
- [ ] Input sanitization
- [ ] Rate limiting
- [ ] CORS configuration

#### 8. Cloud Storage
- [ ] S3 concepts (buckets, keys, pre-signed URLs)
- [ ] IAM policies
- [ ] CDN basics
- [ ] Multipart uploads

### Deepgram-Specific Knowledge

Since this is for Deepgram, know their products:
- [ ] Speech-to-Text API
- [ ] Real-time streaming transcription
- [ ] Pre-recorded audio transcription
- [ ] Diarization (speaker identification)
- [ ] Language detection
- [ ] Nova-2 model capabilities

---

## Hands-On Exercises

The `deepgram-2026` repository contains a scaffolded project with TODO comments marking exercises.

### Getting Started

```bash
# Clone the repo
git clone https://github.com/Jdubz/deepgram-2026.git
cd deepgram-2026

# Start the backend
cd backend
npm install
npm run dev

# In another terminal, start the frontend
cd frontend
npm install
npm run dev

# Run tests
cd scripts
./test-api.sh
```

### Exercise Checklist

| # | Exercise | File | Topic |
|---|----------|------|-------|
| 1 | LLM Orchestration | `backend/src/services/llm.ts` | Add LangChain.js integration |
| 2 | Output Validation | `backend/src/services/llm.ts` | Add Zod schema validation |
| 3 | RAG Implementation | `backend/src/services/llm.ts` | Add vector storage/retrieval |
| 4 | Multi-Provider | `backend/src/services/llm.ts` | Create provider abstraction |
| 5 | Caching | `backend/src/services/llm.ts` | Add Redis/semantic caching |
| 6 | Storage Abstraction | `backend/src/services/storage.ts` | Implement S3 storage |
| 7 | Authentication | `backend/src/routes/audio.ts` | Add JWT auth middleware |
| 8 | Data Validation | `backend/src/services/audio.ts` | Robust file validation with magic bytes |
| 9 | Local Inference | `backend/src/services/job-processor.ts` | LocalAI + Node.js job processor |

### Exercise 9: Local LLM Integration with LocalAI

Connect the API to LocalAI for real transcription (Whisper) and summarization (LLM).

**Architecture Overview:**
```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Express    │────▶│     Job      │────▶│   LocalAI    │
│   Server     │     │  Processor   │     │   (Docker)   │
└──────────────┘     └──────────────┘     └──────────────┘
       │                    │                    │
       │                    ▼                    │
       │             ┌──────────────┐            │
       └────────────▶│   SQLite     │◀───────────┘
                     │   Queue      │
                     └──────────────┘
```

The job processor runs embedded in the Express server and processes jobs sequentially (single-GPU constraint). LocalAI provides an OpenAI-compatible API for both Whisper and LLM inference.

**Files involved:**
- `backend/src/services/localai.ts` - HTTP client for LocalAI
- `backend/src/services/job-processor.ts` - Background job processor
- `backend/src/services/inference-queue.ts` - SQLite queue management
- `backend/src/routes/audio.ts` - API endpoints

**Key Endpoints:**
- `POST /files` - Upload audio → queued for processing
- `GET /info?id=X` - Get transcript/summary (or processing status)
- `GET /submissions/:id` - Full submission details with jobs
- `GET /queue/status` - Queue and processor status
- `GET /health` - Service health including LocalAI status

**Start LocalAI (requires Docker):**
```bash
# Pull and run LocalAI with Whisper + LLM support
docker run -p 8080:8080 \
  -v $HOME/models:/models \
  localai/localai:latest-aio-cpu

# Or with GPU (recommended)
docker run -p 8080:8080 --gpus all \
  -v $HOME/models:/models \
  localai/localai:latest-aio-gpu
```

**Start the backend:**
```bash
cd backend
npm install
npm run dev
```

**Test flow:**
```bash
# 1. Check health (LocalAI connected)
curl http://localhost:3000/health

# 2. Upload audio file
curl -X POST -F "file=@test.wav" http://localhost:3000/files
# Returns: { id: "abc123", status: "pending" }

# 3. Check queue status
curl http://localhost:3000/queue/status
# Returns: { queue: { pending: 1 }, processor: { isProcessing: true } }

# 4. Poll for completion
curl http://localhost:3000/submissions/abc123
# Eventually: { submission: { status: "completed", transcript: "...", summary: "..." } }

# 5. Get final info
curl http://localhost:3000/info?id=abc123
# Returns: { transcript: "...", summary: "..." }
```

**Processing Flow:**
1. Upload audio → saves to `backend/uploads/` + creates submission
2. Job processor claims transcribe job (atomic)
3. LocalAI transcribes (Whisper via `/v1/audio/transcriptions`)
4. Auto-creates summarize job
5. LocalAI summarizes (LLM via `/v1/chat/completions`)
6. Submission marked complete with transcript + summary

**Single-Job Guarantee:**
Three layers ensure only one job runs at a time:
1. **Mutex**: `isProcessing` boolean checked before claiming
2. **Atomic SQL**: `UPDATE ... WHERE id = (SELECT ...) RETURNING *`
3. **No parallelism**: Sequential polling loop

### Study Flow

1. **Day 1**: Get the project running, understand the codebase structure
2. **Day 2**: Complete Exercises 1-2 (LLM integration, validation)
3. **Day 3**: Complete Exercises 3-4 (RAG, multi-provider)
4. **Day 4**: Complete Exercises 5-6 (caching, storage)
5. **Day 5**: Complete Exercises 7-8 (security, validation)
6. **Day 6**: Complete Exercise 9 (local inference integration)
7. **Day 7**: Practice explaining your design decisions out loud

---

## Potential Follow-up Tasks

During the interview, they may ask you to add:

1. **Real Transcription Integration**
   - Integrate Deepgram's API for actual transcription
   - Handle async transcription with callbacks

2. **Streaming Uploads/Downloads**
   - Support chunked transfer encoding
   - Handle large files without loading into memory

3. **Background Processing**
   - Queue long-running transcription jobs
   - Status polling endpoint
   - Webhook callbacks on completion

4. **Rate Limiting**
   - Per-user rate limits
   - Token bucket algorithm

5. **Pagination**
   - Add cursor-based pagination to list endpoint
   - Sort options

6. **Search**
   - Full-text search across transcripts
   - Semantic search with embeddings

7. **Real-time Updates**
   - WebSocket for progress updates
   - Server-sent events

---

## Questions to Ask Them

### Technical Questions
1. "What's the primary use case for audio in your customers' workflows?"
2. "How do you handle the latency tradeoff between streaming and batch transcription?"
3. "What's your approach to model versioning when Deepgram updates its models?"
4. "How do you handle multi-language audio in real-time?"

### Team/Culture Questions
1. "What does the typical development cycle look like for new features?"
2. "How does the AI/ML team collaborate with the backend team?"
3. "What's the biggest technical challenge you're working on right now?"

### Product Questions
1. "How are customers using Deepgram beyond basic transcription?"
2. "What's on the roadmap for the next year?"
3. "How do you differentiate from competitors like AssemblyAI or AWS Transcribe?"

---

## Quick Reference Card

### TypeScript/Node Libraries
```bash
npm install express multer music-metadata uuid zod better-sqlite3
npm install -D typescript @types/express @types/multer @types/uuid @types/better-sqlite3
```

### LLM Libraries
```bash
npm install openai @anthropic-ai/sdk @langchain/openai
```

### AWS SDK
```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

### LocalAI Setup (for local inference)
```bash
# Run LocalAI with Docker (CPU)
docker run -p 8080:8080 localai/localai:latest-aio-cpu

# Or with GPU support
docker run -p 8080:8080 --gpus all localai/localai:latest-aio-gpu

# Environment variables (optional)
export LOCALAI_URL=http://localhost:8080
export LOCALAI_WHISPER_MODEL=whisper-1
export LOCALAI_LLM_MODEL=llama3
```

### Run Server
```bash
cd backend && npm run dev
```

### Test with curl
```bash
# Upload (queued for processing)
curl -X POST -F "file=@test.wav" -F "title=My Recording" http://localhost:3000/files

# List files
curl "http://localhost:3000/list?maxduration=300"

# Download
curl "http://localhost:3000/download?id=abc123" -o downloaded.wav

# Check processing status
curl "http://localhost:3000/submissions/abc123"

# Get transcript/summary (after processing)
curl "http://localhost:3000/info?id=abc123"

# Check queue status
curl "http://localhost:3000/queue/status"

# Health check (includes LocalAI status)
curl "http://localhost:3000/health"
```
