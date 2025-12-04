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
      return handleBlobReady(message, sender, sendResponse);
    }
    
    if (message.type === 'INGEST_DONE') {
      return handleIngestDone(message, sender, sendResponse);
    }
    
    // Event recording messages
    if (message.type === 'htmlCapture') {
      return handleRecordedEvent(message, sender, sendResponse);
    }

    if (message.type === 'recordedEvent') {
      handleRecordedEvent(message, sender, sendResponse);
      chrome.tabs.sendMessage(
        sender.tab.id, 
        { type: 'HTML_CAPTURE_FROM_EVENT', eventType: message.event.type }, 
        { frameId: 0 }, 
        // This callback is defined but does nothing, simply satisfying the API's contract
        () => {
          if (chrome.runtime.lastError) {
            // Log any errors (like no receiver on the other side)
            console.warn("Capture signal failed to send:", chrome.runtime.lastError.message);
          }
        }
      );
      return false;
    }      
    
    // Task management actions
    if (message.action === 'viewTaskDetails') {
      chrome.tabs.create({
        url: `details.html?taskId=${message.taskId}`
      });
      return true;
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
      return true;
    }
    
    if (message.action === 'deleteTask') {
      chrome.storage.local.get(['taskHistory'], (data) => {
        const taskHistory = data.taskHistory || {};
        
        if (taskHistory[message.taskId]) {
          delete taskHistory[message.taskId];
          
          chrome.storage.local.set({ taskHistory: taskHistory }, function() {
            console.log("Task deleted:", message.taskId);
          });
        }
      });
      return true;
    }
    
    // Keep message port open for async operations
    return true;
  });

  console.log('✅ Message routing initialized');
}

