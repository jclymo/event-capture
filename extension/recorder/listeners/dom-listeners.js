// DOM event listeners management

import { getCachedConfig, DEFAULT_EVENT_CONFIG } from '../config/event-config.js';
import { recordEvent } from '../capture/event-recorder.js';
import { debounce } from '../utils/helpers.js';
import { getElementValueUnified } from '../utils/element-utils.js';
import { lastEventData } from '../state/last-event-data.js';
import { hasCriticalListener } from './critical-listeners.js';

const activeDomListeners = new Map();

// Debounced handlers
export const debouncedRecordInput = debounce((e) => {
  const val = getElementValueUnified(e.target);
  if (val !== lastEventData.lastInputValue) {
    recordEvent(e);
  }
}, 300);

export const debouncedRecordScroll = debounce((e) => {
  recordEvent(e);
}, 100);

export function getHandlerByKey(handlerKey) {
  switch (handlerKey) {
    case 'debouncedRecordInput':
      return debouncedRecordInput;
    case 'debouncedRecordScroll':
      return debouncedRecordScroll;
    case 'recordEvent':
    default:
      return recordEvent;
  }
}

// Attach DOM listeners to a specific document (main or iframe)
export function attachDomListenersToDocument(targetDocument) {
  try {
    const config = getCachedConfig() || DEFAULT_EVENT_CONFIG;
    const enabledDomEvents = (config.domEvents || []).filter(evt => evt && evt.enabled !== false);

    enabledDomEvents.forEach(({ name, handler }) => {
      const resolvedHandler = getHandlerByKey(handler);
      if (!resolvedHandler) {
        console.warn(`No handler resolved for event '${name}' (key: ${handler}).`);
        return;
      }
      // Skip if already handled by critical listener for main document
      if (targetDocument === document && hasCriticalListener(name)) {
        return;
      }
      targetDocument.addEventListener(name, resolvedHandler, true);
      console.log(`Added event listener for ${name} on`, targetDocument === document ? 'main' : 'iframe');
    });
  } catch (err) {
    console.error('Failed to attach DOM listeners to document:', err);
  }
}

export function detachDomListeners(targetDocument = document) {
  activeDomListeners.forEach((handler, eventName) => {
    targetDocument.removeEventListener(eventName, handler, true);
  });
  if (targetDocument === document) {
    activeDomListeners.clear();
  }
}

export function getActiveDomListeners() {
  return activeDomListeners;
}

