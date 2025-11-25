// BrowserGym MutationObserver for re-marking DOM elements

import { debounce } from '../utils/helpers.js';
import { getRecordingState } from '../state/recording-state.js';

let browserGymObserver = null;

// Function to re-mark DOM elements with BrowserGym (for dynamically added content)
// Uses event-based communication to avoid CSP violations
export function remarkWithBrowserGym() {
  try {
    // Dispatch a custom event that browsergym-inject.js will listen for
    // This avoids CSP violations since we're not injecting inline scripts
    document.dispatchEvent(new CustomEvent('browsergym-remark-request', {
      detail: { timestamp: Date.now() }
    }));
    console.log('📤 Sent re-mark request to BrowserGym');
    
    // After re-marking, check for any new iframes that need instrumentation
    setTimeout(() => {
      const iframes = document.querySelectorAll('iframe, frame');
      iframes.forEach(iframe => {
        if (!window.trackedIframes || !window.trackedIframes.has(iframe)) {
          console.log('🔍 Found new iframe during re-mark, instrumenting...');
          // This will be handled by the iframe module
          document.dispatchEvent(new CustomEvent('recorder-instrument-iframe', {
            detail: { iframe }
          }));
        }
      });
    }, 200);
  } catch (err) {
    console.error('Failed to trigger BrowserGym re-marking:', err);
  }
}

// Debounced version of remarkWithBrowserGym to avoid excessive calls
const debouncedRemark = debounce(remarkWithBrowserGym, 500);

// Start observing DOM mutations for BrowserGym re-marking
export function startBrowserGymObserver() {
  // Stop existing observer if any
  if (browserGymObserver) {
    browserGymObserver.disconnect();
  }

  browserGymObserver = new MutationObserver((mutations) => {
    // Check if any mutations added new elements
    const hasNewElements = mutations.some(mutation => 
      mutation.type === 'childList' && mutation.addedNodes.length > 0
    );

    const { isRecording } = getRecordingState();
    if (hasNewElements && isRecording) {
      console.log('🔍 New DOM elements detected, scheduling re-mark...');
      debouncedRemark();
    }
  });

  // Observe the entire document for new elements
  browserGymObserver.observe(document.body, {
    childList: true,
    subtree: true
  });

  console.log('👁️ BrowserGym MutationObserver started');
}

// Stop observing DOM mutations
export function stopBrowserGymObserver() {
  if (browserGymObserver) {
    browserGymObserver.disconnect();
    browserGymObserver = null;
    console.log('👁️ BrowserGym MutationObserver stopped');
  }
}

