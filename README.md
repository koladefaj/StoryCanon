# StoryCanon

A local, privacy-first writing tool for fiction that catches continuity errors — it flags when a new chapter contradicts an established fact and points you at the exact earlier line.

Supermemory's graph normally supersedes an old fact with a new one automatically. StoryCanon intercepts that step so the human author, not the model, decides which version is canon.

## Stack

- **Frontend** — Next.js (App Router) + TypeScript + Tailwind v4 + TipTap. See `frontend/`.
- **Backend** — Python + FastAPI + Supermemory + litellm. See `backend/`.
- **Memory** — [Supermemory](https://supermemory.ai) running locally via Docker (see `docker-compose.yml`).

## Running locally

1. **Supermemory server**
   ```
   docker compose up -d
   ```
   Grab the auto-generated API key from `docker compose logs supermemory` on first boot (`sm_...`), and put it in `backend/.env` (see `supermemory.env.example` for the LLM provider key options).

2. **Frontend**
   ```
   cd frontend
   npm install
   npm run dev
   ```
   Opens at `http://localhost:3000`. Currently running on mock manuscript data.

3. **Backend**
   ```
   cd backend
   uv sync
   uv run fastapi dev
   ```
