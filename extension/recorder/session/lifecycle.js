// Recording lifecycle management (start/stop)

import { 
  resetRecordingState,
  setRecordingState,
  getRecordingState
} from '../state/recording-state.js';
import { recoveryState, resetErrorCount, incrementErrorCount, updateLastSavedTimestamp, shouldAttemptRecovery } from '../state/recovery-state.js';
import { detachDomListeners } from '../listeners/dom-listeners.js';
import { detachNavigationListeners } from '../listeners/navigation-listeners.js';
import { stopBrowserGymObserver } from '../browsergym/observer.js';
import { stopIframeObserver } from '../iframe/observer.js';
import { initializeRecordingSession, getDynamicObserver } from './initialization.js';

export function startRecording(taskId, startAtMs) {
  console.log("🎬 Recording started for task:", taskId);
  const { isRecording } = getRecordingState();
  console.log("🎬 isRecording before:", isRecording);
  
  // Get existing events from storage and initialize session
  chrome.storage.local.get(['taskHistory'], (data) => {
    const taskHistory = data.taskHistory || {};
    const existingEvents = taskHistory[taskId] ? (taskHistory[taskId].events || []) : [];
    
    console.log("🎬 Retrieved existing events:", existingEvents.length);
    
    // Use unified initialization function
    initializeRecordingSession(taskId, {
      isResuming: false,
      existingEvents: existingEvents,
      clearCache: true,  // Clear config cache for new recordings
      startAtMs
    });
    
    const { isRecording: newIsRecording, currentTaskId } = getRecordingState();
    console.log("🎬 isRecording after initialization:", newIsRecording);
    console.log("🎬 currentTaskId:", currentTaskId);
  });
}

export function stopRecording() {
  console.log("Recording stopped");
  setRecordingState(false);

  // Remove event listeners configured for this session
  detachDomListeners();
  detachNavigationListeners();

  // Disconnect observers
  const dynamicObserver = getDynamicObserver();
  if (dynamicObserver) {
    try {
      dynamicObserver.disconnect();
    } catch (e) {
      console.error("Error disconnecting observer:", e);
    }
  }

  // Stop BrowserGym observer
  stopBrowserGymObserver();

  // Stop iframe observer
  stopIframeObserver();
  
  const { events } = getRecordingState();
  // Log recorded events (background script is the source of truth for storage)
  console.log("Recorded events to save (debug only):", events);

  resetRecordingState();
}

export function saveEvents() {
  const { isRecording, currentTaskId, events } = getRecordingState();
  if (!isRecording || !currentTaskId) return;
  
  try {
    chrome.storage.local.get(['taskHistory'], function(data) {
      const taskHistory = data.taskHistory || {};
      
      if (taskHistory[currentTaskId]) {
        taskHistory[currentTaskId].events = events;
        
        // Save the updated task history
        chrome.storage.local.set({ taskHistory: taskHistory }, function() {
          if (chrome.runtime.lastError) {
            console.error("Events failed to save:", chrome.runtime.lastError);
            incrementErrorCount();
            if (shouldAttemptRecovery()) {
              attemptRecovery();
            }
            return;
          }
          updateLastSavedTimestamp();
          resetErrorCount();
        });
      }
    });
  } catch (error) {
    console.error("Error saving events:", error);
    incrementErrorCount();
    
    // Attempt recovery if we've hit too many errors
    if (shouldAttemptRecovery()) {
      attemptRecovery();
    }
  }
}

// Function to attempt recovery from errors
function attemptRecovery() {
  console.log("Attempting recovery from errors...");
  
  const { events, currentTaskId } = getRecordingState();
  // Clear error count
  resetErrorCount();
  
  // Try to save events to localStorage as backup
  try {
    localStorage.setItem('eventCaptureBackup', JSON.stringify({
      events: events,
      timestamp: Date.now(),
      taskId: currentTaskId
    }));
  } catch (e) {
    console.error("Failed to create backup:", e);
  }
  
  // Reinitialize recording
  const { initializeRecording } = require('./initialization.js');
  initializeRecording();
}

// Setup message listener for start/stop commands from popup/background
export function setupMessageListener() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("📬 Message received in recorder:", message.action);

    if (message.action === "startRecording") {
      startRecording(message.taskId, message.startAtMs);
      const newState = getRecordingState();
      sendResponse({
        status: "recording started", 
        isRecording: newState.isRecording, 
        taskId: newState.currentTaskId
      });
    } else if (message.action === "stopRecording") {
      stopRecording();
      const newState = getRecordingState();
      sendResponse({
        status: "recording stopped", 
        eventsCount: newState.events.length
      });
    }

    return true; // Required for async sendResponse
  });
}

