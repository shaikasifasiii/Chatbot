import { randomUUID } from 'node:crypto';
import { getDatabase } from '@netlify/database';

let database;

function getDb() {
  if (!database) {
    database = getDatabase();
  }
  return database;
}

function rows(result) {
  return Array.isArray(result) ? result : [];
}

async function query(text, values = []) {
  return getDb().pool.query(text, values);
}

export async function getConversation(id) {
  const result = await query('SELECT * FROM conversations WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

export async function createConversation({ id, title = null, createdAt = new Date().toISOString() }) {
  const result = await query(
    `INSERT INTO conversations (id, title, created_at, updated_at)
     VALUES ($1, $2, $3, $3)
     ON CONFLICT (id) DO UPDATE
     SET title = COALESCE(EXCLUDED.title, conversations.title),
         updated_at = EXCLUDED.updated_at
     RETURNING *`,
    [id, title, createdAt]
  );
  return result.rows[0] ?? null;
}

export async function touchConversation(id, title = null) {
  const result = await query(
    `UPDATE conversations
     SET title = COALESCE($2, title),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, title]
  );
  return result.rows[0] ?? null;
}

export async function addMessage({
  id = randomUUID(),
  conversationId,
  role,
  content,
  providerMessageId = null,
  tokenCount = null,
  createdAt = new Date().toISOString()
}) {
  const result = await query(
    `INSERT INTO messages
       (id, conversation_id, role, content, provider_message_id, token_count, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [id, conversationId, role, content, providerMessageId, tokenCount, createdAt]
  );
  return result.rows[0] ?? null;
}

export async function listMessages(conversationId, limit = 50) {
  const result = await query(
    `SELECT * FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC, id ASC
     LIMIT $2`,
    [conversationId, limit]
  );
  return rows(result.rows);
}

export async function listConversationContext(conversationId, limit = 12) {
  return listMessages(conversationId, limit);
}

export async function saveInferenceLog(logRecord, metadataEntries = []) {
  const client = await getDb().pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO inference_logs (
         id, request_id, conversation_id, session_id, provider, model, status, latency_ms,
         prompt_tokens, completion_tokens, total_tokens, input_preview, output_preview,
         error_message, started_at, finished_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8,
         $9, $10, $11, $12, $13, $14, $15, $16
       )`,
      [
        logRecord.id,
        logRecord.requestId,
        logRecord.conversationId ?? null,
        logRecord.sessionId ?? null,
        logRecord.provider,
        logRecord.model,
        logRecord.status,
        logRecord.latencyMs,
        logRecord.usage?.promptTokens ?? null,
        logRecord.usage?.completionTokens ?? null,
        logRecord.usage?.totalTokens ?? null,
        logRecord.inputPreview ?? null,
        logRecord.outputPreview ?? null,
        logRecord.errorMessage ?? null,
        logRecord.startedAt,
        logRecord.finishedAt
      ]
    );

    for (const entry of metadataEntries) {
      await client.query(
        'INSERT INTO inference_metadata (log_id, key, value) VALUES ($1, $2, $3)',
        [logRecord.id, entry.key, String(entry.value)]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getInferenceLogByRequestId(requestId) {
  const result = await query('SELECT * FROM inference_logs WHERE request_id = $1', [requestId]);
  return result.rows[0] ?? null;
}
