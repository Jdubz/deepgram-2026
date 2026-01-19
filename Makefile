# Deepgram Audio API - Development Makefile

.PHONY: help install install-backend install-frontend \
        dev dev-backend dev-frontend build build-backend build-frontend \
        test test-backend test-api curl-examples \
        db-reset db-status \
        clean clean-all clean-db logs \
        test-health test-upload test-list

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
	@echo "  make test-api       Run API integration tests (requires running server)"
	@echo "  make curl-examples  Show curl command examples"
	@echo ""
	@echo "Quick API Tests:"
	@echo "  make test-health    Check server health"
	@echo "  make test-upload FILE=audio.wav  Upload a file"
	@echo "  make test-list      List all files"
	@echo ""
	@echo "Database:"
	@echo "  make db-reset       Reset the SQLite database"
	@echo "  make db-status      Show queue status"
	@echo ""
	@echo "Utilities:"
	@echo "  make clean          Remove build artifacts (preserves node_modules)"
	@echo "  make clean-all      Remove build artifacts and node_modules"
	@echo "  make clean-db       Remove database and uploaded files"
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

test-api:
	@echo "Running API integration tests..."
	@chmod +x scripts/test-api.sh
	./scripts/test-api.sh

curl-examples:
	@echo "Showing curl examples..."
	@chmod +x scripts/curl-examples.sh
	./scripts/curl-examples.sh

# =============================================================================
# Database
# =============================================================================

db-reset:
	@echo "Resetting database..."
	rm -f backend/data/deepgram.db backend/data/deepgram.db-wal backend/data/deepgram.db-shm
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
	rm -f backend/data/deepgram.db backend/data/deepgram.db-wal backend/data/deepgram.db-shm
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
ifndef FILE
	@echo "Usage: make test-upload FILE=path/to/audio.wav"
	@echo "Optional: make test-upload FILE=path/to/audio.wav PROVIDER=deepgram"
else
	curl -X POST -F "file=@$(FILE)" $(if $(PROVIDER),-F "provider=$(PROVIDER)",) http://localhost:3001/files | jq .
endif

test-list:
	@curl -s http://localhost:3001/list | jq .
