// vehicleAnalyticsDB.ts
// IndexedDB wrapper for Vehicle Analytics data persistence

const DB_NAME = 'VehicleAnalyticsDB';
const DB_VERSION = 1;

// Store names
export const STORES = {
  SESSIONS: 'upload_sessions',
  PETRO: 'petro_app_data',
  GPS_MOVEMENTS: 'gps_movements',
  GPS_ODOMETER: 'gps_odometer',
  GPS_ENGINE_ON: 'gps_engine_on',
  GPS_ENGINE_OFF: 'gps_engine_off',
  HT_TRIPS: 'ht_trips',
  HT_KMS: 'ht_kms',
} as const;

export interface UploadSession {
  id?: number;
  source: 'petro_app' | 'location_solution' | 'ht_trips';
  uploadDate: string;
  periodStart: string;
  periodEnd: string;
  recordCount: number;
  fileName: string;
  fileHash: string;
}

// Open database
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Upload sessions
      if (!db.objectStoreNames.contains(STORES.SESSIONS)) {
        const store = db.createObjectStore(STORES.SESSIONS, { keyPath: 'id', autoIncrement: true });
        store.createIndex('source', 'source');
        store.createIndex('fileHash', 'fileHash');
      }

      // Petro App data
      if (!db.objectStoreNames.contains(STORES.PETRO)) {
        const store = db.createObjectStore(STORES.PETRO, { keyPath: 'id', autoIncrement: true });
        store.createIndex('sessionId', 'sessionId');
        store.createIndex('vehicleId', 'vehicleId');
      }

      // GPS Movements
      if (!db.objectStoreNames.contains(STORES.GPS_MOVEMENTS)) {
        const store = db.createObjectStore(STORES.GPS_MOVEMENTS, { keyPath: 'id', autoIncrement: true });
        store.createIndex('sessionId', 'sessionId');
        store.createIndex('vehicleId', 'vehicleId');
      }

      // GPS Odometer
      if (!db.objectStoreNames.contains(STORES.GPS_ODOMETER)) {
        const store = db.createObjectStore(STORES.GPS_ODOMETER, { keyPath: 'id', autoIncrement: true });
        store.createIndex('sessionId', 'sessionId');
        store.createIndex('vehicleId', 'vehicleId');
      }

      // GPS Engine ON
      if (!db.objectStoreNames.contains(STORES.GPS_ENGINE_ON)) {
        const store = db.createObjectStore(STORES.GPS_ENGINE_ON, { keyPath: 'id', autoIncrement: true });
        store.createIndex('vehicleId', 'vehicleId');
      }

      // GPS Engine OFF
      if (!db.objectStoreNames.contains(STORES.GPS_ENGINE_OFF)) {
        const store = db.createObjectStore(STORES.GPS_ENGINE_OFF, { keyPath: 'id', autoIncrement: true });
        store.createIndex('vehicleId', 'vehicleId');
      }

      // HT Trips
      if (!db.objectStoreNames.contains(STORES.HT_TRIPS)) {
        const store = db.createObjectStore(STORES.HT_TRIPS, { keyPath: 'id', autoIncrement: true });
        store.createIndex('sessionId', 'sessionId');
        store.createIndex('vehicleId', 'vehicleId');
        store.createIndex('month', 'month');
      }

      // HT KMs records
      if (!db.objectStoreNames.contains(STORES.HT_KMS)) {
        const store = db.createObjectStore(STORES.HT_KMS, { keyPath: 'id', autoIncrement: true });
        store.createIndex('vehicleId', 'vehicleId');
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Generic helpers
async function getAll<T>(storeName: string): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => { db.close(); resolve(req.result); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

async function getAllByIndex<T>(storeName: string, indexName: string, value: IDBValidKey): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const index = store.index(indexName);
    const req = index.getAll(value);
    req.onsuccess = () => { db.close(); resolve(req.result); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

async function addMany<T>(storeName: string, items: T[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    for (const item of items) store.add(item);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function clearStore(storeName: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.clear();
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function countStore(storeName: string): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.count();
    req.onsuccess = () => { db.close(); resolve(req.result); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

// Vehicle ID normalization
function extractVehicleId(source: string, rawValue: string): string {
  const val = String(rawValue || '').trim();
  if (source === 'ht_trips') return val;
  if (source === 'gps_grouping') return val.split(/\s+/)[0];
  if (source === 'petro_app') {
    const noSpaces = val.replace(/\s+/g, '');
    const match = noSpaces.match(/(\d{3,4})$/);
    return match ? match[1] : noSpaces;
  }
  return val;
}

// File hash (simple)
async function computeHash(content: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', content);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

// Check for duplicates
async function isDuplicate(source: string, hash: string): Promise<boolean> {
  const sessions = await getAll<UploadSession>(STORES.SESSIONS);
  return sessions.some(s => s.source === source && s.fileHash === hash);
}

// Public API
export const vehicleDB = {
  STORES,
  openDB,
  getAll,
  getAllByIndex,
  addMany,
  clearStore,
  countStore,
  extractVehicleId,
  computeHash,
  isDuplicate,

  // Session management
  async addSession(session: Omit<UploadSession, 'id'>): Promise<number> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.SESSIONS, 'readwrite');
      const store = tx.objectStore(STORES.SESSIONS);
      const req = store.add(session);
      req.onsuccess = () => { db.close(); resolve(req.result as number); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  },

  async getSessions(source?: string): Promise<UploadSession[]> {
    if (source) return getAllByIndex<UploadSession>(STORES.SESSIONS, 'source', source);
    return getAll<UploadSession>(STORES.SESSIONS);
  },

  // Get summary stats
  async getStoreSummary() {
    const [petroCount, gpsMovCount, gpsOdoCount, htTripsCount, htKmsCount, sessions] = await Promise.all([
      countStore(STORES.PETRO),
      countStore(STORES.GPS_MOVEMENTS),
      countStore(STORES.GPS_ODOMETER),
      countStore(STORES.HT_TRIPS),
      countStore(STORES.HT_KMS),
      getAll<UploadSession>(STORES.SESSIONS),
    ]);
    return { petroCount, gpsMovCount, gpsOdoCount, htTripsCount, htKmsCount, sessions };
  },

  // Clear all data for a source
  async clearSource(source: 'petro_app' | 'location_solution' | 'ht_trips') {
    const storeMap: Record<string, string[]> = {
      petro_app: [STORES.PETRO],
      location_solution: [STORES.GPS_MOVEMENTS, STORES.GPS_ODOMETER, STORES.GPS_ENGINE_ON, STORES.GPS_ENGINE_OFF],
      ht_trips: [STORES.HT_TRIPS, STORES.HT_KMS],
    };
    for (const store of storeMap[source] || []) {
      await clearStore(store);
    }
    // Remove sessions for this source
    const db = await openDB();
    const tx = db.transaction(STORES.SESSIONS, 'readwrite');
    const sessionStore = tx.objectStore(STORES.SESSIONS);
    const index = sessionStore.index('source');
    const req = index.openCursor(source);
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) { cursor.delete(); cursor.continue(); }
    };
    return new Promise<void>((resolve) => { tx.oncomplete = () => { db.close(); resolve(); }; });
  },

  // Clear everything
  async clearAll() {
    for (const storeName of Object.values(STORES)) {
      await clearStore(storeName);
    }
  },
};

export type { UploadSession };
export default vehicleDB;
