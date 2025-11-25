// Content script that captures user interactions on the active page (Modular Architecture)
//
// Purpose: Attach configurable DOM and navigation listeners to capture meaningful 
// user interactions (e.g., clicks, inputs, navigations) and send normalized event 
// objects to the background script for persistence.
//
// This is the main entry point that orchestrates all recorder modules:
// - config: Event types, defaults, and configuration loading
// - state: Recording state, navigation tracking, click behavior, error recovery
// - capture: Event recording, navigation handling, HTML snapshots, prebuffering
// - identification: Element selectors (CSS/XPath), BID generation, metadata, a11y
// - browsergym: Script injection and DOM observation for element marking
// - iframe: Iframe detection, instrumentation, and cross-frame event capture
// - listeners: Critical early-attach listeners, DOM and navigation event handling
// - session: Recording session initialization, start/stop lifecycle
// - utils: Helper functions and element utilities

(function() {
  // Prevent re-injection for new recording sessions
  if (window.taskRecorderInitialized) {
    console.log("Recorder script re-injected, skipping");
    return;
  }

  window.taskRecorderInitialized = true;
  console.log("🚀 Task Recorder content script starting...");

  // Import and initialize critical listeners first (must be synchronous)
  import('./recorder/listeners/critical-listeners.js').then(({ preAttachCriticalListeners }) => {
    if (!window.__recorderCriticalAttached) {
      preAttachCriticalListeners();
      window.__recorderCriticalAttached = true;
      console.log('✅ Critical listeners pre-attached');
    } else {
      console.log('ℹ️ Critical listeners already attached (previous injection)');
    }
  });

  // Make recording state accessible for debugging
  import('./recorder/state/recording-state.js').then(({ getRecordingState }) => {
    window.__recorderState = getRecordingState;
  });

  // Setup message listener for start/stop commands from popup/background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("📬 Message received in recorder:", message.action);

    Promise.all([
      import('./recorder/session/lifecycle.js'),
      import('./recorder/state/recording-state.js')
    ]).then(([{ startRecording, stopRecording }, { getRecordingState }]) => {
      const { isRecording, currentTaskId, events } = getRecordingState();
      
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
    }).catch(err => {
      console.error('❌ Error handling message:', err);
      sendResponse({ status: "error", error: err.message });
    });

    return true; // Required for async sendResponse
  });

  // Check if we should resume recording (handles navigation during active recording)
  chrome.storage.local.get(['isRecording', 'currentTaskId', 'taskHistory'], (data) => {
    if (data.isRecording && data.currentTaskId) {
      console.log("🔄 Resuming recording for task:", data.currentTaskId);
      
      // Get existing events for this task
      const existingEvents = (data.taskHistory && data.taskHistory[data.currentTaskId]) 
        ? (data.taskHistory[data.currentTaskId].events || [])
        : [];
      
      // Resume recording session
      import('./recorder/session/initialization.js').then(({ initializeRecordingSession }) => {
        initializeRecordingSession(data.currentTaskId, {
          isResuming: true,
          existingEvents: existingEvents,
          clearCache: false
        });
        console.log('✅ Recording session resumed');
      });
    } else {
      console.log('ℹ️ No active recording to resume');
    }
  });

  console.log('✅ Task Recorder content script ready');
})();
