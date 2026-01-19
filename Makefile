# Deepgram Audio API - Development Makefile

.PHONY: help install dev dev-backend dev-frontend build build-backend build-frontend \
        test clean db-reset db-status logs

# Default target
help:
	@echo "Deepgram Audio API - Development Commands"
	@echo ""
	@echo "Setup:"
	@echo "  make install        Install all dependencies (backend + frontend)"
	@echo "  make install-backend Install backend dependencies only"
	@echo "  make install-frontend Install frontend dependencies only"
	@echo ""
	@echo "Development:"
	@echo "  make dev            Start both backend and frontend in dev mode"
	@echo "  make dev-backend    Start backend dev server (port 3001)"
	@echo "  make dev-frontend   Start frontend dev server (port 5173)"
	@echo ""
	@echo "Build:"
	@echo "  make build          Build both backend and frontend"
	@echo "  make build-backend  Build backend only"
	@echo "  make build-frontend Build frontend only"
	@echo ""
	@echo "Testing:"
	@echo "  make test           Run all tests"
	@echo "  make test-backend   Run backend tests"
	@echo ""
	@echo "Database:"
	@echo "  make db-reset       Reset the SQLite database"
	@echo "  make db-status      Show queue status"
	@echo ""
	@echo "Utilities:"
	@echo "  make clean          Remove build artifacts and node_modules"
	@echo "  make clean-db       Remove database files"
	@echo "  make logs           Tail backend logs"
	@echo ""
	@echo "Environment Variables:"
	@echo "  DEFAULT_PROVIDER    Set default inference provider (local|deepgram)"
	@echo "  DEEPGRAM_API_KEY    Deepgram API key (required for deepgram provider)"
	@echo "  LOCALAI_URL         LocalAI server URL (default: http://localhost:8080)"

# =============================================================================
# Installation
# =============================================================================

install: install-backend install-frontend
	@echo "All dependencies installed"

install-backend:
	@echo "Installing backend dependencies..."
	cd backend && npm install

install-frontend:
	@echo "Installing frontend dependencies..."
	cd frontend && npm install

# =============================================================================
# Development
# =============================================================================

dev:
	@echo "Starting development servers..."
	@echo "Backend: http://localhost:3001"
	@echo "Frontend: http://localhost:5173"
	@echo ""
	@make -j2 dev-backend dev-frontend

dev-backend:
	cd backend && npm run dev

dev-frontend:
	cd frontend && npm run dev

# =============================================================================
# Build
# =============================================================================

build: build-backend build-frontend
	@echo "Build complete"

build-backend:
	@echo "Building backend..."
	cd backend && npm run build

build-frontend:
	@echo "Building frontend..."
	cd frontend && npm run build

# =============================================================================
# Testing
# =============================================================================

test: test-backend
	@echo "All tests complete"

test-backend:
	@echo "Running backend tests..."
	cd backend && npm test

# =============================================================================
# Database
# =============================================================================

db-reset:
	@echo "Resetting database..."
	rm -f backend/data/queue.db backend/data/queue.db-wal backend/data/queue.db-shm
	@echo "Database reset complete"

db-status:
	@echo "Queue status:"
	@curl -s http://localhost:3001/queue/status 2>/dev/null | jq . || echo "Server not running"

# =============================================================================
# Utilities
# =============================================================================

clean:
	@echo "Cleaning build artifacts..."
	rm -rf backend/dist
	rm -rf frontend/dist
	@echo "Clean complete (node_modules preserved)"

clean-all: clean
	@echo "Removing node_modules..."
	rm -rf backend/node_modules
	rm -rf frontend/node_modules
	@echo "Full clean complete"

clean-db:
	@echo "Removing database and uploads..."
	rm -f backend/data/queue.db backend/data/queue.db-wal backend/data/queue.db-shm
	rm -rf backend/uploads/*
	@echo "Database and uploads cleaned"

logs:
	@echo "Backend logs (Ctrl+C to exit):"
	@tail -f backend/logs/*.log 2>/dev/null || echo "No log files found"

# =============================================================================
# Quick test endpoints
# =============================================================================

test-health:
	@curl -s http://localhost:3001/health | jq .

test-upload:
	@echo "Upload a test file with: curl -X POST -F 'file=@yourfile.wav' http://localhost:3001/files"

test-list:
	@curl -s http://localhost:3001/list | jq .
