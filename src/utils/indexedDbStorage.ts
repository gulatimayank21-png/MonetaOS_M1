/**
 * IndexedDB Storage Layer for MonetaOS SQLite Database Caching
 * 
 * Provides persistent browser-level storage for large SQLite historical database buffers
 * (e.g., Nifty 500 historical price/momentum databases), eliminating repeated downloads
 * and server-side binary mounts.
 */

import { APP_DB_VERSION, STORAGE_VERSION_KEY } from '../constants/database';

const DB_NAME = 'MonetaHistoricalDB';
const STORE_NAME = 'sqlite_store';
const DB_VERSION = 1;
const PRIMARY_KEY = 'nifty500_sqlite_binary';
const MIN_VALID_SIZE_BYTES = 1024 * 1024; // 1 MB

export interface StoredDatabaseRecord {
  id: string;
  buffer: ArrayBuffer;
  version: string;
  updatedAt: number;
  byteLength: number;
}

function getIndexedDBFactory(): IDBFactory | null {
  if (typeof indexedDB !== 'undefined') return indexedDB;
  if (typeof globalThis !== 'undefined' && globalThis.indexedDB) return globalThis.indexedDB;
  if (typeof self !== 'undefined' && self.indexedDB) return self.indexedDB;
  if (typeof window !== 'undefined' && window.indexedDB) return window.indexedDB;
  return null;
}

/**
 * Opens or initializes the MonetaHistoricalDB IndexedDB database.
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const idb = getIndexedDBFactory();
    if (!idb) {
      return reject(new Error('IndexedDB is not supported in this browser/worker environment.'));
    }

    const request = idb.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = (event: Event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event: Event) => {
      const target = event.target as IDBOpenDBRequest;
      reject(target.error || new Error('Failed to open IndexedDB database.'));
    };
  });
}

/**
 * Requests persistent storage from the browser to prevent eviction under storage pressure.
 * Returns true if persistent storage was granted or was already active.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
    try {
      const isPersisted = await navigator.storage.persisted();
      if (isPersisted) {
        return true;
      }
      return await navigator.storage.persist();
    } catch (error) {
      console.warn('Storage persistence request encountered an error:', error);
      return false;
    }
  }
  return false;
}

/**
 * Stores raw SQLite binary buffer and associated version metadata into IndexedDB.
 *
 * @param buffer Raw ArrayBuffer of the SQLite database
 * @param version Version identifier or timestamp string
 */
export async function saveDatabaseBuffer(buffer: ArrayBuffer, version: string): Promise<void> {
  if (!buffer || !(buffer instanceof ArrayBuffer)) {
    throw new Error('Invalid database buffer provided: must be an instance of ArrayBuffer.');
  }

  // Attempt to secure persistent storage asynchronously
  requestPersistentStorage().catch(() => {});

  const db = await openDB();

  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const record: StoredDatabaseRecord = {
        id: PRIMARY_KEY,
        buffer,
        version: version || 'latest',
        updatedAt: Date.now(),
        byteLength: buffer.byteLength,
      };

      const request = store.put(record);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = (event: Event) => {
        const target = event.target as IDBRequest;
        reject(target.error || new Error('Failed to save SQLite database buffer to IndexedDB.'));
      };

      transaction.oncomplete = () => {
        db.close();
      };

      transaction.onerror = (event: Event) => {
        const target = event.target as IDBTransaction;
        reject(target.error || new Error('Transaction error while saving SQLite buffer.'));
      };
    } catch (err) {
      db.close();
      reject(err);
    }
  });
}

/**
 * Retrieves the cached SQLite binary buffer and version metadata from IndexedDB.
 * Returns null if no record exists or if retrieved buffer is empty.
 */
export async function getDatabaseBuffer(): Promise<{ buffer: ArrayBuffer; version: string } | null> {
  try {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      try {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(PRIMARY_KEY);

        request.onsuccess = () => {
          const result = request.result as StoredDatabaseRecord | undefined;
          if (result && result.buffer && result.buffer.byteLength > 0) {
            resolve({
              buffer: result.buffer,
              version: result.version || 'unknown',
            });
          } else {
            resolve(null);
          }
        };

        request.onerror = (event: Event) => {
          const target = event.target as IDBRequest;
          reject(target.error || new Error('Failed to retrieve SQLite database buffer from IndexedDB.'));
        };

        transaction.oncomplete = () => {
          db.close();
        };

        transaction.onerror = (event: Event) => {
          const target = event.target as IDBTransaction;
          reject(target.error || new Error('Transaction error while reading SQLite buffer.'));
        };
      } catch (err) {
        db.close();
        reject(err);
      }
    });
  } catch (err) {
    console.error('Error in getDatabaseBuffer:', err);
    return null;
  }
}

/**
 * Verifies if a valid SQLite database buffer exists in IndexedDB and matches expected version.
 */
export async function hasValidDatabase(expectedVersion: string = APP_DB_VERSION): Promise<boolean> {
  try {
    const data = await getDatabaseBuffer();
    if (!data || !data.buffer) {
      return false;
    }
    if (data.buffer.byteLength < MIN_VALID_SIZE_BYTES) {
      return false;
    }
    if (expectedVersion && data.version !== expectedVersion) {
      return false;
    }
    return true;
  } catch (error) {
    console.warn('Failed to verify existing database in IndexedDB:', error);
    return false;
  }
}

/**
 * Checks localStorage version against the target APP_DB_VERSION.
 */
export function getStoredDbVersion(): string | null {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(STORAGE_VERSION_KEY);
    }
  } catch (_) {}
  return null;
}

/**
 * Updates localStorage version after verified write.
 */
export function setStoredDbVersion(version: string = APP_DB_VERSION): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_VERSION_KEY, version);
    }
  } catch (_) {}
}

/**
 * Clears the SQLite database buffer and stored records from IndexedDB and clears version tag.
 */
export async function clearDatabase(): Promise<void> {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_VERSION_KEY);
    }
  } catch (_) {}

  try {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      try {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(PRIMARY_KEY);

        request.onsuccess = () => {
          resolve();
        };

        request.onerror = (event: Event) => {
          const target = event.target as IDBRequest;
          reject(target.error || new Error('Failed to clear database record from IndexedDB.'));
        };

        transaction.oncomplete = () => {
          db.close();
        };

        transaction.onerror = (event: Event) => {
          const target = event.target as IDBTransaction;
          reject(target.error || new Error('Transaction error while clearing database.'));
        };
      } catch (err) {
        db.close();
        reject(err);
      }
    });
  } catch (err) {
    console.error('Error in clearDatabase:', err);
    throw err;
  }
}
