// Central message routing for background service worker
// Coordinates message handling between different modules

import {
  handleVideoStart,
  handleVideoStop,
  handleOffscreenStarted,
  handleOffscreenStopped,
  handleBlobReady,
  handleIngestDone
} from './video-recorder.js';

import { handleRecordedEvent } from './event-storage.js';
import { deleteHtmlDocumentsForTask, reconstructHtmlInEvents, closeHtmlDB } from './html-indexeddb.js';

// Setup all message handlers
export function setupMessageHandlers() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Video recording messages
    if (message.type === 'POPUP_START_VIDEO') {
      return handleVideoStart(message, sender, sendResponse);
    }
    
    if (message.type === 'POPUP_STOP_VIDEO') {
      return handleVideoStop(message, sender, sendResponse);
    }
    
    if (message.type === 'OFFSCREEN_STARTED') {
      return handleOffscreenStarted(message, sender, sendResponse);
    }
    
    if (message.type === 'OFFSCREEN_STOPPED') {
      return handleOffscreenStopped(message, sender, sendResponse);
    }
    
    if (message.type === 'OFFSCREEN_BLOB_READY') {
      // After blob is processed, close the HTML IndexedDB connection
      const result = handleBlobReady(message, sender, (response) => {
        // Close DB after blob processing completes
        setTimeout(() => {
          closeHtmlDB();
          console.log('📂 HTML DB closed after recording finalized');
        }, 1000); // Small delay to ensure trace.json is written
        sendResponse?.(response);
      });
      return result;
    }
    
    if (message.type === 'INGEST_DONE') {
      return handleIngestDone(message, sender, sendResponse);
    }
    
    // HTML reconstruction for popup/details/history pages
    if (message.type === 'RECONSTRUCT_HTML_EVENTS') {
      (async () => {
        try {
          const events = message.events || [];
          const reconstructedEvents = await reconstructHtmlInEvents(events);
          sendResponse({ success: true, events: reconstructedEvents });
        } catch (err) {
          console.error('Error reconstructing HTML events:', err);
          sendResponse({ success: false, error: err.message, events: message.events });
        }
      })();
      return true; // Keep channel open for async response
    }
    
    // Event recording messages - these DON'T need responses
    if (message.type === 'recordedEvent' || message.type === 'htmlCapture') {
      handleRecordedEvent(message, sender, sendResponse);
      return false; // No async response needed
    }
    
    // Task management actions
    if (message.action === 'viewTaskDetails') {
      chrome.tabs.create({
        url: `details.html?taskId=${message.taskId}`
      });
      return false; // No response needed
    }
    
    if (message.action === 'exportTask') {
      chrome.storage.local.get(['taskHistory'], (data) => {
        const taskHistory = data.taskHistory || {};
        const task = taskHistory[message.taskId];
        
        if (task) {
          const taskData = JSON.stringify(task, null, 2);
          const blob = new Blob([taskData], {type: 'application/json'});
          const url = URL.createObjectURL(blob);
          
          chrome.downloads.download({
            url: url,
            filename: `task_${message.taskId}.json`,
            saveAs: true
          });
        }
      });
      return false; // No response needed
    }
    
    if (message.action === 'deleteTask') {
      const taskIdToDelete = message.taskId;
      
      // Clean up HTML documents from IndexedDB first
      deleteHtmlDocumentsForTask(taskIdToDelete).catch(err => {
        console.error('Failed to clean up HTML documents from IndexedDB:', err);
      });
      
      // Then delete from task history
      chrome.storage.local.get(['taskHistory'], (data) => {
        const taskHistory = data.taskHistory || {};
        
        if (taskHistory[taskIdToDelete]) {
          delete taskHistory[taskIdToDelete];
          
          chrome.storage.local.set({ taskHistory: taskHistory }, function() {
            console.log("Task deleted:", taskIdToDelete);
          });
        }
      });
      return false; // No response needed
    }
    
    // Default: no async response
    return false;
  });

  console.log('✅ Message routing initialized');
}

