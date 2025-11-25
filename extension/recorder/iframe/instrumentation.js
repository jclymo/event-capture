// Iframe instrumentation logic

import { getRecordingState } from '../state/recording-state.js';

// Track which iframes we've instrumented
const trackedIframes = new WeakSet();

// Make it available globally for BrowserGym observer
if (typeof window !== 'undefined') {
  window.trackedIframes = trackedIframes;
}

// Instrument an iframe for event capturing
export function instrumentIframe(iframe, preAttachCriticalListenersFn, attachDomListenersToDocumentFn) {
  if (trackedIframes.has(iframe)) {
    console.log('Iframe already instrumented, skipping');
    return;
  }

  try {
    // Mark as tracked first to avoid reprocessing
    trackedIframes.add(iframe);

    // Try to access iframe's contentDocument (will fail for cross-origin iframes)
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;

    if (!iframeDoc) {
      console.warn('Cannot access iframe document (cross-origin or not loaded):', iframe.src);
      return;
    }

    console.log('📍 Instrumenting iframe:', iframe.src || '<no src>');

    // Wait for iframe to be fully loaded
    const instrumentWhenReady = () => {
      try {
        if (iframeDoc.readyState === 'complete' || iframeDoc.readyState === 'interactive') {
          // Attach critical listeners to iframe
          preAttachCriticalListenersFn(iframeDoc);

          // Attach full event listeners if recording
          const { isRecording } = getRecordingState();
          if (isRecording) {
            attachDomListenersToDocumentFn(iframeDoc);
          }

          // Inject BrowserGym into iframe
          injectBrowserGymIntoIframe(iframe);

          console.log('✅ Iframe instrumented successfully');
        } else {
          // Wait for DOMContentLoaded
          iframeDoc.addEventListener('DOMContentLoaded', () => {
            preAttachCriticalListenersFn(iframeDoc);
            const { isRecording } = getRecordingState();
            if (isRecording) {
              attachDomListenersToDocumentFn(iframeDoc);
            }
            injectBrowserGymIntoIframe(iframe);
          }, { once: true });
        }
      } catch (err) {
        console.warn('Error instrumenting iframe:', err);
      }
    };

    // If iframe is not yet loaded, wait for load event
    if (iframe.contentWindow && (iframeDoc.readyState === 'loading' || !iframeDoc.readyState)) {
      iframe.addEventListener('load', instrumentWhenReady, { once: true });
    } else {
      instrumentWhenReady();
    }

  } catch (err) {
    console.warn('Failed to instrument iframe (likely cross-origin):', err);
    // Still mark as tracked to avoid retrying
  }
}

// Inject BrowserGym script into an iframe
function injectBrowserGymIntoIframe(iframe) {
  try {
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iframeDoc) return;

    const iframeWindow = iframe.contentWindow;
    if (!iframeWindow) return;

    // Check if already injected
    if (iframeWindow.browserGymInitialized) {
      console.log('BrowserGym already initialized in iframe');
      return;
    }

    // Check if script is already loaded (prevent duplicate injection)
    const scriptUrl = chrome.runtime.getURL('browsergym-inject.js');
    const existingScript = iframeDoc.querySelector(`script[src="${scriptUrl}"]`);
    if (existingScript) {
      console.log('BrowserGym script already present in iframe, skipping injection');
      return;
    }

    // Get or assign iframe index for BID prefix
    let iframeIndex = iframe.getAttribute('data-iframe-index');
    if (!iframeIndex) {
      // Count existing iframes to assign index
      const allIframes = Array.from(document.querySelectorAll('iframe, frame'));
      iframeIndex = allIframes.indexOf(iframe);
      if (iframeIndex === -1) iframeIndex = allIframes.length; // Fallback
      iframe.setAttribute('data-iframe-index', iframeIndex);
    }

    // Set iframe BID prefix directly on window (bypasses CSP restrictions)
    const prefixValue = `iframe${iframeIndex}_`;
    iframeWindow.BROWSERGYM_IFRAME_PREFIX = prefixValue;
    console.log(`🔧 Set iframe prefix directly:`, iframeWindow.BROWSERGYM_IFRAME_PREFIX);
    console.log(`🔍 Iframe document ready state: ${iframeDoc.readyState}, elements: ${iframeDoc.querySelectorAll('*').length}`);

    // Verify prefix is accessible immediately
    if (iframeWindow.BROWSERGYM_IFRAME_PREFIX !== prefixValue) {
      console.error(`❌ Prefix not set correctly! Expected: ${prefixValue}, Got:`, iframeWindow.BROWSERGYM_IFRAME_PREFIX);
      // Try setting again
      iframeWindow.BROWSERGYM_IFRAME_PREFIX = prefixValue;
    }

    // Listen for injection completion event from the iframe
    const injectionCompleteHandler = (event) => {
      console.log(`✅ BrowserGym injection complete in iframe${iframeIndex}:`, event.detail);
      if (event.detail?.success) {
        console.log(`✅ Iframe${iframeIndex} marked ${event.detail.elementsMarked || 0} elements with prefix "${event.detail.prefix}"`);
      } else {
        console.error(`❌ Iframe${iframeIndex} injection failed:`, event.detail?.error);
      }
      iframeDoc.removeEventListener('browsergym-injection-complete', injectionCompleteHandler);
    };
    iframeDoc.addEventListener('browsergym-injection-complete', injectionCompleteHandler, { once: true });

    // Set prefix again right before injection to ensure it's available
    // Small delay to ensure property is accessible before script executes
    setTimeout(() => {
      // Re-set prefix right before injection to ensure it's available
      iframeWindow.BROWSERGYM_IFRAME_PREFIX = prefixValue;
      console.log(`🔧 Re-verified prefix before injection:`, iframeWindow.BROWSERGYM_IFRAME_PREFIX);
      
      // Inject the BrowserGym script into the iframe
      const script = iframeDoc.createElement('script');
      script.src = scriptUrl;
      // Store prefix in data attribute as backup (in case window property isn't accessible)
      script.setAttribute('data-iframe-prefix', prefixValue);
      script.onload = () => {
        console.log(`📜 BrowserGym script loaded in iframe${iframeIndex} with prefix "iframe${iframeIndex}_"`);
        console.log(`🔍 Iframe document ready state after load: ${iframeDoc.readyState}`);
        
        // Verify prefix is accessible from iframe's window context
        try {
          const prefixFromIframe = iframeWindow.BROWSERGYM_IFRAME_PREFIX;
          console.log(`🔍 Prefix verification - From content script:`, iframeWindow.BROWSERGYM_IFRAME_PREFIX);
          console.log(`🔍 Prefix verification - From iframe window:`, prefixFromIframe);
          console.log(`🔍 Prefix verification - Type:`, typeof prefixFromIframe);
          console.log(`🔍 Prefix verification - Expected: "iframe${iframeIndex}_"`);
          console.log(`🔍 Prefix verification - Match:`, prefixFromIframe === `iframe${iframeIndex}_`);
          
          if (!prefixFromIframe || prefixFromIframe !== `iframe${iframeIndex}_`) {
            console.error(`❌ PREFIX MISMATCH! Setting it again...`);
            iframeWindow.BROWSERGYM_IFRAME_PREFIX = `iframe${iframeIndex}_`;
            console.log(`🔧 Re-set prefix to:`, iframeWindow.BROWSERGYM_IFRAME_PREFIX);
          }
        } catch (e) {
          console.error(`❌ Error accessing prefix from iframe window:`, e);
        }
        
        // Wait a bit longer for the script to execute and mark elements
        setTimeout(() => {
          const elementsWithBid = iframeDoc.querySelectorAll('[data-bid]');
          console.log(`🔍 Found ${elementsWithBid.length} elements with data-bid in iframe${iframeIndex}`);
          
          if (elementsWithBid.length > 0) {
            const sampleElement = elementsWithBid[0];
            console.log(`✅ Sample iframe BID:`, sampleElement.getAttribute('data-bid'));
          } else {
            console.warn(`⚠️ No elements with data-bid found in iframe${iframeIndex}!`);
            console.warn(`⚠️ Total elements in iframe: ${iframeDoc.querySelectorAll('*').length}`);
            console.warn(`⚠️ Iframe prefix available:`, iframeWindow.BROWSERGYM_IFRAME_PREFIX);
            console.warn(`⚠️ BrowserGym initialized flag:`, iframeWindow.browserGymInitialized);
          }
        }, 500); // Increased delay to allow script execution
      };
      script.onerror = () => {
        console.error(`❌ Failed to inject BrowserGym script into iframe${iframeIndex}`);
        iframeDoc.removeEventListener('browsergym-injection-complete', injectionCompleteHandler);
      };
      (iframeDoc.head || iframeDoc.documentElement)?.appendChild(script);
    }, 50);
  } catch (err) {
    console.warn('Failed to inject BrowserGym into iframe:', err);
  }
}

// Find and instrument all existing iframes (including in Shadow DOMs)
export function instrumentAllIframes(retryCount = 0, preAttachFn, attachDomFn) {
  try {
    // Get iframes from main document
    let iframes = Array.from(document.querySelectorAll('iframe, frame'));
    
    // Also search inside Shadow DOMs
    const searchShadowRoots = (root) => {
      const elements = root.querySelectorAll('*');
      elements.forEach(el => {
        if (el.shadowRoot) {
          // Found a shadow root, search for iframes inside it
          const shadowIframes = el.shadowRoot.querySelectorAll('iframe, frame');
          iframes.push(...Array.from(shadowIframes));
          // Recursively search nested shadow roots
          searchShadowRoots(el.shadowRoot);
        }
      });
    };
    
    searchShadowRoots(document);
    
    console.log(`Found ${iframes.length} iframes to instrument (attempt ${retryCount + 1})`);
    
    if (iframes.length === 0 && retryCount < 5) {
      // Retry after a delay to catch iframes that load after initial DOM ready
      console.log(`No iframes found yet, retrying in ${(retryCount + 1) * 500}ms...`);
      setTimeout(() => instrumentAllIframes(retryCount + 1, preAttachFn, attachDomFn), (retryCount + 1) * 500);
      return;
    }
    
    if (iframes.length > 0) {
      console.log(`📍 Instrumenting ${iframes.length} iframes:`, iframes.map(f => f.id || f.name || '<unnamed>'));
    }
    
    iframes.forEach(iframe => {
      instrumentIframe(iframe, preAttachFn, attachDomFn);
    });
  } catch (err) {
    console.error('Error finding iframes:', err);
  }
}

