const useSqlite =
  process.env.STORE_DRIVER === 'sqlite' ||
  (!process.env.DATABASE_URL && process.env.STORE_DRIVER !== 'postgres');

const backend = useSqlite ? 'sqlite' : 'postgres';

let storePromise;

async function loadStore() {
  if (!storePromise) {
    storePromise = import(useSqlite ? './db.js' : './netlifyDb.js');
  }

  return storePromise;
}

export { backend };
export async function getStore() {
  return loadStore();
}
