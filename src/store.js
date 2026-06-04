const useSqlite =
  process.env.STORE_DRIVER === 'sqlite' ||
  (!process.env.DATABASE_URL && process.env.STORE_DRIVER !== 'postgres');

const modulePromise = useSqlite ? import('./db.js') : import('./netlifyDb.js');

const store = await modulePromise;

export const backend = useSqlite ? 'sqlite' : 'postgres';
export const {
  addMessage,
  closeDatabase,
  createConversation,
  getConversation,
  getInferenceLogByRequestId,
  listConversationContext,
  listConversationMessages,
  listMessages,
  saveInferenceLog,
  touchConversation
} = store;
