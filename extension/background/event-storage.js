// Event storage and queue management module
// Handles event persistence and queuing to avoid race conditions

import { videoRecording } from './video-recorder.js';

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
    relative = Math.max(0, Number(eventData.timestamp) - Number(base));
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

// Process HTML capture and event capture storage operations
export function updateEventStorage(captureData, sender, callback) {
  chrome.storage.local.get(['isRecording', 'currentTaskId', 'taskHistory', 'videoStartedAtMs'], (data) => {
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

    const events = taskHistory[taskId].events || [];
    const dataWithRelative = addRelativeRecordingTimestampToEvent(captureData, data.videoStartedAtMs);
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

