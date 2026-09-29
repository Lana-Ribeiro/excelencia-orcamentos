// Armazenamento chave/valor no IndexedDB do navegador (versão online).

const DB_NAME = "excelencia";
const STORE = "kv";
let dbPromise: Promise<IDBDatabase> | null = null;

function open() {
  if (!dbPromise)
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB indisponível"));
    });
  return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error ?? new Error("Falha ao gravar no navegador"));
    tx.onabort = () => reject(tx.error ?? new Error("Gravação cancelada (espaço insuficiente?)"));
  });
}

export const idb = {
  get: <T>(key: string) => run<T | undefined>("readonly", (s) => s.get(key) as IDBRequest<T | undefined>),
  set: (key: string, value: unknown) => run("readwrite", (s) => s.put(value, key)),
  del: (key: string) => run("readwrite", (s) => s.delete(key)),
  async values<T>(prefix: string): Promise<T[]> {
    return run<T[]>("readonly", (s) => s.getAll(IDBKeyRange.bound(prefix, prefix + "￿")) as IDBRequest<T[]>);
  },
};
