import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dataDir = path.resolve(process.env.DATA_DIR ?? path.dirname(process.env.DATABASE_PATH ?? './data/chatbot.sqlite'));
fs.mkdirSync(dataDir, { recursive: true });

const databasePath = path.resolve(process.env.DATABASE_PATH ?? path.join(dataDir, 'chatbot.sqlite'));
const db = new DatabaseSync(databasePath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('system', 'user', 'assistant', 'tool')),
    content TEXT NOT NULL,
    provider_message_id TEXT,
    token_count INTEGER,
    created_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS inference_logs (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    conversation_id TEXT,
    session_id TEXT,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('success', 'error')),
    latency_ms INTEGER NOT NULL,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,
    input_preview TEXT,
    output_preview TEXT,
    error_message TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS inference_metadata (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    log_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    FOREIGN KEY (log_id) REFERENCES inference_logs(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
    ON messages (conversation_id, created_at ASC);

  CREATE INDEX IF NOT EXISTS idx_inference_logs_conversation_created
    ON inference_logs (conversation_id, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_inference_metadata_log_id
    ON inference_metadata (log_id);
`);

const statements = {
  insertConversation: db.prepare(`
    INSERT INTO conversations (id, title, created_at, updated_at)
    VALUES ($id, $title, $created_at, $updated_at)
  `),
  updateConversationTouch: db.prepare(`
    UPDATE conversations
    SET title = COALESCE($title, title), updated_at = $updated_at
    WHERE id = $id
  `),
  selectConversation: db.prepare(`
    SELECT * FROM conversations WHERE id = ?
  `),
  listMessages: db.prepare(`
    SELECT * FROM messages
    WHERE conversation_id = ?
    ORDER BY created_at ASC, rowid ASC
    LIMIT ?
  `),
  insertMessage: db.prepare(`
    INSERT INTO messages (
      id, conversation_id, role, content, provider_message_id, token_count, created_at
    ) VALUES (
      $id, $conversation_id, $role, $content, $provider_message_id, $token_count, $created_at
    )
  `),
  insertInferenceLog: db.prepare(`
    INSERT INTO inference_logs (
      id, request_id, conversation_id, session_id, provider, model, status, latency_ms,
      prompt_tokens, completion_tokens, total_tokens, input_preview, output_preview,
      error_message, started_at, finished_at
    ) VALUES (
      $id, $request_id, $conversation_id, $session_id, $provider, $model, $status, $latency_ms,
      $prompt_tokens, $completion_tokens, $total_tokens, $input_preview, $output_preview,
      $error_message, $started_at, $finished_at
    )
  `),
  insertInferenceMetadata: db.prepare(`
    INSERT INTO inference_metadata (log_id, key, value)
    VALUES ($log_id, $key, $value)
  `),
  getConversationForExport: db.prepare(`
    SELECT * FROM conversations WHERE id = ?
  `),
  getInferenceLogByRequestId: db.prepare(`
    SELECT * FROM inference_logs WHERE request_id = ?
  `)
};

export function createConversation({ id, title = null, createdAt = new Date().toISOString() }) {
  statements.insertConversation.run({
    id,
    title,
    created_at: createdAt,
    updated_at: createdAt
  });
  return getConversation(id);
}

export function getConversation(id) {
  return statements.selectConversation.get(id) ?? null;
}

export function touchConversation(id, title = null) {
  statements.updateConversationTouch.run({
    id,
    title,
    updated_at: new Date().toISOString()
  });
}

export function addMessage({
  id,
  conversationId,
  role,
  content,
  providerMessageId = null,
  tokenCount = null,
  createdAt = new Date().toISOString()
}) {
  statements.insertMessage.run({
    id,
    conversation_id: conversationId,
    role,
    content,
    provider_message_id: providerMessageId,
    token_count: tokenCount,
    created_at: createdAt
  });
}

export function listMessages(conversationId, limit = 50) {
  return statements.listMessages.all(conversationId, limit);
}

export function listConversationContext(conversationId, limit = 12) {
  return statements.listMessages.all(conversationId, limit);
}

export function saveInferenceLog(logRecord, metadataEntries = []) {
  db.exec('BEGIN');
  try {
    statements.insertInferenceLog.run({
      id: logRecord.id,
      request_id: logRecord.requestId,
      conversation_id: logRecord.conversationId ?? null,
      session_id: logRecord.sessionId ?? null,
      provider: logRecord.provider,
      model: logRecord.model,
      status: logRecord.status,
      latency_ms: logRecord.latencyMs,
      prompt_tokens: logRecord.usage?.promptTokens ?? null,
      completion_tokens: logRecord.usage?.completionTokens ?? null,
      total_tokens: logRecord.usage?.totalTokens ?? null,
      input_preview: logRecord.inputPreview ?? null,
      output_preview: logRecord.outputPreview ?? null,
      error_message: logRecord.errorMessage ?? null,
      started_at: logRecord.startedAt,
      finished_at: logRecord.finishedAt
    });

    for (const entry of metadataEntries) {
      statements.insertInferenceMetadata.run({
        log_id: logRecord.id,
        key: entry.key,
        value: String(entry.value)
      });
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function getInferenceLogByRequestId(requestId) {
  return statements.getInferenceLogByRequestId.get(requestId) ?? null;
}

export function listConversationMessages(conversationId, limit = 12) {
  return statements.listMessages.all(conversationId, limit);
}

export function closeDatabase() {
  db.close();
}
