# Base stage with build dependencies
FROM node:20-slim AS base

WORKDIR /app

# Install build dependencies for better-sqlite3 native module
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy package files first (better layer caching)
COPY package*.json ./

# Install all dependencies (including dev)
RUN npm ci

# Development stage - hot reload with tsx watch
FROM base AS development

# Create directories for data and uploads
RUN mkdir -p /app/data /app/uploads

ENV NODE_ENV=development
ENV PORT=3000

EXPOSE 3000

# Source code mounted as volume, run tsx watch
CMD ["npm", "run", "dev"]

# Builder stage - compile TypeScript
FROM base AS builder

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Prune dev dependencies after build
RUN npm prune --production

# Production stage
FROM node:20-slim

WORKDIR /app

# Install only runtime dependencies (curl for health check)
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN groupadd --gid 1001 nodejs \
    && useradd --uid 1001 --gid nodejs --shell /bin/bash --create-home nodejs

# Copy package.json for reference
COPY package*.json ./

# Copy pre-built node_modules from builder (includes native modules)
COPY --from=builder /app/node_modules ./node_modules

# Copy built JavaScript files
COPY --from=builder /app/dist ./dist

# Create directories for data and uploads with correct ownership
RUN mkdir -p /app/data /app/uploads \
    && chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV LOCALAI_URL=http://localai:8080

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
