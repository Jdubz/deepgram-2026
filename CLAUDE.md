# Claude Code Instructions

## Critical Rules

### NEVER Start Services
**Do NOT start any dev servers, Docker containers, or background services.**

The user manages all services manually. When asked to run/start/launch services:
1. Provide the command but DO NOT execute it
2. Remind the user they prefer to start services themselves

### Services in this project
- Backend: `make dev-backend` or `cd backend && npm run dev` (port 3001)
- Frontend: `make dev-frontend` or `cd frontend && npm run dev` (port 5173)
- LocalAI: Docker container `deepgram-2026-localai-1` (port 8080)

### Environment
- Port 3000 is used by job-finder-api (avoid)
- LocalAI container should remain running for inference
- User controls Docker via `docker stop/start` commands
