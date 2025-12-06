// Event storage and queue management module
// Handles event persistence and queuing to avoid race conditions

import { videoRecording } from './video-recorder.js';
import { saveHtmlToIndexedDB } from './html-indexeddb.js';

// Debug state for recording
export const recordingDebug = {
  totalEventsStored: 0,
  lastEventSummary: null,
  lastStoreError: null
};

// Expose debug info globally for inspection
globalThis.recordingDebug = recordingDebug;

// Queue for events that need to be committed to task history
// Trying to avoid race conditions
export const eventQueue = {
  queue: [],
  processing: false,
  
  enqueue: function(operation) {
    this.queue.push(operation);
    if (!this.processing) {
      this.processNext();
    }
  },
  
  processNext: function() {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }
    
    this.processing = true;
    const nextOperation = this.queue.shift();
    
    try {
      nextOperation(this.onOperationComplete.bind(this));
    } catch (error) {
      console.error('Queue operation error:', error);
      this.onOperationComplete();
    }
  },
  
  onOperationComplete: function() {
    this.processNext();
  }
};

// Add relative recording timestamp to event based on video start time
export function addRelativeRecordingTimestampToEvent(eventData, fallbackBase = null) {
  let relative = null;
  const base = videoRecording.startedAtMs || fallbackBase;
  if (base != null && eventData?.timestamp != null) {
    let ts = eventData.timestamp;
    // Support both numeric and ISO string timestamps
    if (typeof ts === 'string') {
      const parsed = Date.parse(ts);
      if (!Number.isNaN(parsed)) {
        ts = parsed;
      }
    }
    const tsNum = Number(ts);
    if (Number.isFinite(tsNum)) {
      relative = Math.max(0, tsNum - Number(base));
    }
  }

  if (relative == null) {
    return eventData;
  }

  return {
    ...eventData,
    videoTimeMs: relative,
    video_timestamp: relative,
    video_event_start_ms: relative,
    video_event_end_ms: relative
  };
}

/**
 * Get the next document number for a task by counting existing htmlCapture events
 * This is robust against service worker restarts
 * @param {Array} events - The existing events array for this task
 * @returns {number} - The next document number (1-indexed)
 */
function getNextDocumentNumber(events) {
  if (!Array.isArray(events)) return 1;
  
  // Count existing htmlCapture events to determine next document number
  const htmlCaptureCount = events.filter(e => e.type === 'htmlCapture').length;
  return htmlCaptureCount + 1;
}

/**
 * Save HTML content to file in Downloads folder
 * @param {string} baseIso - ISO timestamp for folder
 * @param {number} docNumber - Document number
 * @param {string} html - HTML content
 * @returns {Promise<string>} - The relative path
 */
async function saveHtmlToFile(baseIso, docNumber, html) {
  return new Promise((resolve) => {
    try {
      const htmlBlob = new Blob([html], { type: 'text/html' });
      const reader = new FileReader();
      
      reader.onloadend = () => {
        const dataUrl = reader.result;
        const relativePath = `event-capture-archives/${baseIso}/documents/document_${docNumber}.html`;
        
        chrome.downloads.download({
          url: dataUrl,
          filename: relativePath,
          saveAs: false,
          conflictAction: 'overwrite'
        }, (downloadId) => {
          if (chrome.runtime.lastError) {
            console.error('HTML document save failed:', chrome.runtime.lastError);
            // Still resolve with the path - file might save on retry
          } else {
            console.log(`📄 HTML document saved: ${relativePath}`);
          }
          resolve(relativePath);
        });
      };
      
      reader.onerror = () => {
        console.error('FileReader error for HTML document');
        const relativePath = `event-capture-archives/${baseIso}/documents/document_${docNumber}.html`;
        resolve(relativePath);
      };
      
      reader.readAsDataURL(htmlBlob);
    } catch (err) {
      console.error('Error saving HTML to file:', err);
      const relativePath = `event-capture-archives/${baseIso}/documents/document_${docNumber}.html`;
      resolve(relativePath);
    }
  });
}

// Process HTML capture and event capture storage operations
export function updateEventStorage(captureData, sender, callback) {
  chrome.storage.local.get(['isRecording', 'currentTaskId', 'taskHistory', 'videoStartedAtMs'], async (data) => {
    // CRITICAL: Wrap entire async body in try/catch to ensure callback is always called
    // If callback is not called, the event queue will hang indefinitely
    try {
      if (!data.isRecording || !data.currentTaskId || !data.taskHistory) {
        recordingDebug.lastStoreError = 'Not recording or missing task history';
        callback();
        return;
      }
      
      const taskHistory = data.taskHistory;
      const taskId = data.currentTaskId;
      
      // Initialize task if needed
      if (!taskHistory[taskId]) {
        taskHistory[taskId] = { events: [] };
      }

      let eventToStore = captureData;

      const events = taskHistory[taskId].events || [];

      // Special handling for htmlCapture events - save HTML to IndexedDB + file
      if (captureData.type === 'htmlCapture' && captureData.html) {
        const docNumber = getNextDocumentNumber(events);
        const documentKey = `task_${taskId}_doc_${docNumber}`;
        
        // Get base ISO for file path (same as video folder)
        const baseIso = data.videoStartedAtMs 
          ? new Date(data.videoStartedAtMs).toISOString().replace(/[:.]/g, '-')
          : new Date().toISOString().replace(/[:.]/g, '-');
        
        try {
          // Save to IndexedDB (for reconstruction during sync)
          await saveHtmlToIndexedDB(documentKey, captureData.html);
          
          // Save to file (for human access)
          const documentPath = await saveHtmlToFile(baseIso, docNumber, captureData.html);
          
          // Create event without html content, but with references
          eventToStore = {
            ...captureData,
            documentKey,        // For IndexedDB lookup during sync
            documentPath,       // Relative path to file in Downloads
            documentNumber: docNumber,
            htmlLength: captureData.html.length  // Track original size
          };
          
          // Remove the large html property - we have it in IndexedDB and file
          delete eventToStore.html;
          
          console.log(`📄 HTML capture stored: ${documentKey} (${captureData.html.length} chars)`);
        } catch (err) {
          console.error('Error storing HTML capture:', err);
          // Fall back to storing inline if IndexedDB fails
          // (this maintains backward compatibility)
          eventToStore = captureData;
        }
      }

      const dataWithRelative = addRelativeRecordingTimestampToEvent(eventToStore, data.videoStartedAtMs);
      events.push(dataWithRelative);
      taskHistory[taskId].events = events;
      recordingDebug.totalEventsStored += 1;
      recordingDebug.lastEventSummary = {
        type: dataWithRelative.type,
        url: dataWithRelative.url,
        isInIframe: !!dataWithRelative.isInIframe,
        timestamp: Date.now()
      };
      recordingDebug.lastStoreError = null;
    
      // Save to storage
      chrome.storage.local.set({ taskHistory: taskHistory }, callback);
    } catch (err) {
      // CRITICAL: Ensure callback is always called to prevent queue hang
      console.error('Critical error in updateEventStorage:', err);
      recordingDebug.lastStoreError = String(err);
      callback();
    }
  });
}

// Handle recorded events from recorder.js
export function handleRecordedEvent(message, sender, sendResponse) {
  if ((message.type === 'recordedEvent') || (message.type === 'htmlCapture')) {
    eventQueue.enqueue((done) => {
      updateEventStorage(message.event, sender, done);
    });
    return false; // No response is sent back to recorder.js
  }
  return false;
}
