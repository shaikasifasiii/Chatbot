import { preview } from './llm.js';

function toSerializableError(error) {
  if (!error) return null;
  return {
    name: error.name ?? 'Error',
    message: error.message ?? String(error)
  };
}

export function createInferenceLogger({
  ingestionUrl = process.env.INGESTION_URL ?? 'http://127.0.0.1:3000/ingest'
} = {}) {
  async function send(payload) {
    const response = await fetch(ingestionUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Ingestion failed (${response.status}): ${body || response.statusText}`);
    }
  }

  return {
    async captureInference({
      requestId,
      conversationId = null,
      sessionId = null,
      provider,
      model,
      messages,
      startedAt,
      finishedAt,
      latencyMs,
      result = null,
      error = null,
      extraMetadata = {}
    }) {
      const inputPreview = messages
        .filter((message) => message.role !== 'system')
        .map((message) => `${message.role}: ${preview(message.content, 120)}`)
        .join(' | ');

      const payload = {
        eventType: 'inference',
        requestId,
        conversationId,
        sessionId,
        provider,
        model,
        status: error ? 'error' : 'success',
        latencyMs,
        startedAt,
        finishedAt,
        inputPreview,
        outputPreview: result?.text ? preview(result.text, 240) : null,
        usage: result?.usage ?? null,
        error: toSerializableError(error),
        metadata: {
          messageCount: messages.length,
          ...extraMetadata
        }
      };

      void send(payload).catch((sendError) => {
        console.error('Failed to send inference log:', sendError);
      });
    }
  };
}
