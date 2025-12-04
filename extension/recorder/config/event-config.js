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

  if (userConfig.htmlCapture && typeof userConfig.htmlCapture.enabled === 'boolean') {
    configClone.htmlCapture.enabled = userConfig.htmlCapture.enabled;
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

// export function isHtmlCaptureEnabled() {
//   return htmlCaptureEnabled;
// }

