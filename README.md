# Lightweight LLM Chatbot + Inference Logging

This project is a small full-stack Node.js app that includes:

- A multi-turn chatbot UI
- A lightweight inference wrapper that captures latency and usage metadata
- An ingestion endpoint for near-real-time log collection
- SQLite storage for local development

## Run

1. Copy [.env.local.example](/Users/asif/Desktop/Chatbot/.env.local.example) to `.env`.
2. If you want real model calls locally, set `OPENAI_API_KEY`; otherwise leave it blank and the app uses mock mode.
3. Start the app:

```bash
npm start
```

4. Open `http://localhost:3000`

## Notes

- The app uses an OpenAI-compatible chat completion API by default.
- If you do not set `OPENAI_API_KEY`, you can still use the `mock` provider from the UI for local testing.
- The ingestion endpoint is `POST /ingest` and accepts structured inference log payloads from the SDK wrapper.
- The standalone Node server remains available for local development and binds to `127.0.0.1` by default.
- Local development reads `.env` through `node --env-file=.env server.js`.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the system breakdown.
