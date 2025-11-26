// Recording session initialization

import { 
  setRecordingState, 
  setCurrentTaskId, 
  setEvents, 
  setRecordingStartTime 
} from '../state/recording-state.js';
import { loadEventConfig, clearCachedConfig, getCachedConfig } from '../config/event-config.js';
import { flushPrebuffer } from '../capture/prebuffer.js';
import { recordEvent } from '../capture/event-recorder.js';
import { setEnabledDomEventNames } from '../capture/event-recorder.js';
import { setEnabledNavigationEventNames } from '../capture/navigation-recorder.js';
import { updateNavigationState } from '../state/navigation-state.js';
import { injectBrowserGymScript } from '../browsergym/injection.js';
import { startBrowserGymObserver } from '../browsergym/observer.js';
import { startIframeObserver } from '../iframe/observer.js';
import { instrumentAllIframes } from '../iframe/instrumentation.js';
import { preAttachCriticalListeners } from '../listeners/critical-listeners.js';
import { attachDomListenersToDocument, detachDomListeners } from '../listeners/dom-listeners.js';
import { attachNavigationListeners, detachNavigationListeners } from '../listeners/navigation-listeners.js';

let dynamicObserver = null;

// Unified initialization function for both new recordings and resumed sessions
export async function initializeRecordingSession(taskId, options = {}) {
  const {
    isResuming = false,           // true if resuming after navigation, false if new recording
    existingEvents = [],          // events from storage (for resumed sessions)
    clearCache = false,           // whether to clear cached config
    startAtMs = null              // popup-provided start timestamp
  } = options;

  console.log(`Initializing recording session: ${isResuming ? 'RESUMED' : 'NEW'}`, { taskId });

  // Set recording state
  setRecordingState(true);
  setCurrentTaskId(taskId);
  setEvents(existingEvents);
  setRecordingStartTime(startAtMs || Date.now());

  // Critical listeners are pre-attached on script load to avoid race conditions

  if (clearCache) {
    clearCachedConfig();
  }

  // Initialize full configurable listeners as soon as DOM is ready
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initializeRecording();
  } else {
    document.addEventListener('DOMContentLoaded', initializeRecording);
  }

  // Flush any prebuffered events captured just after user hit Start
  const recordingStartAtMs = startAtMs || Date.now();
  flushPrebuffer(recordingStartAtMs, recordEvent);
  
  // Inject BrowserGym script to mark DOM elements with data-bid attributes
  try {
    const injectionSuccess = await injectBrowserGymScript();
    if (injectionSuccess) {
      console.log('✅ BrowserGym injection successful');
      startBrowserGymObserver();
      // Give BrowserGym a moment to initialize, then instrument iframes
      setTimeout(() => {
        startIframeObserver(preAttachCriticalListeners, attachDomListenersToDocument);
        instrumentAllIframes(0, preAttachCriticalListeners, attachDomListenersToDocument);
      }, 100);
    } else {
      console.warn('⚠️ BrowserGym injection failed, using fallback BIDs');
      startIframeObserver(preAttachCriticalListeners, attachDomListenersToDocument);
      instrumentAllIframes(0, preAttachCriticalListeners, attachDomListenersToDocument);
    }
  } catch (err) {
    console.error('❌ BrowserGym injection error:', err);
    startIframeObserver(preAttachCriticalListeners, attachDomListenersToDocument);
    instrumentAllIframes(0, preAttachCriticalListeners, attachDomListenersToDocument);
  }
}

// TODO: observeDynamicChanges needs to be implemented or removed
function observeDynamicChanges() {
  // Placeholder for dynamic DOM observation
  return null;
}

// Check if we should resume recording (handles navigation during active recording)
export function checkAndResumeRecording() {
  chrome.storage.local.get(['isRecording', 'currentTaskId', 'taskHistory'], (data) => {
    if (data.isRecording && data.currentTaskId) {
      console.log("🔄 Resuming recording for task:", data.currentTaskId);
      
      // Get existing events for this task
      const existingEvents = (data.taskHistory && data.taskHistory[data.currentTaskId]) 
        ? (data.taskHistory[data.currentTaskId].events || [])
        : [];
      
      // Resume recording session
      initializeRecordingSession(data.currentTaskId, {
        isResuming: true,
        existingEvents: existingEvents,
        clearCache: false
      });
      console.log('✅ Recording session resumed');
    } else {
      console.log('ℹ️ No active recording to resume');
    }
  });
}

export async function initializeRecording() {
  console.log('Initializing recording with configurable listeners');

  try {
    const config = await loadEventConfig();

    detachDomListeners();
    detachNavigationListeners();

    const enabledDomEvents = (config.domEvents || []).filter(evt => evt && evt.enabled !== false);
    const enabledDomEventNames = new Set(enabledDomEvents.map(evt => evt.name));
    setEnabledDomEventNames(enabledDomEventNames);
    console.log('Enabled DOM events:', Array.from(enabledDomEventNames));
    
    enabledDomEvents.forEach(({ name, handler }) => {
      // DOM listeners are handled by attachDomListenersToDocument
      // This is called separately in the initialization flow
    });

    const enabledNavigationEvents = (config.navigationEvents || []).filter(evt => evt && evt.enabled !== false);
    const enabledNavigationEventNames = new Set(enabledNavigationEvents.map(evt => evt.name));
    setEnabledNavigationEventNames(enabledNavigationEventNames);
    console.log('Enabled navigation events:', Array.from(enabledNavigationEventNames));
    
    attachNavigationListeners(enabledNavigationEvents);

    if (config.observers && config.observers.dynamicDom === false) {
      if (dynamicObserver) {
        dynamicObserver.disconnect();
        dynamicObserver = null;
      }
    } else {
      if (dynamicObserver) {
        dynamicObserver.disconnect();
      }
      dynamicObserver = observeDynamicChanges();
    }

    updateNavigationState(window.location.href, document.title, false);

    console.log('Recording initialized with state:', {
      domEvents: enabledDomEvents.map(evt => evt.name),
      navigationEvents: enabledNavigationEvents.map(evt => evt.name)
    });
  } catch (error) {
    console.error('Failed to initialize recording configuration:', error);
  }
}

export function getDynamicObserver() {
  return dynamicObserver;
}

