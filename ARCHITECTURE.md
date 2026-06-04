# Architecture Notes

This app is intentionally small and local-first.

## Runtime

- `server.js` is the only server entrypoint.
- It serves the static UI from `public/`.
- It exposes the HTTP routes used by the browser:
  - `GET /`
  - `GET /api/health`
  - `GET /api/conversations/:id`
  - `POST /api/chat`
  - `POST /ingest`

## Frontend Flow

1. The browser loads `public/index.html`, `public/styles.css`, and `public/app.js`.
2. The app stores the current `conversationId` in `localStorage`.
3. On load, the UI requests conversation history from `GET /api/conversations/:id`.
4. On submit, the UI sends the user message to `POST /api/chat`.
5. The UI updates the message list with the assistant response or error.

## Chat Pipeline

1. The chat route loads the current conversation from SQLite.
2. It creates the conversation if it does not exist.
3. It pulls a short recent history window.
4. It builds the provider prompt with a fixed system message and recent turns.
5. It calls the selected provider wrapper.
6. It stores both the user message and the assistant message.
7. It returns the assistant reply to the browser.

## Logging Pipeline

1. The provider wrapper measures the request.
2. `src/inferenceLogger.js` builds a compact telemetry payload.
3. The logger sends the payload to `POST /ingest` asynchronously.
4. The ingestion route validates the payload.
5. The ingestion route extracts metadata and writes it to SQLite.

## Storage Model

The SQLite schema in `src/db.js` stores four logical entities:

- `conversations`
  - one row per chat session
  - includes title and timestamps
- `messages`
  - all user and assistant messages
  - linked to a conversation
- `inference_logs`
  - one row per model call
  - includes provider, model, latency, token usage, previews, and status
- `inference_metadata`
  - key/value metadata derived from each inference event

## Design Choices

- SQLite keeps the app easy to run locally with no external services.
- The context window stays short so each request stays lightweight.
- Telemetry is sent asynchronously so logging does not block chat responses.
- Previews are stored instead of full payloads to keep logs small.
- The UI keeps state in `localStorage` so refreshes preserve the current conversation.

## Tradeoffs

- This version is local-only and does not include a production deployment path.
- SQLite is simple and fast, but it is best suited for a single-user or local setup.
- If you later want hosted persistence, the storage layer should be abstracted again behind a database adapter.
