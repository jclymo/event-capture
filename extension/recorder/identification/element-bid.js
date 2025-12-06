// BrowserGym BID generation and retrieval

import { hashString } from '../utils/helpers.js';

// Track if we've already attempted re-marking for this call
let isRemarkingInProgress = false;

// Helper to get element info for logging
function getElementInfo(element) {
  if (!element) return { error: 'null element' };
  try {
    return {
      tag: element.tagName?.toLowerCase() || 'unknown',
      id: element.id || null,
      classes: (typeof element.className === 'string' ? element.className : '').substring(0, 80) || null,
      text: element.textContent?.trim().substring(0, 40) || null,
      name: element.getAttribute?.('name') || null,
      role: element.getAttribute?.('role') || null
    };
  } catch (e) {
    return { error: e.message };
  }
}

// Function to trigger BrowserGym re-marking
async function triggerBrowserGymRemark(element) {
  return new Promise((resolve) => {
    if (isRemarkingInProgress) {
      // Already remarking, wait a bit and resolve
      setTimeout(resolve, 100);
      return;
    }

    isRemarkingInProgress = true;

    // Use element's owner document (handles iframes correctly)
    const targetDoc = element.ownerDocument || document;
    const isIframe = targetDoc !== document;
    
    if (isIframe) {
      console.log('🔍 Re-marking in iframe document');
    }

    // Listen for re-mark completion
    const completionHandler = (event) => {
      console.log('🔄 Re-mark triggered from getStableBID:', event.detail);
      isRemarkingInProgress = false;
      targetDoc.removeEventListener('browsergym-remark-complete', completionHandler);
      resolve();
    };

    const timeoutHandler = () => {
      console.warn('⚠️ Re-mark timeout in getStableBID:', {
        element: getElementInfo(element),
        isIframe: isIframe,
        url: targetDoc.location?.href?.substring(0, 100) || 'unknown'
      });
      isRemarkingInProgress = false;
      targetDoc.removeEventListener('browsergym-remark-complete', completionHandler);
      resolve();
    };

    targetDoc.addEventListener('browsergym-remark-complete', completionHandler, { once: true });
    
    // Dispatch re-mark request on the correct document
    targetDoc.dispatchEvent(new CustomEvent('browsergym-remark-request', {
      detail: { timestamp: Date.now(), source: 'getStableBID' }
    }));

    // Timeout after 1 second (reduced from 2 seconds)
    setTimeout(timeoutHandler, 1000);
  });
}

// Function to get stable BID for an element (BrowserGym)
export async function getStableBID(element) {
  // First try to get BrowserGym injected BID
  if (element.hasAttribute('data-bid')) {
    return element.getAttribute('data-bid');
  }
  
  // If no data-bid, trigger re-marking and retry once
  console.log('📍 No data-bid found, triggering BrowserGym re-mark for:', getElementInfo(element));
  
  try {
    await triggerBrowserGymRemark(element);
    
    // Wait a bit for the marking to complete
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Retry getting data-bid
    if (element.hasAttribute('data-bid')) {
      console.log('✅ Got data-bid after re-mark:', element.getAttribute('data-bid'));
      return element.getAttribute('data-bid');
    } else {
      console.warn('⚠️ Still no data-bid after re-mark, using fallback');
    }
  } catch (err) {
    console.error('❌ Error during BrowserGym re-mark:', err);
  }

  // Fallback: try common attributes
  const attributes = [
    { attr: 'data-testid', prefix: 'test-' },
    { attr: 'aria-label', prefix: 'aria-' },
    { attr: 'id', prefix: 'id-' },
    { attr: 'name', prefix: 'name-' },
    { attr: 'placeholder', prefix: 'place-' },
    { attr: 'alt', prefix: 'alt-' },
    { attr: 'title', prefix: 'title-' },
    { attr: 'role', prefix: 'role-' }
  ];

  for (const { attr, prefix } of attributes) {
    const value = element.getAttribute(attr);
    if (value) {
      const fallbackBid = prefix + value.toLowerCase().replace(/[^a-z0-9]/g, '-');
      console.log(`🔖 Using fallback BID from ${attr}:`, fallbackBid);
      return fallbackBid;
    }
  }

  // Last fallback: generate a semantic hash
  const tag = element.tagName.toLowerCase();
  const classes = element.className && typeof element.className === 'string'
    ? element.className.split(/\s+/).filter(c => c).join('-')
    : '';
  const text = element.textContent ? element.textContent.trim().substring(0, 30) : '';
  const siblings = Array.from(element.parentNode?.children || []);
  const index = siblings.indexOf(element);
  const semanticId = `${tag}-${classes}-${text}-${index}`;
  const hash = hashString(semanticId);
  const hashBid = `${tag}${classes ? '-' + classes : ''}-${hash}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  console.log(`🔖 Using semantic hash fallback BID:`, hashBid, 'for element:', getElementInfo(element));
  return hashBid;
}

