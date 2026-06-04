# Architecture

This repository implements a lightweight chatbot plus inference logging pipeline.

## Runtime Modes

- Local development:
  - `server.js` serves the UI and HTTP routes.
  - `src/db.js` stores data in SQLite.
- Netlify deployment:
  - Static assets are published from `public/`.
  - Netlify Functions handle chat, ingestion, and conversation lookup.
  - `src/netlifyDb.js` talks to Postgres through `DATABASE_URL`.

## Request Flow

1. A user sends a prompt from the browser UI.
2. The chat endpoint loads a short conversation window from storage.
3. The provider adapter builds the model request.
4. The model response is persisted as an assistant message.
5. The logging wrapper asynchronously sends telemetry to `/api/ingest`.
6. The ingestion handler validates the payload and stores normalized logs and metadata.

## Storage Model

- `conversations`
  - one row per chat session
  - stores a human-friendly title and timestamps
- `messages`
  - all user, assistant, system, and tool messages
  - ordered by `created_at`
- `inference_logs`
  - one row per model request
  - includes provider, model, latency, token usage, previews, and status
- `inference_metadata`
  - flexible key/value metadata extracted from the raw log payload

## Design Principles

- Keep the chat request path short and synchronous.
- Send inference telemetry asynchronously so logging failures do not block the response.
- Keep the schema normalized enough for querying, but not over-modeled.
- Support a short context window to keep token usage and latency predictable.
- Use environment-driven backend selection so the same application code works locally and on Netlify.

## Tradeoffs

- SQLite is simpler for local development, but Postgres is required for hosted persistence.
- The logger stores previews instead of full prompts/responses to keep the telemetry lightweight.
- The ingestion API is intentionally permissive on metadata so it can evolve without schema churn.
