import {
  DB_NAME,
  DB_VERSION,
  OBJECT_STORES,
  type AppendStore,
  type ClearableStore,
  type KeyedStore,
  type ObjectStoreName,
  type PersistedStores,
  type SingletonStore,
  createInMemoryStores,
} from './db.ts';

/**
 * The browser-backed implementation of the persistence boundary.
 *
 * IndexedDB can be absent or refused — a private window, blocked site data, a
 * quota error. That is handled by TELLING the caller, never by silently falling
 * back to memory: a person whose collections quietly stop surviving a reload has
 * been lied to about what "saved" means (IMMUNE-U).
 */
export type StoresOutcome =
  | { readonly ok: true; readonly stores: PersistedStores; readonly durable: true }
  | { readonly ok: true; readonly stores: PersistedStores; readonly durable: false; readonly reason: string };

export async function openStores(indexedDB: IDBFactory | undefined = globalThis.indexedDB): Promise<StoresOutcome> {
  if (indexedDB === undefined) {
    return {
      ok: true,
      stores: createInMemoryStores(),
      durable: false,
      reason: 'This browser exposes no IndexedDB, so nothing will survive a reload.',
    };
  }
  let db: IDBDatabase;
  try {
    db = await openDatabase(indexedDB);
  } catch (cause) {
    return {
      ok: true,
      stores: createInMemoryStores(),
      durable: false,
      reason: `IndexedDB could not be opened (${String(cause)}), so nothing will survive a reload.`,
    };
  }
  return { ok: true, stores: buildStores(db), durable: true };
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of OBJECT_STORES) {
        if (!db.objectStoreNames.contains(name)) {
          // activityRecords and commands are append-only logs, so they carry
          // their own generated key rather than a caller-supplied one.
          const autoKey = name === 'activityRecords' || name === 'commands';
          db.createObjectStore(name, autoKey ? { autoIncrement: true } : {});
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('unknown IndexedDB open failure'));
    req.onblocked = () => reject(new Error('another tab is holding an older version of the database open'));
  });
}

/**
 * Resolves on TRANSACTION completion, not request success.
 *
 * Found at Gate C: a request can succeed and its transaction then abort — a
 * storage or commit failure — so resolving on the request reported a durable
 * write for changes that were rolled back. Reporting a save that did not happen
 * is the silent success this codebase is written against (IMMUNE-U).
 */
function tx<T>(db: IDBDatabase, store: ObjectStoreName, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    let result: T | undefined;
    let settled = false;
    const fail = (cause: unknown): void => {
      if (settled) return;
      settled = true;
      reject(cause instanceof Error ? cause : new Error(`IndexedDB ${mode} on ${store} failed: ${String(cause)}`));
    };
    const req = run(t.objectStore(store));
    req.onsuccess = () => {
      result = req.result;
    };
    req.onerror = () => fail(req.error ?? new Error(`IndexedDB ${mode} request on ${store} failed`));
    t.oncomplete = () => {
      if (settled) return;
      settled = true;
      resolve(result as T);
    };
    t.onabort = () => fail(t.error ?? new Error(`IndexedDB transaction on ${store} aborted`));
    t.onerror = () => fail(t.error ?? new Error(`IndexedDB transaction on ${store} failed`));
  });
}

function keyed<T>(db: IDBDatabase, store: ObjectStoreName): KeyedStore<T> {
  return {
    get: (k) => tx<T | undefined>(db, store, 'readonly', (s) => s.get(k) as IDBRequest<T | undefined>),
    put: async (k, v) => void (await tx(db, store, 'readwrite', (s) => s.put(v, k))),
    delete: async (k) => void (await tx(db, store, 'readwrite', (s) => s.delete(k))),
    all: () => tx<T[]>(db, store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>),
  };
}

function append<T>(db: IDBDatabase, store: ObjectStoreName): AppendStore<T> {
  return {
    append: async (v) => void (await tx(db, store, 'readwrite', (s) => s.add(v))),
    all: () => tx<T[]>(db, store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>),
  };
}

function clearable<T>(db: IDBDatabase, store: ObjectStoreName): ClearableStore<T> {
  return {
    ...append<T>(db, store),
    clear: async () => void (await tx(db, store, 'readwrite', (s) => s.clear())),
  };
}

function singleton<T>(db: IDBDatabase, store: ObjectStoreName): SingletonStore<T> {
  const KEY = 'singleton';
  return {
    read: () => tx<T | undefined>(db, store, 'readonly', (s) => s.get(KEY) as IDBRequest<T | undefined>),
    write: async (v) => void (await tx(db, store, 'readwrite', (s) => s.put(v, KEY))),
  };
}

function buildStores(db: IDBDatabase): PersistedStores {
  return {
    videoReferences: keyed(db, 'videoReferences'),
    collections: keyed(db, 'collections'),
    commands: clearable(db, 'commands'),
    activityRecords: append(db, 'activityRecords'),
    quotaState: singleton(db, 'quotaState'),
  };
}
