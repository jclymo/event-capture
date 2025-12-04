// Event configuration loading and merging

import { DEFAULT_EVENT_CONFIG } from './constants.js';

// Re-export DEFAULT_EVENT_CONFIG so other modules can import it from here
export { DEFAULT_EVENT_CONFIG };

let cachedEventConfig = null;
let htmlCaptureEnabled = true;

export function mergeEventConfig(userConfig) {
  const configClone = JSON.parse(JSON.stringify(DEFAULT_EVENT_CONFIG));

  if (!userConfig) {
    return configClone;
  }

  if (Array.isArray(userConfig.domEvents)) {
    const existingDom = new Map(configClone.domEvents.map(evt => [evt.name, evt]));
    userConfig.domEvents.forEach(evt => {
      if (!evt || !evt.name) {
        return;
      }
      if (existingDom.has(evt.name)) {
        Object.assign(existingDom.get(evt.name), evt);
      } else {
        configClone.domEvents.push(evt);
      }
    });
  }

  if (Array.isArray(userConfig.navigationEvents)) {
    const existingNav = new Map(configClone.navigationEvents.map(evt => [evt.name, evt]));
    userConfig.navigationEvents.forEach(evt => {
      if (!evt || !evt.name) {
        return;
      }
      if (existingNav.has(evt.name)) {
        Object.assign(existingNav.get(evt.name), evt);
      } else {
        configClone.navigationEvents.push(evt);
      }
    });
  }

  if (userConfig.observers && typeof userConfig.observers.dynamicDom === 'boolean') {
    configClone.observers.dynamicDom = userConfig.observers.dynamicDom;
  }

  if (userConfig.htmlCapture) {
    if (typeof userConfig.htmlCapture.enabled === 'boolean') {
      configClone.htmlCapture.enabled = userConfig.htmlCapture.enabled;
    }
    // Merge event-specific htmlCapture settings
    if (userConfig.htmlCapture.events && typeof userConfig.htmlCapture.events === 'object') {
      if (!configClone.htmlCapture.events) {
        configClone.htmlCapture.events = {};
      }
      Object.assign(configClone.htmlCapture.events, userConfig.htmlCapture.events);
    }
  }

  return configClone;
}

export async function loadEventConfig() {
  if (cachedEventConfig) {
    return cachedEventConfig;
  }

  try {
    const configUrl = chrome.runtime.getURL('event-config.json');
    const response = await fetch(configUrl, { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error(`Failed to load event-config.json: ${response.status}`);
    }
    const userConfig = await response.json();
    cachedEventConfig = mergeEventConfig(userConfig);
  } catch (error) {
    console.warn('Falling back to default event configuration.', error);
    cachedEventConfig = mergeEventConfig(null);
  }

  htmlCaptureEnabled = !!cachedEventConfig.htmlCapture?.enabled;

  return cachedEventConfig;
}

export function clearCachedConfig() {
  cachedEventConfig = null;
}

export function getCachedConfig() {
  return cachedEventConfig;
}

export function isHtmlCaptureEnabled() {
  return htmlCaptureEnabled;
}

/**
 * Check if HTML capture is enabled for a specific event type
 * @param {string} eventType - The event type to check (e.g., 'click', 'keydown')
 * @returns {boolean} - True if HTML capture is enabled for this event type
 */
export function isHtmlCaptureEnabledForEvent(eventType) {
  if (!htmlCaptureEnabled) {
    return false;
  }
  
  if (!cachedEventConfig || !cachedEventConfig.htmlCapture) {
    return htmlCaptureEnabled; // Fallback to global setting
  }
  
  const eventConfig = cachedEventConfig.htmlCapture.events;
  if (!eventConfig || typeof eventConfig !== 'object') {
    return htmlCaptureEnabled; // No event-specific config, use global setting
  }
  
  // Check if this specific event type has htmlCapture enabled
  // If the event is explicitly set to false, return false
  // If the event is explicitly set to true, return true
  // If the event is not in the config, default to global setting
  if (eventType in eventConfig) {
    return !!eventConfig[eventType];
  }
  
  return htmlCaptureEnabled; // Default to global setting if event not specified
}

