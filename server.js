import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { getStore } from './src/store.js';
import { buildChatMessages, createProviderClient, DEFAULT_SYSTEM_PROMPT } from './src/llm.js';
import { createInferenceLogger } from './src/inferenceLogger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
const inferenceLogger = createInferenceLogger();

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

async function readJsonBody(req, limitBytes = 1_000_000) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) {
      const error = new Error('Request body too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};
  const body = Buffer.concat(chunks).toString('utf8');
  if (!body.trim()) return {};
  try {
    return JSON.parse(body);
  } catch {
    const error = new Error('Invalid JSON body');
    error.statusCode = 400;
    throw error;
  }
}

function serveStatic(res, filename, contentType) {
  const filePath = path.join(publicDir, filename);
  if (!fs.existsSync(filePath)) {
    sendText(res, 404, 'Not found');
    return;
  }
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    'content-type': contentType,
    'content-length': body.length
  });
  res.end(body);
}

function validateInferencePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return 'Invalid payload.';
  }
  if (payload.eventType !== 'inference') {
    return 'Unsupported eventType.';
  }
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

function bucketLatency(latencyMs) {
  if (latencyMs < 250) return '<250ms';
  if (latencyMs < 1000) return '250-999ms';
  if (latencyMs < 3000) return '1-3s';
  return '3s+';
}

async function handleChat(req, res) {
  const store = await getStore();
  const body = await readJsonBody(req);
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) {
    return sendJson(res, 400, { error: 'message is required' });
  }

  const provider = typeof body.provider === 'string' ? body.provider : 'openai';
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : process.env.OPENAI_MODEL ?? 'gpt-4.1-mini';
  const conversationId = typeof body.conversationId === 'string' && body.conversationId ? body.conversationId : randomUUID();
  const existingConversation = store.getConversation(conversationId);

  if (!existingConversation) {
    store.createConversation({
      id: conversationId,
      title: message.slice(0, 48) || 'New conversation'
    });
  } else {
    store.touchConversation(conversationId);
  }

  const userMessageId = randomUUID();
  const assistantMessageId = randomUUID();
  const requestId = randomUUID();
  const startedAt = new Date().toISOString();
  const start = performance.now();

  store.addMessage({
    id: userMessageId,
    conversationId,
    role: 'user',
    content: message
  });

  const historyRows = store.listConversationContext(conversationId, 12);
  const previousHistory = historyRows.slice(0, Math.max(0, historyRows.length - 1));
  const messages = buildChatMessages({
    userMessage: message,
    history: previousHistory.map((row) => ({
      role: row.role,
      content: row.content
    })),
    systemPrompt: DEFAULT_SYSTEM_PROMPT
  });

  const providerClient = createProviderClient({ provider, model });
  const resolvedProvider = providerClient.provider;

  try {
    const result = await providerClient.generate(messages);
    const output = result.text?.trim() || 'No response returned.';
    const finishedAt = new Date().toISOString();
    const latencyMs = Math.round(performance.now() - start);

    store.addMessage({
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
      provider: resolvedProvider,
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

    return sendJson(res, 200, {
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
      provider: resolvedProvider,
      model,
      messages,
      startedAt,
      finishedAt,
      latencyMs,
      error
    });

    store.addMessage({
      id: assistantMessageId,
      conversationId,
      role: 'assistant',
      content: `Error: ${error.message}`
    });

    return sendJson(res, 500, { error: error.message, conversationId, requestId });
  }
}

async function handleIngest(req, res) {
  const store = await getStore();
  const payload = await readJsonBody(req);
  const validationError = validateInferencePayload(payload);
  if (validationError) {
    return sendJson(res, 400, { error: validationError });
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
    return sendJson(res, 201, { ok: true, id: logRecord.id });
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'OPTIONS' && url.pathname === '/ingest') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type'
      });
      return res.end();
    }

    if (req.method === 'GET' && url.pathname === '/') {
      return serveStatic(res, 'index.html', 'text/html; charset=utf-8');
    }

    if (req.method === 'GET' && url.pathname === '/styles.css') {
      return serveStatic(res, 'styles.css', 'text/css; charset=utf-8');
    }

    if (req.method === 'GET' && url.pathname === '/app.js') {
      return serveStatic(res, 'app.js', 'application/javascript; charset=utf-8');
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/conversations/')) {
      const store = await getStore();
      const conversationId = url.pathname.split('/').at(-1);
      const conversation = store.getConversation(conversationId);
      if (!conversation) {
        return sendJson(res, 404, { error: 'Conversation not found' });
      }

      return sendJson(res, 200, {
        conversation,
        messages: store.listMessages(conversationId, 100)
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/chat') {
      return handleChat(req, res);
    }

    if (req.method === 'POST' && url.pathname === '/ingest') {
      res.setHeader('access-control-allow-origin', '*');
      return handleIngest(req, res);
    }

    return sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    const statusCode = error.statusCode ?? 500;
    return sendJson(res, statusCode, { error: error.message ?? 'Internal server error' });
  }
});

server.on('error', (error) => {
  console.error('Server failed to start:', error);
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`Chatbot running at http://${host}:${port}`);
});

process.on('SIGINT', () => {
  server.close(() => {
    getStore()
      .then((store) => store.closeDatabase?.())
      .finally(() => process.exit(0));
  });
});

process.on('SIGTERM', () => {
  server.close(() => {
    getStore()
      .then((store) => store.closeDatabase?.())
      .finally(() => process.exit(0));
  });
});
