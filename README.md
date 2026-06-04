# Lightweight LLM Chatbot + Inference Logging

This project is a small full-stack Node.js app that includes:

- A multi-turn chatbot UI
- A lightweight inference wrapper that captures latency and usage metadata
- An ingestion endpoint for near-real-time log collection
- SQLite storage for local development
- Netlify Functions + Netlify Database for production deployment

## Run

1. Copy `.env.example` to `.env` and set `OPENAI_API_KEY`.
2. Start the app:

```bash
npm start
```

3. Open `http://localhost:3000`

## Netlify deployment

1. Create a Netlify site from this repository.
2. Add Netlify Database to the site. Netlify will provision the database connection and apply migrations from `netlify/database/migrations`.
3. Set `OPENAI_API_KEY` and any provider settings in Netlify environment variables.
4. Deploy. The UI is served from `public/` and the API routes are rewritten to Netlify Functions via `netlify.toml`.

## Notes

- The app uses an OpenAI-compatible chat completion API by default.
- If you do not set `OPENAI_API_KEY`, you can still use the `mock` provider from the UI for local testing.
- The ingestion endpoint is `POST /ingest` and accepts structured inference log payloads from the SDK wrapper.
- The standalone Node server remains available for local development and binds to `127.0.0.1` by default.

## Schema

- `conversations`: one row per session.
- `messages`: chat messages for each conversation.
- `inference_logs`: normalized request/response log records.
- `inference_metadata`: extracted metadata as key/value pairs.
