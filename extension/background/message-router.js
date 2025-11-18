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
import { handleBrowserGymInjection } from './browsergym-injector.js';

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
    if (message.type === 'recordedEvent' || message.type === 'htmlCapture') {
      return handleRecordedEvent(message, sender, sendResponse);
    }
    
    // BrowserGym injection
    if (message.action === 'injectBrowserGymScript') {
      return handleBrowserGymInjection(message, sender, sendResponse);
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

