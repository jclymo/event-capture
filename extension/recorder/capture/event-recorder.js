// Core event recording logic

import { EVENT_TYPES } from '../config/constants.js';
import { getRecordingState } from '../state/recording-state.js';
import { lastEventData, setLastInputValue, updateLastEventData } from '../state/last-event-data.js';
import { clickState, updateClickState } from '../state/click-state.js';
import { resolveEventTarget, getElementValueUnified, isInteractiveElement, getElementBoundingBox } from '../utils/element-utils.js';
import { getElementCssPath, getElementXPath } from '../identification/element-selectors.js';
import { getStableBID } from '../identification/element-bid.js';
import { getA11yIdentifiers } from '../identification/a11y.js';
import { requestHtmlCapture } from './html-capture.js';
import { isHtmlCaptureEnabledForEvent } from '../config/event-config.js';

let enabledDomEventNames = null;

export function setEnabledDomEventNames(names) {
  enabledDomEventNames = names;
}

// Event processing queue to handle async operations in order
const eventProcessingQueue = [];
let isProcessingQueue = false;
let eventSequenceNumber = 0;

// Queue statistics for monitoring
export const queueStats = {
  totalProcessed: 0,
  currentQueueLength: () => eventProcessingQueue.length,
  isProcessing: () => isProcessingQueue,
  getSequenceNumber: () => eventSequenceNumber
};

// Make stats available globally for debugging
if (typeof window !== 'undefined') {
  window.eventQueueStats = queueStats;
}

// Helper: Clone all event properties synchronously (events may be pooled/reused)
function cloneEventProperties(event) {
  const props = {
    type: event.type,
    bubbles: event.bubbles,
    cancelable: event.cancelable,
    timeStamp: event.timeStamp
  };
  
  // Mouse/pointer events
  if ('clientX' in event) {
    props.clientX = event.clientX;
    props.clientY = event.clientY;
    props.screenX = event.screenX;
    props.screenY = event.screenY;
    props.pageX = event.pageX;
    props.pageY = event.pageY;
    props.offsetX = event.offsetX;
    props.offsetY = event.offsetY;
    props.movementX = event.movementX;
    props.movementY = event.movementY;
    props.button = event.button;
    props.buttons = event.buttons;
    props.ctrlKey = event.ctrlKey;
    props.altKey = event.altKey;
    props.shiftKey = event.shiftKey;
    props.metaKey = event.metaKey;
    props.detail = event.detail;
  }
  
  // Keyboard events
  if ('key' in event) {
    props.key = event.key;
    props.code = event.code;
    props.keyCode = event.keyCode;
    props.location = event.location;
    props.repeat = event.repeat;
    props.ctrlKey = event.ctrlKey;
    props.altKey = event.altKey;
    props.shiftKey = event.shiftKey;
    props.metaKey = event.metaKey;
    // Capture modifier state now (getModifierState may not work later)
    try {
      props.capsLock = event.getModifierState ? event.getModifierState('CapsLock') : false;
    } catch (e) {
      props.capsLock = false;
    }
  }
  
  // Input events
  if ('inputType' in event) {
    props.inputType = event.inputType;
    props.data = event.data;
  }
  
  // Pointer events
  if ('pointerType' in event) {
    props.pointerType = event.pointerType;
    props.pointerId = event.pointerId;
    props.isPrimary = event.isPrimary;
    props.pressure = event.pressure;
    props.tiltX = event.tiltX;
    props.tiltY = event.tiltY;
    props.twist = event.twist;
    props.width = event.width;
    props.height = event.height;
  }
  
  // Scroll/wheel events
  if ('deltaY' in event) {
    props.deltaX = event.deltaX;
    props.deltaY = event.deltaY;
    props.deltaMode = event.deltaMode;
  }
  
  // DataTransfer (for input/paste events)
  if (event.dataTransfer) {
    try {
      props.dataTransfer = {
        types: Array.from(event.dataTransfer.types || []),
        files: event.dataTransfer.files ? event.dataTransfer.files.length : 0
      };
    } catch (e) {
      props.dataTransfer = null;
    }
  }
  
  return props;
}

// Helper: Clone element attributes
function cloneAttributes(element) {
  const attrs = {};
  try {
    Array.from(element.attributes || []).forEach(attr => {
      attrs[attr.name] = attr.value;
    });
  } catch (e) {
    // Ignore
  }
  return attrs;
}

// Helper: Capture element state synchronously
function captureElementSnapshot(element) {
  if (!element) return null;
  
  let textContent = '';
  try {
    textContent = element.textContent || '';
    textContent = textContent.trim().replace(/\s+/g, ' ');
    if (textContent.length > 200) textContent = textContent.slice(0, 200) + '...';
  } catch (e) {
    // Ignore
  }
  
  // Capture outerHTML (for debugging/replay)
  let outerHTMLSnippet = null;
  let outerHTMLFull = null;
  try {
    if (typeof element.outerHTML === 'string') {
      const trimmedOuter = element.outerHTML.trim();
      if (trimmedOuter) {
        outerHTMLFull = trimmedOuter;
        outerHTMLSnippet = trimmedOuter.length > 3000
          ? trimmedOuter.slice(0, 3000) + '...'
          : trimmedOuter;
      }
    }
  } catch (e) {
    // Ignore
  }
  
  return {
    tag: element.tagName,
    id: element.id || '',
    className: typeof element.className === 'string' ? element.className : '',
    textContent: textContent,
    value: getElementValueUnified(element),
    isInteractive: isInteractiveElement(element),
    attributes: cloneAttributes(element),
    existingBid: element.getAttribute('data-bid') || null,
    browsergymSetOfMarks: element.getAttribute('browsergym_set_of_marks') || null,
    browsergymVisibilityRatio: element.getAttribute('browsergym_visibility_ratio') || null,
    // Capture bounding box NOW (element position may change)
    boundingBox: getElementBoundingBox(element),
    // Capture accessibility identifiers NOW
    a11y: getA11yIdentifiers(element),
    // Capture outerHTML
    outerHTMLSnippet: outerHTMLSnippet,
    outerHTMLFull: outerHTMLFull,
    // Keep reference for BID lookup (but verify connectivity before use)
    elementRef: element,
    ownerDocument: element.ownerDocument
  };
}

// Helper: Capture scroll state synchronously
function captureScrollState(element) {
  try {
    const target = element === document.documentElement 
      ? (document.scrollingElement || document.documentElement) 
      : element;
    
    if (!target) return null;
    
    return {
      scrollTop: target.scrollTop,
      scrollLeft: target.scrollLeft,
      scrollHeight: target.scrollHeight,
      scrollWidth: target.scrollWidth,
      clientHeight: target.clientHeight,
      clientWidth: target.clientWidth
    };
  } catch (e) {
    return null;
  }
}

// Helper: Capture iframe info synchronously
function captureIframeInfo() {
  const inIframe = window !== window.top;
  if (!inIframe) {
    return { isInIframe: false };
  }
  
  let topUrl = 'unknown';
  try {
    topUrl = window.top.location.href;
  } catch (e) {
    // Cross-origin
  }
  
  return {
    isInIframe: true,
    iframeUrl: window.location.href,
    topUrl: topUrl
  };
}

// Helper: Capture selection state for input elements
function captureSelectionState(element) {
  try {
    if (element && typeof element.selectionStart === 'number') {
      return {
        selectionStart: element.selectionStart,
        selectionEnd: element.selectionEnd,
        selectionDirection: element.selectionDirection || null
      };
    }
  } catch (e) {
    // Some elements throw on selection access
  }
  return null;
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
  if (type === EVENT_TYPES.CLICK || type === EVENT_TYPES.MOUSE_UP) {
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

// Enhanced function to record an event (synchronous capture with async BID lookup)
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
  console.log(`📝 Recording event: ${event.type} (queued)`);

  // Capture synchronous snapshot IMMEDIATELY
  const { primary: targetElement, original: originalTarget } = resolveEventTarget(event.target);
  const metadataElement = targetElement || originalTarget;

  if (!metadataElement) {
    console.warn('Unable to resolve a target element for event:', event.type);
    return;
  }

  // ✅ CAPTURE ALL VOLATILE DATA SYNCHRONOUSLY
  const eventSnapshot = {
    // Timing & ordering
    timestamp: Date.now(),
    sequenceNumber: eventSequenceNumber++,
    url: window.location.href,
    
    // Event properties (CLONED, not referenced)
    eventType: event.type,
    eventProps: cloneEventProperties(event),
    
    // Element state (captured NOW before it changes)
    elementSnapshot: captureElementSnapshot(metadataElement),
    
    // Original target snapshot if different
    originalTargetSnapshot: (originalTarget && originalTarget !== metadataElement) 
      ? captureElementSnapshot(originalTarget) 
      : null,
    
    // Scroll state (captured NOW)
    scrollState: captureScrollState(metadataElement),
    
    // Iframe info (captured NOW)
    iframeInfo: captureIframeInfo(),
    
    // Selection state for inputs (captured NOW)
    selectionState: captureSelectionState(metadataElement),
    
    // Remember oldValue for input events
    oldInputValue: lastEventData.lastInputValue
  };

  // Queue for async processing (only BID lookup is async)
  eventProcessingQueue.push(eventSnapshot);
  
  // Start processing if not already running
  if (!isProcessingQueue) {
    processEventQueue();
  }
}

// Process queued events asynchronously in order
async function processEventQueue() {
  if (isProcessingQueue) return;
  
  isProcessingQueue = true;
  
  while (eventProcessingQueue.length > 0) {
    const snapshot = eventProcessingQueue.shift();
    
    try {
      await processEventSnapshot(snapshot);
    } catch (err) {
      console.error('Error processing event snapshot:', err);
    }
  }
  
  isProcessingQueue = false;
}

// Process a single event snapshot asynchronously (only BID lookup is async)
async function processEventSnapshot(snapshot) {
  const { 
    timestamp, 
    sequenceNumber, 
    url,
    eventType, 
    eventProps, 
    elementSnapshot, 
    originalTargetSnapshot,
    scrollState,
    iframeInfo,
    selectionState,
    oldInputValue
  } = snapshot;
  
  // Re-check recording state before processing
  const { isRecording } = getRecordingState();
  if (!isRecording) {
    console.log(`⏹️ Recording stopped, skipping queued event #${sequenceNumber}`);
    return;
  }
  
  console.log(`🔄 Processing event #${sequenceNumber}: ${eventType} (queue: ${eventProcessingQueue.length})`);
  
  // ✅ Null check for elementSnapshot
  if (!elementSnapshot) {
    console.error(`❌ Missing elementSnapshot for event #${sequenceNumber}, skipping`);
    return;
  }
  
  // ✅ Try to get BID asynchronously (only async part)
  let bid = elementSnapshot.existingBid;  // Use cached BID if available
  
  if (!bid && elementSnapshot.elementRef) {
    // Check if element is still in DOM
    const isConnected = elementSnapshot.elementRef.isConnected !== false;
    
    if (isConnected) {
      try {
        // Try async BID lookup
        bid = await getStableBID(elementSnapshot.elementRef);
      } catch (err) {
        console.warn('BID lookup failed, using fallback:', err);
      }
    } else {
      console.log('Element no longer in DOM, using snapshot data for BID fallback');
    }
  }
  
  // Fallback BID from snapshot data if still no BID
  if (!bid) {
    bid = generateFallbackBid(elementSnapshot);
    
    // Inject fallback BID into DOM for future consistency and HTML capture
    if (elementSnapshot.elementRef && elementSnapshot.elementRef.isConnected) {
      try {
        elementSnapshot.elementRef.setAttribute('data-bid', bid);
        console.log(`💉 Injected fallback BID into DOM: ${bid}`);
      } catch (e) {
        // Element may be in a different context (iframe) or protected
        console.debug('Could not inject fallback BID:', e);
      }
    }
  }
  
  queueStats.totalProcessed++;
  
  // Build target metadata from snapshot (NOT from live DOM)
  const targetMetadata = {
    tag: elementSnapshot.tag,
    id: elementSnapshot.id,
    class: elementSnapshot.className,
    text: elementSnapshot.textContent,
    value: elementSnapshot.value,
    isInteractive: elementSnapshot.isInteractive,
    bid: bid,
    a11y: elementSnapshot.a11y,
    attributes: elementSnapshot.attributes,
    boundingBox: elementSnapshot.boundingBox,
    browsergym_set_of_marks: elementSnapshot.browsergymSetOfMarks,
    browsergym_visibility_ratio: elementSnapshot.browsergymVisibilityRatio,
    outerHTMLSnippet: elementSnapshot.outerHTMLSnippet,
    outerHTMLFull: elementSnapshot.outerHTMLFull,
    // Try to get paths if element still connected, otherwise skip
    xpath: tryGetXPath(elementSnapshot.elementRef),
    cssPath: tryGetCssPath(elementSnapshot.elementRef)
  };

  // Create event object with data from SNAPSHOT (not live)
  const eventData = {
    type: eventType,
    timestamp: timestamp,
    sequenceNumber: sequenceNumber,
    url: url,
    target: targetMetadata,
    ...iframeInfo
  };

  // Add original target from snapshot if it was captured
  if (originalTargetSnapshot) {
    eventData.originalTarget = {
      tag: originalTargetSnapshot.tag,
      id: originalTargetSnapshot.id,
      class: originalTargetSnapshot.className,
      cssPath: tryGetCssPath(originalTargetSnapshot.elementRef),
      xpath: tryGetXPath(originalTargetSnapshot.elementRef)
    };
  }

  // Add event-specific data FROM SNAPSHOT (not from event object)
  if (eventType === EVENT_TYPES.CLICK) {
    eventData.button = eventProps.button;
    eventData.buttons = eventProps.buttons;
    eventData.clientX = eventProps.clientX;
    eventData.clientY = eventProps.clientY;
    eventData.screenX = eventProps.screenX;
    eventData.screenY = eventProps.screenY;
    eventData.pageX = eventProps.pageX;
    eventData.pageY = eventProps.pageY;
    eventData.offsetX = eventProps.offsetX;
    eventData.offsetY = eventProps.offsetY;
    eventData.movementX = eventProps.movementX;
    eventData.movementY = eventProps.movementY;
    eventData.ctrlKey = eventProps.ctrlKey;
    eventData.altKey = eventProps.altKey;
    eventData.shiftKey = eventProps.shiftKey;
    eventData.metaKey = eventProps.metaKey;
    eventData.detail = eventProps.detail;
  }

  if (eventType === EVENT_TYPES.POINTER_DOWN || eventType === EVENT_TYPES.POINTER_UP || eventType === EVENT_TYPES.POINTER_MOVE) {
    eventData.pointerType = eventProps.pointerType;
    eventData.pointerId = eventProps.pointerId;
    eventData.isPrimary = eventProps.isPrimary;
    eventData.pressure = eventProps.pressure;
    eventData.tiltX = eventProps.tiltX;
    eventData.tiltY = eventProps.tiltY;
    eventData.twist = eventProps.twist;
    eventData.width = eventProps.width;
    eventData.height = eventProps.height;
  }

  if (eventType === EVENT_TYPES.KEY_DOWN || eventType === EVENT_TYPES.KEY_UP || eventType === EVENT_TYPES.KEY_PRESS) {
    eventData.key = eventProps.key;
    eventData.code = eventProps.code;
    eventData.keyCode = eventProps.keyCode;
    eventData.location = eventProps.location;
    eventData.repeat = eventProps.repeat;
    eventData.modifierState = {
      ctrl: eventProps.ctrlKey,
      alt: eventProps.altKey,
      shift: eventProps.shiftKey,
      meta: eventProps.metaKey,
      capsLock: eventProps.capsLock || false
    };
  }

  if (eventType === EVENT_TYPES.INPUT || eventType === EVENT_TYPES.CHANGE) {
    eventData.inputType = eventProps.inputType;
    eventData.data = eventProps.data;
    eventData.dataTransfer = eventProps.dataTransfer;
    eventData.value = elementSnapshot.value;  // FROM SNAPSHOT
    eventData.oldValue = oldInputValue;  // FROM SNAPSHOT
    
    if (selectionState) {
      eventData.selectionStart = selectionState.selectionStart;
      eventData.selectionEnd = selectionState.selectionEnd;
      eventData.selectionDirection = selectionState.selectionDirection;
    }
  }

  if (eventType === EVENT_TYPES.SCROLL) {
    if (scrollState) {
      eventData.scroll = scrollState;  // FROM SNAPSHOT
    }
    if (eventProps.deltaY !== undefined || eventProps.deltaX !== undefined) {
      eventData.delta = {
        deltaX: eventProps.deltaX,
        deltaY: eventProps.deltaY,
        deltaMode: eventProps.deltaMode
      };
    }
  }

  // Send event to background script
  chrome.runtime.sendMessage({ type: 'recordedEvent', event: eventData });
  
  // Capture HTML if enabled and element still connected
  if (isHtmlCaptureEnabledForEvent(eventType)) {
    const sourceDocument = elementSnapshot.ownerDocument || document;
    requestHtmlCapture(eventType, sourceDocument);
  }
}

// Helper: Try to get XPath (returns null if element disconnected)
function tryGetXPath(elementRef) {
  try {
    if (elementRef && elementRef.isConnected !== false) {
      return getElementXPath(elementRef);
    }
  } catch (e) {
    // Element may be stale
  }
  return null;
}

// Helper: Try to get CSS path (returns null if element disconnected)
function tryGetCssPath(elementRef) {
  try {
    if (elementRef && elementRef.isConnected !== false) {
      return getElementCssPath(elementRef);
    }
  } catch (e) {
    // Element may be stale
  }
  return null;
}

// Helper: Generate fallback BID from snapshot data
function generateFallbackBid(elementSnapshot) {
  const tag = (elementSnapshot.tag || 'unknown').toLowerCase();
  const id = elementSnapshot.id;
  const className = elementSnapshot.className;
  
  // Try common attributes first
  if (id) return `id-${id}`;
  
  const testId = elementSnapshot.attributes?.['data-testid'];
  if (testId) return `test-${testId}`;
  
  const ariaLabel = elementSnapshot.attributes?.['aria-label'];
  if (ariaLabel) return `aria-${ariaLabel.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
  
  // Generate hash from available data
  const text = elementSnapshot.textContent || '';
  const classes = typeof className === 'string' ? className.split(/\s+/).filter(c => c).join('-') : '';
  const hashInput = `${tag}-${classes}-${text.slice(0, 30)}`;
  
  // Simple hash
  let hash = 0;
  for (let i = 0; i < hashInput.length; i++) {
    const char = hashInput.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  
  return `${tag}${classes ? '-' + classes : ''}-${Math.abs(hash).toString(36)}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

