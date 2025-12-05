// HTML capture functionality

import { debounce } from '../utils/helpers.js';

function combineHTMLWithIframes(topLevelHTML, iframeHTMLMap) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(topLevelHTML, 'text/html');
  
  // Find all iframes and inject their captured HTML
  const iframes = doc.querySelectorAll('iframe');
  iframes.forEach(iframe => {
    // get our iframe id
    const iframeId = iframe.getAttribute('data-iframe-index') 
                    // || iframe.id ||
                    //  window.iframeUniqueId; 
    const iframeAltId =`iframe${iframeId}_`
    if (iframeHTMLMap.has(iframeAltId)) {
      // console.log('found iframe html', iframeAltId)
      const iframeHTML = minify(iframeHTMLMap.get(iframeAltId));
      // console.log(iframeHTML)
      
      // Use srcdoc attribute to display inline HTML
      iframe.removeAttribute('src');
      iframe.setAttribute('srcdoc', iframeHTML);
    }
  });
  return doc.documentElement.outerHTML;
}

function captureFullPageHTML() {
  return new Promise((resolve) => {
    const iframeHTMLMap = new Map(); // Store iframe HTML by ID
    const iframes = document.querySelectorAll('iframe');
    const totalIframes = iframes.length;
    let responsesReceived = 0;
    let isResolved = false; 
    
    // Set up listener for iframe responses
    function handleIframeResponse(event) {
      if (event.data.type === 'observation-request-complete') {
        const { iframeId, html } = event.data;
        
        iframeHTMLMap.set(iframeId, html);
        responsesReceived++;
        
        if (responsesReceived === totalIframes) {
          isResolved = true;
          // Clean up listener
          window.removeEventListener('message', handleIframeResponse);
          
          // Get top-level HTML
          const topLevelHTML = captureHtml(document)
          
          // Combine everything
          const combinedHTML = combineHTMLWithIframes(topLevelHTML, iframeHTMLMap);
          resolve(combinedHTML);
        }
      }
    }
    
    window.addEventListener('message', handleIframeResponse);
    console.log('listener added')
    // Send request to all iframes
    iframes.forEach(iframe => {
      try {
        const iframeDoc = iframe.contentDocument;
        iframeDoc.dispatchEvent(new CustomEvent('iframe-observation-request', {
          detail: { timestamp: Date.now() }
        }));

      } catch (e) {
        console.warn('Cannot access iframe:', e);
        // Count cross-origin iframes as "responded" so we don't wait forever
        responsesReceived++;
      }
    });
    
    // Timeout safety net (in case some iframes never respond)
    setTimeout(() => {
      if (!isResolved) {  // ← Only log/resolve if not already done
        isResolved = true;      
        console.warn(`Timeout: Only received ${responsesReceived}/${totalIframes} responses`);
        window.removeEventListener('message', handleIframeResponse);
        const topLevelHTML = captureHtml(document)
        const combinedHTML = combineHTMLWithIframes(topLevelHTML, iframeHTMLMap);
        resolve(combinedHTML);
      }
    }, 3000); // 3 second timeout
  });
}

export async function captureState(eventType) {
  document.dispatchEvent(new CustomEvent('browsergym-remark-request', {
    detail: { timestamp: Date.now() }
  }));
  
  const fullHTML = await captureFullPageHTML();

  chrome.runtime.sendMessage({ 
    type: 'htmlCapture', 
    event: {
      html: fullHTML,
      type: 'htmlCapture',
      eventType: eventType,
      timestamp: Date.now(),
      url: (document.defaultView && document.defaultView.location)
        ? document.defaultView.location.href
        : window.location.href
    } 
  });
  console.log('html reported')
}

function minify(html) {
  const reducedHtml =
  '<!DOCTYPE html>\n' +
  html
    .replace(/\s+/g, ' ')   // collapse whitespace
    .replace(/> </g, '><'); // remove inter-tag spaces 
  
    return reducedHtml;
}

function captureHtml(sourceDocument = document) {
  const doc = sourceDocument || document;
  const clone = doc.documentElement.cloneNode(true);

  // Find all BID-marked elements in the LIVE DOCUMENT that could host a Shadow Root.
  // We use the live document to access the active .shadowRoot property.
  const shadowHostsInOriginalDoc = doc.querySelectorAll('*[data-bid]');
  shadowHostsInOriginalDoc.forEach(originalHost => {
    if (originalHost.shadowRoot && originalHost.shadowRoot.mode) {
      const templateToInject = serializeShadowRoot(originalHost, doc);

      // Find the corresponding host element in the CLONE using the BID
      const bid = originalHost.getAttribute('data-bid');
      const clonedHost = clone.querySelector(`*[data-bid="${bid}"]`);

      if (clonedHost && templateToInject) {
          // Temporarily inject the DSD <template> tag into the cloned host element
          clonedHost.appendChild(templateToInject.cloneNode(true));
      }
    }
  });

  // remove our injected code
  clone.querySelectorAll('script[src*="browsergym-inject.js"]').forEach(el => el.remove());

  // --- 1. Remove scripts and noscripts ---
  // clone.querySelectorAll('script, noscript').forEach(el => el.remove());
  // --- 2. Remove inline event handlers (e.g., onclick) ---
  // clone.querySelectorAll('*').forEach(el => {
  //   for (const attr of Array.from(el.attributes)) {
  //     if (attr.name.startsWith('on')) el.removeAttribute(attr.name);
  //   }
  // });
  // --- 3. Inline all stylesheets, minified ---
  let styles = [];
  try {
    styles = Array.from(doc.styleSheets);
  } catch (err) {
    console.warn('Unable to access stylesheets for HTML capture:', err);
    styles = [];
  }
  for (const sheet of styles) {
    try {
      const rules = Array.from(sheet.cssRules)
        .map(r => r.cssText.replace(/\s+/g, ' ').trim())
        .join('');
      const style = doc.createElement('style');
      style.textContent = rules;
      clone.querySelector('head').appendChild(style);
    } catch (err) {
      // Cross-origin stylesheets may not be accessible
      console.warn('Skipped stylesheet:', sheet.href);
    }
  }
  // --- 4. Remove heavy media sources ---
  // clone.querySelectorAll('img, video, source').forEach(el => {
  //   el.removeAttribute('src');
  // });
  
  // --- 5. Minify the resulting HTML ---
  const currentHtml = minify(clone.outerHTML)
  return currentHtml
}

function serializeShadowRoot(hostElement, doc) {
    const shadowRoot = hostElement.shadowRoot;
    if (!shadowRoot || !shadowRoot.mode) return null;

    // 1. Create the <template> element in the context of the original document
    const template = doc.createElement('template');
    
    // 2. Set the mode attribute for Declarative Shadow DOM (DSD)
    template.setAttribute('shadowrootmode', shadowRoot.mode);
    
    // 3. Deep-clone the Shadow Root content into the template's content fragment
    // Note: Since BIDs are injected in the page context, they should be present here.
    Array.from(shadowRoot.childNodes).forEach(node => {
        template.content.appendChild(node.cloneNode(true));
    });

    return template;
}