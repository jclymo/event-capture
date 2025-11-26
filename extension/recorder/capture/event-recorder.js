// Core event recording logic

import { EVENT_TYPES } from '../config/constants.js';
import { getRecordingState, setEvents } from '../state/recording-state.js';
import { lastEventData, setLastInputValue, updateLastEventData } from '../state/last-event-data.js';
import { clickState, updateClickState } from '../state/click-state.js';
import { resolveEventTarget, getElementValueUnified, isInteractiveElement } from '../utils/element-utils.js';
import { buildTargetMetadata } from '../identification/element-metadata.js';
import { getElementCssPath, getElementXPath } from '../identification/element-selectors.js';
import { requestHtmlCapture } from './html-capture.js';
import { getCachedConfig } from '../config/event-config.js';

let enabledDomEventNames = null;

export function setEnabledDomEventNames(names) {
  enabledDomEventNames = names;
}

// This function helps us decide if we should ignore an event
export function shouldIgnoreEvent(event, type) {
  const { primary: resolvedTarget, original: originalTarget } = resolveEventTarget(event.target);
  const element = resolvedTarget || originalTarget;
  if (!element) {
    return true;
  }

  const currentValue = getElementValueUnified(element);
  const currentTime = Date.now();
  
  // Special handling for clicks - we want to be smart about what clicks we record
  if (type === EVENT_TYPES.CLICK || type === 'mouseup') {
      const isClickEvent = type === EVENT_TYPES.CLICK;
      const sameTarget = element === clickState.lastClickTarget;
      const sameButton = clickState.lastClickButton === event.button;
      const lastCoords = clickState.lastClickCoords;
      const currentCoords = {
          x: typeof event.screenX === 'number' ? event.screenX : 0,
          y: typeof event.screenY === 'number' ? event.screenY : 0
      };
      const previousTime = isClickEvent ? clickState.lastClickTime : clickState.lastMouseUpTime;

      if (lastCoords && sameButton) {
          const deltaX = Math.abs(currentCoords.x - lastCoords.x);
          const deltaY = Math.abs(currentCoords.y - lastCoords.y);
          const isSameSpot = deltaX <= 2 && deltaY <= 2;
          if (isSameSpot && previousTime && (currentTime - previousTime) < 200) {
              return true;
          }
      }

      // Ignore super quick consecutive clicks on the same element
      if (isClickEvent && previousTime && sameTarget && (currentTime - previousTime) < 25) {
          return true;
      }

      // Remember this click for next time
      updateClickState(currentTime, element, event.button, currentCoords, isClickEvent);
      
      // Always record clicks on interactive elements (buttons, links, etc.)
      if (isInteractiveElement(element)) {
          return false;
      }
  }
  
  // Handle input events - we only care about actual changes
  if (type === EVENT_TYPES.INPUT) {
      // Skip if the value hasn't changed
      if (currentValue === lastEventData.lastInputValue) {
          return true;
      }
      // Remember this value for next time
      setLastInputValue(currentValue);
  }

  // Handle scroll events - we only care about significant scrolling
  if (type === EVENT_TYPES.SCROLL) {
      const scrollThreshold = 50; // pixels
      if (Math.abs(event.deltaY) < scrollThreshold) {
          return true; // Ignore tiny scrolls
      }
  }

  // Handle mouse hover events - only record for interactive elements or tooltips
  if (type === EVENT_TYPES.MOUSE_OVER || type === EVENT_TYPES.MOUSE_OUT) {
      if (!isInteractiveElement(element) && !element.hasAttribute('title')) {
          return true; // Ignore hovering over regular text
      }
  }

  // Check for duplicate events within a short time window
  if (type !== EVENT_TYPES.CLICK &&
      type !== EVENT_TYPES.INPUT &&
      lastEventData.type === type && 
      lastEventData.target === element && 
      currentTime - lastEventData.timestamp < 300) {
      return true; // Ignore duplicates within 300ms
  }
  
  // Update our memory of the last event
  updateLastEventData(type, element, currentValue, currentTime);
  
  return false;
}

// Enhanced function to record an event
export function recordEvent(event) {
  const { isRecording, currentTaskId } = getRecordingState();
  
  if (!isRecording) {
    console.debug(`🚫 Event ${event.type} not recorded - isRecording is false`);
    return;
  }

  if (enabledDomEventNames && !enabledDomEventNames.has(event.type)) {
    console.debug(`Ignoring DOM event '${event.type}' because it is disabled in configuration.`);
    return;
  }

  if (shouldIgnoreEvent(event, event.type)) {
    return;
  }
  console.log(`📝 Recording event: ${event.type}`);

  const { primary: targetElement, original: originalTarget } = resolveEventTarget(event.target);
  const metadataElement = targetElement || originalTarget;

  if (!metadataElement) {
    console.warn('Unable to resolve a target element for event:', event.type);
    return;
  }

  const targetMetadata = buildTargetMetadata(metadataElement);
  if (!targetMetadata) {
    console.warn('Failed to build metadata for event target:', metadataElement);
    return;
  }
  
  // Check if event originated from an iframe
  const inIframe = window !== window.top;
  let iframeInfo = { isInIframe: false };
  if (inIframe) {
    let topUrl = 'unknown';
    try {
      // Can throw on cross-origin, so guard it
      topUrl = window.top.location.href;
    } catch (err) {
      console.warn('Unable to read top window URL from iframe:', err);
    }
    iframeInfo = {
      isInIframe: true,
      iframeUrl: window.location.href,
      topUrl
    };
  }

  // Create event object with BrowserGym-like structure
  const eventData = {
    type: event.type,
    timestamp: Date.now(),
    url: window.location.href,
    target: targetMetadata,
    ...iframeInfo
  };

  if (originalTarget && originalTarget !== metadataElement) {
    eventData.originalTarget = {
      tag: originalTarget.tagName,
      id: originalTarget.id,
      class: originalTarget.className,
      cssPath: getElementCssPath(originalTarget),
      xpath: getElementXPath(originalTarget)
    };
  }

  // Add event-specific data
  if (event.type === 'click') {
    eventData.button = event.button;
    eventData.buttons = event.buttons;
    eventData.clientX = event.clientX;
    eventData.clientY = event.clientY;
    eventData.screenX = event.screenX;
    eventData.screenY = event.screenY;
    eventData.pageX = event.pageX;
    eventData.pageY = event.pageY;
    eventData.offsetX = event.offsetX;
    eventData.offsetY = event.offsetY;
    eventData.movementX = event.movementX;
    eventData.movementY = event.movementY;
    eventData.ctrlKey = event.ctrlKey;
    eventData.altKey = event.altKey;
    eventData.shiftKey = event.shiftKey;
    eventData.metaKey = event.metaKey;
    eventData.detail = event.detail; // For double clicks
  }

  if (event.type === EVENT_TYPES.POINTER_DOWN || event.type === EVENT_TYPES.POINTER_UP || event.type === EVENT_TYPES.POINTER_MOVE) {
    eventData.pointerType = event.pointerType;
    eventData.pointerId = event.pointerId;
    eventData.isPrimary = event.isPrimary;
    eventData.pressure = event.pressure;
    eventData.tiltX = event.tiltX;
    eventData.tiltY = event.tiltY;
    eventData.twist = event.twist;
    eventData.width = event.width;
    eventData.height = event.height;
  }

  if (event.type === EVENT_TYPES.KEY_DOWN || event.type === EVENT_TYPES.KEY_UP || event.type === EVENT_TYPES.KEY_PRESS) {
    eventData.key = event.key;
    eventData.code = event.code;
    eventData.keyCode = event.keyCode;
    eventData.location = event.location;
    eventData.repeat = event.repeat;
    eventData.modifierState = {
      ctrl: event.ctrlKey,
      alt: event.altKey,
      shift: event.shiftKey,
      meta: event.metaKey,
      capsLock: event.getModifierState ? event.getModifierState('CapsLock') : false
    };
  }

  if (event.type === EVENT_TYPES.INPUT || event.type === EVENT_TYPES.CHANGE) {
    eventData.inputType = event.inputType;
    eventData.data = event.data;
    eventData.dataTransfer = event.dataTransfer ? {
      types: Array.from(event.dataTransfer.types || []),
      files: event.dataTransfer.files ? event.dataTransfer.files.length : 0
    } : null;

    const activeElement = metadataElement;
    // Capture current value for inputs, selects, and contenteditable
    const unifiedValue = getElementValueUnified(activeElement);
    eventData.value = unifiedValue;
    eventData.oldValue = lastEventData.lastInputValue;
    setLastInputValue(unifiedValue);
    if (activeElement && typeof activeElement.selectionStart === 'number') {
      eventData.selectionStart = activeElement.selectionStart;
      eventData.selectionEnd = activeElement.selectionEnd;
      eventData.selectionDirection = activeElement.selectionDirection || null;
    }
  }

  if (event.type === EVENT_TYPES.SCROLL) {
    const target = metadataElement === document.documentElement ? document.scrollingElement || document.documentElement : metadataElement;
    if (target) {
      eventData.scroll = {
        scrollTop: target.scrollTop,
        scrollLeft: target.scrollLeft,
        scrollHeight: target.scrollHeight,
        scrollWidth: target.scrollWidth,
        clientHeight: target.clientHeight,
        clientWidth: target.clientWidth
      };
    }
    if (typeof event.deltaY === 'number' || typeof event.deltaX === 'number') {
      eventData.delta = {
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode
      };
    }
  }

  // Send event to background script
  chrome.runtime.sendMessage({ type: 'recordedEvent', event: eventData });
  // Capture HTML for the specific document this event came from (with BID wait)
  const sourceDocument = metadataElement.ownerDocument || document;
  requestHtmlCapture(event.type, sourceDocument);
}

