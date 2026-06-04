import { randomUUID } from 'node:crypto';
import { getStore } from './store.js';
import { buildChatMessages, createProviderClient, DEFAULT_SYSTEM_PROMPT } from './llm.js';
import { createInferenceLogger } from './inferenceLogger.js';

function json(statusCode, payload, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...extraHeaders
    },
    body: JSON.stringify(payload)
  };
}

async function readJson(event) {
  if (!event.body) return {};
  if (event.isBase64Encoded) {
    return JSON.parse(Buffer.from(event.body, 'base64').toString('utf8'));
  }
  return JSON.parse(event.body);
}

function validateInferencePayload(payload) {
  if (!payload || typeof payload !== 'object') return 'Invalid payload.';
  if (payload.eventType !== 'inference') return 'Unsupported eventType.';
  if (typeof payload.requestId !== 'string' || !payload.requestId) return 'requestId is required.';
  if (typeof payload.provider !== 'string' || !payload.provider) return 'provider is required.';
  if (typeof payload.model !== 'string' || !payload.model) return 'model is required.';
  if (!['success', 'error'].includes(payload.status)) return 'status must be success or error.';
  if (typeof payload.latencyMs !== 'number' || Number.isNaN(payload.latencyMs)) return 'latencyMs must be a number.';
  if (typeof payload.startedAt !== 'string' || typeof payload.finishedAt !== 'string') {
    return 'startedAt and finishedAt are required.';
  }
  return null;
}

function bucketLatency(latencyMs) {
  if (latencyMs < 250) return '<250ms';
  if (latencyMs < 1000) return '250-999ms';
  if (latencyMs < 3000) return '1-3s';
  return '3s+';
}

function metadataEntriesFromPayload(payload) {
  const metadata = payload.metadata ?? {};
  const entries = [
    { key: 'message_count', value: metadata.messageCount ?? '' },
    { key: 'provider', value: payload.provider },
    { key: 'model', value: payload.model },
    { key: 'status', value: payload.status },
    { key: 'latency_bucket_ms', value: bucketLatency(payload.latencyMs) },
    { key: 'has_error', value: payload.status === 'error' ? 'true' : 'false' }
  ];

  if (payload.usage) {
    for (const [key, value] of Object.entries(payload.usage)) {
      if (value !== null && value !== undefined) {
        entries.push({ key: `usage_${key}`, value });
      }
    }
  }

  for (const [key, value] of Object.entries(metadata)) {
    if (value !== null && value !== undefined && key !== 'messageCount') {
      entries.push({ key: `meta_${key}`, value });
    }
  }

  return entries;
}

function originFromEvent(event) {
  const headers = event.headers ?? {};
  const proto = headers['x-forwarded-proto'] ?? headers['X-Forwarded-Proto'] ?? 'https';
  const host = headers.host ?? headers.Host;
  if (!host) return process.env.URL ?? process.env.DEPLOY_PRIME_URL ?? 'http://127.0.0.1:8888';
  return `${proto}://${host}`;
}

export async function handleHealth() {
  return json(200, { ok: true });
}

export async function handleConversation(event) {
  const store = await getStore();
  const conversationId = event.queryStringParameters?.id;
  if (!conversationId) {
    return json(400, { error: 'Conversation id is required.' });
  }

  const conversation = await store.getConversation(conversationId);
  if (!conversation) {
    return json(404, { error: 'Conversation not found' });
  }

  const messages = await store.listMessages(conversationId, 100);
  return json(200, { conversation, messages });
}

export async function handleIngest(event) {
  const store = await getStore();
  const payload = await readJson(event);
  const validationError = validateInferencePayload(payload);
  if (validationError) {
    return json(400, { error: validationError });
  }

  const logRecord = {
    id: randomUUID(),
    requestId: payload.requestId,
    conversationId: payload.conversationId ?? null,
    sessionId: payload.sessionId ?? null,
    provider: payload.provider,
    model: payload.model,
    status: payload.status,
    latencyMs: payload.latencyMs,
    usage: payload.usage ?? null,
    inputPreview: payload.inputPreview ?? null,
    outputPreview: payload.outputPreview ?? null,
    errorMessage: payload.error?.message ?? null,
    startedAt: payload.startedAt,
    finishedAt: payload.finishedAt
  };

  try {
    await store.saveInferenceLog(logRecord, metadataEntriesFromPayload(payload));
    return json(201, { ok: true, id: logRecord.id });
  } catch (error) {
    return json(500, { error: error.message });
  }
}

export async function handleChat(event) {
  const store = await getStore();
  const body = await readJson(event);
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) {
    return json(400, { error: 'message is required' });
  }

  const provider = typeof body.provider === 'string' ? body.provider : 'openai';
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : process.env.OPENAI_MODEL ?? 'gpt-4.1-mini';
  const conversationId = typeof body.conversationId === 'string' && body.conversationId ? body.conversationId : randomUUID();
  const existingConversation = await store.getConversation(conversationId);

  if (!existingConversation) {
    await store.createConversation({
      id: conversationId,
      title: message.slice(0, 48) || 'New conversation'
    });
  } else {
    await store.touchConversation(conversationId);
  }

  const historyRows = await store.listConversationContext(conversationId, 11);
  const messages = buildChatMessages({
    userMessage: message,
    history: historyRows.map((row) => ({
      role: row.role,
      content: row.content
    })),
    systemPrompt: DEFAULT_SYSTEM_PROMPT
  });

  const userMessageId = randomUUID();
  const assistantMessageId = randomUUID();
  const requestId = randomUUID();
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const ingestionUrl = new URL('/api/ingest', originFromEvent(event)).href;
  const inferenceLogger = createInferenceLogger({ ingestionUrl });
  const providerClient = createProviderClient({ provider, model });

  await store.addMessage({
    id: userMessageId,
    conversationId,
    role: 'user',
    content: message
  });

  try {
    const result = await providerClient.generate(messages);
    const output = result.text?.trim() || 'No response returned.';
    const finishedAt = new Date().toISOString();
    const latencyMs = Math.round(performance.now() - start);

    await store.addMessage({
      id: assistantMessageId,
      conversationId,
      role: 'assistant',
      content: output,
      providerMessageId: null,
      tokenCount: result.usage?.completionTokens ?? null
    });

    void inferenceLogger.captureInference({
      requestId,
      conversationId,
      sessionId: conversationId,
      provider,
      model,
      messages,
      startedAt,
      finishedAt,
      latencyMs,
      result,
      extraMetadata: {
        preview_input: message.slice(0, 240),
        preview_output: output.slice(0, 240)
      }
    });

    return json(200, {
      conversationId,
      requestId,
      assistantMessage: {
        id: assistantMessageId,
        role: 'assistant',
        content: output
      }
    });
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const latencyMs = Math.round(performance.now() - start);

    void inferenceLogger.captureInference({
      requestId,
      conversationId,
      sessionId: conversationId,
      provider,
      model,
      messages,
      startedAt,
      finishedAt,
      latencyMs,
      error
    });

    await store.addMessage({
      id: assistantMessageId,
      conversationId,
      role: 'assistant',
      content: `Error: ${error.message}`
    });

    return json(500, { error: error.message, conversationId, requestId });
  }
}
