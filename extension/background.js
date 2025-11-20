// Background service worker for the Chrome extension (Modular Architecture)
//
// Purpose: Coordinate recording across tabs, inject the content script after
// navigations, and persist events sent by the recorder into chrome.storage.
//
// This is the main entry point that initializes all background modules:
// - video-recorder: Screen recording and video upload
// - event-storage: Event persistence and queue management
// - tab-manager: Tab lifecycle and recorder injection
// - message-router: Central message handling
// - browsergym-injector: BrowserGym DOM marking script injection

import { setupMessageHandlers } from './background/message-router.js';
import { setupTabListeners } from './background/tab-manager.js';

console.log('🚀 Task Recorder Background Service Worker starting...');

  try {
    await chrome.scripting.executeScript({
      // Inject only into the top frame; iframe documents are
      // instrumented by recorder.js itself to avoid duplicates.
      target: { tabId },
      files: ['recorder.js']
    });
    if (reason) {
      console.log(`Recorder injected into tab ${tabId} (${reason})`);
    } else {
      console.log(`Recorder injected into tab ${tabId}`);
    }
  } catch (err) {
    console.error(`Recorder injection failed${reason ? ` (${reason})` : ''}:`, err);
  }
}

// Initialize tab lifecycle listeners
setupTabListeners();

console.log('✅ Task Recorder Background Service Worker ready');
