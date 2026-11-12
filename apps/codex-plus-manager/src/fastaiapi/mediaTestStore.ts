export type MediaTestEntry = {
  id: string;
  createdAt: number;
  model: string;
  status: string;
  image?: string;
  workspace?: string;
};

const pageSize = 5;
let database: Promise<IDBDatabase> | undefined;

function historyDatabase() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("fastaiapi-media-tests", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("tests", {keyPath: ["scope", "id"]})
        .createIndex("by-date", ["scope", "createdAt"]);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(error => {
    database = undefined;
    throw error;
  });
  return database;
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function saveMediaTest(scope: string, entry: MediaTestEntry) {
  const db = await historyDatabase();
  const tx = db.transaction("tests", "readwrite");
  tx.objectStore("tests").put({...entry, scope});
  await transactionDone(tx);
}

function scopeRange(scope: string) {
  return IDBKeyRange.bound([scope, 0], [scope, Number.MAX_SAFE_INTEGER]);
}

export async function mediaTestPage(scope: string, page: number) {
  const db = await historyDatabase();
  const tx = db.transaction("tests", "readonly");
  const index = tx.objectStore("tests").index("by-date");
  const range = scopeRange(scope);
  const count = index.count(range);
  const cursor = index.openCursor(range, "prev");
  const entries: MediaTestEntry[] = [];
  let offset = page * pageSize;
  cursor.onsuccess = () => {
    const item = cursor.result;
    if (!item) return;
    if (offset) {
      item.advance(offset);
      offset = 0;
      return;
    }
    entries.push(item.value);
    if (entries.length < pageSize) item.continue();
  };
  await transactionDone(tx);
  return {entries, pages: Math.max(1, Math.ceil(count.result / pageSize)), total: count.result};
}

export async function clearMediaTests(scope: string) {
  const db = await historyDatabase();
  const tx = db.transaction("tests", "readwrite");
  const cursor = tx.objectStore("tests").index("by-date").openCursor(scopeRange(scope));
  cursor.onsuccess = () => {
    const item = cursor.result;
    if (!item) return;
    item.delete();
    item.continue();
  };
  await transactionDone(tx);
}
