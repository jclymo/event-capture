// HTML capture functionality

import { isHtmlCaptureEnabled } from '../config/event-config.js';
import { HTMLCOOLDOWN } from '../config/constants.js';

let lastHtmlCapture = 0;
let isNewPageLoad = true;
let htmlCaptureLocked = false;
let HTMLCOOLDOWNOVERRIDE = Date.now() - 3000;
let browserGymReady = false;
let pendingHtmlCaptures = [];

// Listen for BrowserGym injection completion
if (typeof document !== 'undefined') {
  document.addEventListener('browsergym-injection-complete', (event) => {
    console.log('✅ BrowserGym injection complete, enabling HTML capture');
    browserGymReady = true;
    
    // Process any pending captures
    if (pendingHtmlCaptures.length > 0) {
      console.log(`📤 Processing ${pendingHtmlCaptures.length} pending HTML captures`);
      pendingHtmlCaptures.forEach(({ eventType, sourceDocument }) => {
        requestHtmlCapture(eventType, sourceDocument);
      });
      pendingHtmlCaptures = [];
    }
  }, { once: true });
  
  // Fallback: assume ready after 3 seconds if event never fires
  setTimeout(() => {
    if (!browserGymReady) {
      console.warn('⚠️ BrowserGym injection timeout, enabling HTML capture anyway');
      browserGymReady = true;
      // Process pending captures
      if (pendingHtmlCaptures.length > 0) {
        pendingHtmlCaptures.forEach(({ eventType, sourceDocument }) => {
          requestHtmlCapture(eventType, sourceDocument);
        });
        pendingHtmlCaptures = [];
      }
    }
  }, 3000);
}

export function setBrowserGymReady(ready) {
  browserGymReady = ready;
}

export function requestHtmlCapture(eventType, sourceDocument = document) {
  // If BrowserGym isn't ready yet, queue the capture
  if (!browserGymReady && eventType !== 'new page loaded') {
    console.log(`⏳ Queueing HTML capture for ${eventType} (waiting for BrowserGym BIDs)`);
    pendingHtmlCaptures.push({ eventType, sourceDocument });
    return;
  }
  if (htmlCaptureLocked) {
    return;
  }
  htmlCaptureLocked = true;
  const now = Date.now();
  
  // Always capture immediately on first page load, otherwise require gap between
  if (isNewPageLoad || (now - HTMLCOOLDOWNOVERRIDE) < 250 || (now - lastHtmlCapture) >= HTMLCOOLDOWN) {
    lastHtmlCapture = Date.now();
    captureHtml(eventType, sourceDocument);
    isNewPageLoad = false;
  }
  // else ignore this event

  htmlCaptureLocked = false;
}

export function captureHtml(eventType, sourceDocument = document) {
  if (!isHtmlCaptureEnabled()) {
    return;
  }
  console.log('XXXXX approved html capture')

  const doc = sourceDocument || document;
  const clone = doc.documentElement.cloneNode(true);

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
  const currentHtml =
    '<!DOCTYPE html>\n' +
    clone.outerHTML
      .replace(/\s+/g, ' ')   // collapse whitespace
      .replace(/> </g, '><'); // remove inter-tag spaces
  
  chrome.runtime.sendMessage({ 
    type: 'htmlCapture', 
    event: {
      html: currentHtml,
      type: 'htmlCapture',
      eventType: eventType,
      timestamp: Date.now(),
      url: (doc.defaultView && doc.defaultView.location)
        ? doc.defaultView.location.href
        : window.location.href
    } 
  });
  if (eventType ==="change") {
    HTMLCOOLDOWNOVERRIDE = Date.now();
  }
}

export function resetPageLoadFlag() {
  isNewPageLoad = true;
}

// Setup DOM content loaded listener
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', function() {
    isNewPageLoad = true;
    requestHtmlCapture('new page loaded');
  });
}

