// Critical early-attach listeners to capture events before page scripts

import { getRecordingState } from '../state/recording-state.js';
import { minimalEventSnapshot, addToPrebuffer } from '../capture/prebuffer.js';
import { recordEvent } from '../capture/event-recorder.js';

// Store which documents have critical listeners attached
const criticalDomListeners = new Map();

// Make it available globally for checks
if (typeof window !== 'undefined') {
  window.criticalDomListeners = criticalDomListeners;
}

// Attach a minimal set of capture-phase listeners ASAP so we preempt
// site-level capturing handlers that may stop propagation (e.g., Amazon)
export function preAttachCriticalListeners(targetDocument = document) {
  try {
    // Include mousedown/mouseup for maximum compatibility alongside pointerdown, and selectstart (sorting)
    const critical = ['pointerdown', 'mousedown', 'mouseup', 'click', 'submit', 'input', 'change', 'keydown', 'selectstart'];
    critical.forEach((name) => {
      // Use document as key to track which documents have listeners
      const key = `${name}_${targetDocument === document ? 'main' : 'iframe'}`;
      if (!criticalDomListeners.has(key)) {
        targetDocument.addEventListener(name, (e) => {
          try {
            const { isRecording } = getRecordingState();
            if (isRecording) {
              recordEvent(e);
            } else {
              // Snapshot minimal event fields and buffer
              const snap = minimalEventSnapshot(e);
              addToPrebuffer(snap);
            }
          } catch (err) {
            console.warn('Critical listener error:', err);
          }
        }, true);
        criticalDomListeners.set(key, true);
        console.log(`Pre-attached critical listener for ${name} on`, targetDocument === document ? 'main document' : 'iframe');
      }
    });
  } catch (err) {
    console.warn('Failed to pre-attach critical listeners:', err);
  }
}

export function hasCriticalListener(eventName) {
  return criticalDomListeners.has(`${eventName}_main`);
}

export function getCriticalListeners() {
  return criticalDomListeners;
}

