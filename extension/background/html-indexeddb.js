// IndexedDB storage for HTML document captures
// Stores HTML content separately from chrome.storage.local to reduce storage pressure
// Documents can be reconstructed during MongoDB sync

const DB_NAME = 'EventCaptureHtmlDB';
const STORE_NAME = 'htmlDocuments';
const DB_VERSION = 1;

let dbPromise = null;
let dbInstance = null;

/**
 * Get or create the IndexedDB database connection
 * @returns {Promise<IDBDatabase>}
 */
function getDB() {
  if (dbPromise) {
    return dbPromise;
  }
  
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => {
      console.error('IndexedDB open error:', request.error);
      dbPromise = null; // Allow retry
      dbInstance = null;
      reject(request.error);
    };
    
    request.onsuccess = () => {
      console.log('📂 IndexedDB connected:', DB_NAME);
      dbInstance = request.result;
      resolve(request.result);
    };
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
        console.log('📂 IndexedDB store created:', STORE_NAME);
      }
    };
  });
  
  return dbPromise;
}

/**
 * Close the IndexedDB connection to free resources
 * Should be called when recording stops
 */
export function closeHtmlDB() {
  if (dbInstance) {
    try {
      dbInstance.close();
      console.log('📂 IndexedDB connection closed');
    } catch (err) {
      console.error('Error closing IndexedDB:', err);
    }
  }
  dbInstance = null;
  dbPromise = null;
}

/**
 * Save HTML content to IndexedDB
 * @param {string} key - Unique key for the document (e.g., "task_abc123_doc_1")
 * @param {string} html - The HTML content to store
 * @returns {Promise<void>}
 */
export async function saveHtmlToIndexedDB(key, html) {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(html, key);
      
      request.onsuccess = () => {
        console.log(`📄 HTML saved to IndexedDB: ${key} (${html.length} chars)`);
        resolve();
      };
      
      request.onerror = () => {
        console.error('IndexedDB put error:', request.error);
        reject(request.error);
      };
    });
  } catch (err) {
    console.error('Failed to save HTML to IndexedDB:', err);
    throw err;
  }
}

/**
 * Read HTML content from IndexedDB
 * @param {string} key - The document key
 * @returns {Promise<string|null>} - The HTML content or null if not found
 */
export async function readHtmlFromIndexedDB(key) {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);
      
      request.onsuccess = () => {
        const html = request.result;
        if (html) {
          console.log(`📄 HTML read from IndexedDB: ${key} (${html.length} chars)`);
        } else {
          console.warn(`📄 HTML not found in IndexedDB: ${key}`);
        }
        resolve(html || null);
      };
      
      request.onerror = () => {
        console.error('IndexedDB get error:', request.error);
        reject(request.error);
      };
    });
  } catch (err) {
    console.error('Failed to read HTML from IndexedDB:', err);
    return null;
  }
}

/**
 * Delete HTML content from IndexedDB
 * @param {string} key - The document key to delete
 * @returns {Promise<void>}
 */
export async function deleteHtmlFromIndexedDB(key) {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(key);
      
      request.onsuccess = () => {
        console.log(`📄 HTML deleted from IndexedDB: ${key}`);
        resolve();
      };
      
      request.onerror = () => {
        console.error('IndexedDB delete error:', request.error);
        reject(request.error);
      };
    });
  } catch (err) {
    console.error('Failed to delete HTML from IndexedDB:', err);
    throw err;
  }
}

/**
 * Delete all HTML documents for a specific task
 * @param {string} taskId - The task ID
 * @returns {Promise<number>} - Number of documents deleted
 */
export async function deleteHtmlDocumentsForTask(taskId) {
  try {
    const db = await getDB();
    const prefix = `task_${taskId}_doc_`;
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.openCursor();
      let deletedCount = 0;
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) {
            cursor.delete();
            deletedCount++;
          }
          cursor.continue();
        } else {
          console.log(`📄 Deleted ${deletedCount} HTML documents for task: ${taskId}`);
          resolve(deletedCount);
        }
      };
      
      request.onerror = () => {
        console.error('IndexedDB cursor error:', request.error);
        reject(request.error);
      };
    });
  } catch (err) {
    console.error('Failed to delete task HTML documents:', err);
    return 0;
  }
}

/**
 * Get all document keys for a specific task
 * @param {string} taskId - The task ID
 * @returns {Promise<string[]>} - Array of document keys
 */
export async function getHtmlDocumentKeysForTask(taskId) {
  try {
    const db = await getDB();
    const prefix = `task_${taskId}_doc_`;
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAllKeys();
      
      request.onsuccess = () => {
        const allKeys = request.result || [];
        const taskKeys = allKeys.filter(key => 
          typeof key === 'string' && key.startsWith(prefix)
        );
        resolve(taskKeys);
      };
      
      request.onerror = () => {
        console.error('IndexedDB getAllKeys error:', request.error);
        reject(request.error);
      };
    });
  } catch (err) {
    console.error('Failed to get task document keys:', err);
    return [];
  }
}

/**
 * Reconstruct HTML content for all htmlCapture events in an events array
 * Used before sending to MongoDB to restore the original format
 * @param {Array} events - Array of events
 * @returns {Promise<Array>} - Events with html property restored for htmlCapture events
 */
export async function reconstructHtmlInEvents(events) {
  if (!Array.isArray(events)) return events;
  
  const reconstructed = await Promise.all(events.map(async (event) => {
    // Only process htmlCapture events that have a documentKey but no html
    if (event.type === 'htmlCapture' && event.documentKey && !event.html) {
      try {
        const html = await readHtmlFromIndexedDB(event.documentKey);
        if (html) {
          // Return event with html restored
          return { ...event, html };
        } else {
          console.warn(`⚠️ Could not reconstruct HTML for ${event.documentKey}`);
          // Return event as-is (with documentPath for reference)
          return event;
        }
      } catch (err) {
        console.error(`Error reconstructing HTML for ${event.documentKey}:`, err);
        return event;
      }
    }
    // Return non-htmlCapture events unchanged
    return event;
  }));
  
  console.log(`📄 Reconstructed HTML for ${reconstructed.filter(e => e.type === 'htmlCapture' && e.html).length} events`);
  return reconstructed;
}

