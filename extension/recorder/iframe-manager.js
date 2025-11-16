window.RecorderIframeManager = {
  
    // State (passed from main recorder)
    _trackedIframes: null,
    _iframeObserver: null,
    _browserGymObserver: null,
    _browserGymRemarkTimeout: null,
    
    // Initialize with state references
    init(trackedIframes) {
      this._trackedIframes = trackedIframes;
    },
    
  // Function to re-mark DOM elements with BrowserGym (for dynamically added content)
  // Uses event-based communication to avoid CSP violations
  remarkWithBrowserGym: function() {
    try {
      // Dispatch a custom event that browsergym-inject.js will listen for
      // This avoids CSP violations since we're not injecting inline scripts
      document.dispatchEvent(new CustomEvent('browsergym-remark-request', {
        detail: { timestamp: Date.now() }
      }));
      console.log('📤 Sent re-mark request to BrowserGym');
    } catch (err) {
      console.error('Failed to trigger BrowserGym re-marking:', err);
    }
  },

  // Debounced version of remarkWithBrowserGym to avoid excessive calls
  debouncedRemark: function() {
    return window.RecorderDOMUtils.debounce(this.remarkWithBrowserGym, 500);
  },

  // Start observing DOM mutations for BrowserGym re-marking
  startBrowserGymObserver: function(isRecording) {
    // Stop existing observer if any
    if (this._browserGymObserver) {
      this._browserGymObserver.disconnect();
    }

    const self = this;
    this._browserGymObserver = new MutationObserver((mutations) => {
      // Check if any mutations added new elements
      const hasNewElements = mutations.some(mutation => 
        mutation.type === 'childList' && mutation.addedNodes.length > 0
      );

      if (hasNewElements && isRecording) {
        console.log('🔍 New DOM elements detected, scheduling re-mark...');
        self.debouncedRemark();
      }
    });

    // Observe the entire document for new elements
    this._browserGymObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    console.log('👁️ BrowserGym MutationObserver started');
  },

  // Stop observing DOM mutations
  stopBrowserGymObserver: function() {
    if (this._browserGymObserver) {
      this._browserGymObserver.disconnect();
      this._browserGymObserver = null;
      console.log('👁️ BrowserGym MutationObserver stopped');
    }
  },
  
    // Instrument an iframe for event capturing
    instrumentIframe: function(iframe, isRecording, preAttachCriticalListeners, attachDomListenersToDocument) {
        if (this._trackedIframes.has(iframe)) {
          console.log('Iframe already instrumented, skipping');
          return;
        }
    
        try {
          // Mark as tracked first to avoid reprocessing
          this._trackedIframes.add(iframe);
    
          // Try to access iframe's contentDocument (will fail for cross-origin iframes)
          const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    
          if (!iframeDoc) {
            console.warn('Cannot access iframe document (cross-origin or not loaded):', iframe.src);
            return;
          }
    
          console.log('📍 Instrumenting iframe:', iframe.src || '<no src>');
    
          const self = this;
          // Wait for iframe to be fully loaded
          const instrumentWhenReady = () => {
            try {
              if (iframeDoc.readyState === 'complete' || iframeDoc.readyState === 'interactive') {
                // Attach critical listeners to iframe
                if (preAttachCriticalListeners) preAttachCriticalListeners(iframeDoc);
    
                // Attach full event listeners if recording
                if (isRecording && attachDomListenersToDocument) {
                  attachDomListenersToDocument(iframeDoc);
                }
    
                // Inject BrowserGym into iframe
                self.injectBrowserGymIntoIframe(iframe);
    
                console.log('✅ Iframe instrumented successfully');
              } else {
                // Wait for DOMContentLoaded
                iframeDoc.addEventListener('DOMContentLoaded', () => {
                  if (preAttachCriticalListeners) preAttachCriticalListeners(iframeDoc);
                  if (isRecording && attachDomListenersToDocument) {
                    attachDomListenersToDocument(iframeDoc);
                  }
                  self.injectBrowserGymIntoIframe(iframe);
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
      },
    // Inject BrowserGym script into an iframe
    injectBrowserGymIntoIframe: function(iframe) {
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
  
        // Inject the BrowserGym script into the iframe
        const script = iframeDoc.createElement('script');
        script.src = chrome.runtime.getURL('bgym/browsergym-inject.js');
        script.onload = () => {
          console.log('📜 BrowserGym script loaded in iframe');
        };
        script.onerror = () => {
          console.error('❌ Failed to inject BrowserGym script into iframe');
        };
        (iframeDoc.head || iframeDoc.documentElement)?.appendChild(script);
      } catch (err) {
        console.warn('Failed to inject BrowserGym into iframe:', err);
      }
    },
  
    // Find and instrument all existing iframes
    instrumentAllIframes: function(isRecording, preAttachCriticalListeners, attachDomListenersToDocument) {
      try {
        const iframes = document.querySelectorAll('iframe, frame');
        console.log(`Found ${iframes.length} iframes to instrument`);
        iframes.forEach(iframe => {
          this.instrumentIframe(iframe, isRecording, preAttachCriticalListeners, attachDomListenersToDocument);
        });
      } catch (err) {
        console.error('Error finding iframes:', err);
      }
    },
  
    // Start observing for new iframes
    startIframeObserver: function(isRecording, preAttachCriticalListeners, attachDomListenersToDocument) {
      if (this._iframeObserver) {
        this._iframeObserver.disconnect();
      }
  
      const self = this;
      this._iframeObserver = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
          if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            mutation.addedNodes.forEach(node => {
              // Check if the added node is an iframe
              if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.tagName === 'IFRAME' || node.tagName === 'FRAME') {
                  console.log('🆕 New iframe detected');
                  self.instrumentIframe(node, isRecording, preAttachCriticalListeners, attachDomListenersToDocument);
                }
                // Check for iframes within the added node
                const iframes = node.querySelectorAll?.('iframe, frame');
                if (iframes && iframes.length > 0) {
                  console.log(`🆕 Found ${iframes.length} iframes in added content`);
                  iframes.forEach(iframe => self.instrumentIframe(iframe, isRecording, preAttachCriticalListeners, attachDomListenersToDocument));
                }
              }
            });
          }
        });
      });
  
      this._iframeObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
  
      console.log('👁️ Iframe MutationObserver started');
    },
  
    // Stop observing for iframes
    stopIframeObserver: function() {
      if (this._iframeObserver) {
        this._iframeObserver.disconnect();
        this._iframeObserver = null;
        console.log('👁️ Iframe MutationObserver stopped');
      }
    },

    injectBrowserGymScript: async function() {
        return new Promise((resolve) => {
          if (window.browserGymInitialized) {
            console.log('✅ BrowserGym already initialized');
            resolve(true);
            return;
          }
    
          let timeoutId = null;
          const cleanup = () => {
            if (timeoutId) {
              clearTimeout(timeoutId);
              timeoutId = null;
            }
            document.removeEventListener('browsergym-injection-complete', completionHandler);
          };
    
          const completionHandler = (event) => {
            cleanup();
            console.log('BrowserGym injection complete:', event.detail);
            resolve(event.detail?.success === true);
          };
    
          const signalTimeout = () => {
            cleanup();
            console.warn('⏱️ BrowserGym injection timeout');
            resolve(false);
          };
    
          document.addEventListener('browsergym-injection-complete', completionHandler, { once: true });
          timeoutId = setTimeout(signalTimeout, 3000);
    
          console.log('💉 Requesting BrowserGym injection via background');
          chrome.runtime.sendMessage({ action: 'injectBrowserGymScript' }, (response) => {
            if (chrome.runtime.lastError) {
              cleanup();
              console.error('BrowserGym injection request failed:', chrome.runtime.lastError);
              resolve(false);
              return;
            }
            if (!response || response.success !== true) {
              console.warn('BrowserGym injection response failed:', response?.error);
            }
          });
        });
      }
    };

