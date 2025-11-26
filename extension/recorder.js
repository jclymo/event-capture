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

import { preAttachCriticalListeners } from './recorder/listeners/critical-listeners.js';
import { setupMessageListener } from './recorder/session/lifecycle.js';
import { checkAndResumeRecording } from './recorder/session/initialization.js';
import { getRecordingState } from './recorder/state/recording-state.js';

console.log('🚀 Task Recorder content script starting...');

// Prevent re-injection for new recording sessions
if (window.taskRecorderInitialized) {
  console.log("Recorder script re-injected, skipping");
} else {
  window.taskRecorderInitialized = true;

  // Attach critical listeners first (must be synchronous and early)
  if (!window.__recorderCriticalAttached) {
    preAttachCriticalListeners();
    window.__recorderCriticalAttached = true;
    console.log('✅ Critical listeners pre-attached');
  } else {
    console.log('ℹ️ Critical listeners already attached (previous injection)');
  }

  // Make recording state accessible for debugging
  window.__recorderState = getRecordingState;

  // Setup message listener for start/stop commands from popup/background
  setupMessageListener();

  // Check if we should resume recording (handles navigation during active recording)
  checkAndResumeRecording();

  console.log('✅ Task Recorder content script ready');
}
