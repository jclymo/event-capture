// Iframe MutationObserver for detecting new iframes

import { instrumentIframe } from './instrumentation.js';

let iframeObserver = null;

// Start observing for new iframes
export function startIframeObserver(preAttachCriticalListenersFn, attachDomListenersToDocumentFn) {
  if (iframeObserver) {
    iframeObserver.disconnect();
  }

  iframeObserver = new MutationObserver((mutations) => {
    mutations.forEach(mutation => {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        mutation.addedNodes.forEach(node => {
          // Check if the added node is an iframe
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.tagName === 'IFRAME' || node.tagName === 'FRAME') {
              console.log('🆕 New iframe detected:', node.id || node.name || '<unnamed>');
              instrumentIframe(node, preAttachCriticalListenersFn, attachDomListenersToDocumentFn);
            }
            
            // Check for iframes within the added node
            const iframes = node.querySelectorAll?.('iframe, frame');
            if (iframes && iframes.length > 0) {
              console.log(`🆕 Found ${iframes.length} iframes in added content`);
              iframes.forEach(iframe => instrumentIframe(iframe, preAttachCriticalListenersFn, attachDomListenersToDocumentFn));
            }
            
            // Check if node has Shadow DOM with iframes
            if (node.shadowRoot) {
              const shadowIframes = node.shadowRoot.querySelectorAll('iframe, frame');
              if (shadowIframes.length > 0) {
                console.log(`🆕 Found ${shadowIframes.length} iframes in Shadow DOM`);
                shadowIframes.forEach(iframe => instrumentIframe(iframe, preAttachCriticalListenersFn, attachDomListenersToDocumentFn));
              }
            }
          }
        });
      }
    });
  });

  iframeObserver.observe(document.body, {
    childList: true,
    subtree: true
  });

  console.log('👁️ Iframe MutationObserver started');
}

// Stop observing for iframes
export function stopIframeObserver() {
  if (iframeObserver) {
    iframeObserver.disconnect();
    iframeObserver = null;
    console.log('👁️ Iframe MutationObserver stopped');
  }
}

