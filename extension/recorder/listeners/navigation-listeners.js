// Navigation event listeners management

import { handleNavigation, handleBeforeUnload } from '../capture/navigation-recorder.js';

const activeNavigationListeners = new Map();

export const NAVIGATION_HANDLER_MAP = {
  popstate: handleNavigation,
  pushState: handleNavigation,
  replaceState: handleNavigation,
  beforeunload: handleBeforeUnload
};

export function attachNavigationListeners(enabledNavigationEvents) {
  enabledNavigationEvents.forEach(({ name }) => {
    const handler = NAVIGATION_HANDLER_MAP[name];
    if (!handler) {
      console.warn(`No navigation handler mapped for ${name}`);
      return;
    }
    const listenerOptions = name === 'beforeunload' ? false : true;
    window.addEventListener(name, handler, listenerOptions);
    activeNavigationListeners.set(name, { handler, options: listenerOptions });
  });
}

export function detachNavigationListeners() {
  activeNavigationListeners.forEach(({ handler, options }, eventName) => {
    window.removeEventListener(eventName, handler, options);
  });
  activeNavigationListeners.clear();
}

export function getActiveNavigationListeners() {
  return activeNavigationListeners;
}

