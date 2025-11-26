// Navigation event recording

import { EVENT_TYPES } from '../config/constants.js';
import { getRecordingState } from '../state/recording-state.js';
import { navigationState, updateNavigationState } from '../state/navigation-state.js';
import { clickState, resetClickCount } from '../state/click-state.js';
import { formatTimestamp } from '../utils/helpers.js';

let enabledNavigationEventNames = null;

export function setEnabledNavigationEventNames(names) {
  enabledNavigationEventNames = names;
}

// Function to handle navigation events
export function handleNavigation(event) {
  const { isRecording } = getRecordingState();
  if (!isRecording) return;
  
  const currentUrl = window.location.href;
  const previousUrl = navigationState.lastUrl || document.referrer;
  
  if (currentUrl !== previousUrl) {
    recordNavigationEvent(previousUrl, currentUrl, event?.type);
  }
}

export function handleBeforeUnload() {
  const { isRecording, currentTaskId } = getRecordingState();
  if (!isRecording) return;

  updateNavigationState(window.location.href, document.title, true);
  const currentUrl = window.location.href;

  try {
    localStorage.setItem('pendingNavigation', JSON.stringify({
      fromUrl: currentUrl,
      timestamp: Date.now(),
      taskId: currentTaskId
    }));
  } catch (e) {
    console.error('Error saving navigation state:', e);
  }
}

// Enhanced function to record navigation events
export function recordNavigationEvent(fromUrl, toUrl, rawType) {
  const { isRecording } = getRecordingState();
  if (!isRecording) return;

  let eventType = rawType || EVENT_TYPES.NAVIGATION;
  if (enabledNavigationEventNames) {
    if (enabledNavigationEventNames.has(eventType)) {
      // ok
    } else if (!rawType && enabledNavigationEventNames.has(EVENT_TYPES.NAVIGATION)) {
      eventType = EVENT_TYPES.NAVIGATION;
    } else {
      console.debug(`Ignoring navigation event '${eventType}' because it is disabled in configuration.`);
      return;
    }
  }
  const now = Date.now();
  const eventData = {
    type: eventType,
    category: EVENT_TYPES.NAVIGATION,
    timestamp: formatTimestamp(now),
    fromUrl: fromUrl,
    toUrl: toUrl,
    title: document.title,
    referrer: document.referrer,
    fromUserInput: clickState.clickCount > 0
  };

  // Persist via background event-storage (same path as DOM events)
  chrome.runtime.sendMessage({ type: 'recordedEvent', event: eventData });
  
  // Update navigation state
  updateNavigationState(toUrl, document.title, false);
  
  // Reset click count after navigation
  resetClickCount();

  // Log navigation event
  console.log(`Navigation recorded:`, {
    type: eventType,
    from: fromUrl,
    to: toUrl,
    userInitiated: clickState.clickCount > 0
  });
}

