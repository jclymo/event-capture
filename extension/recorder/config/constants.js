// Event types and default configuration constants

export const EVENT_TYPES = {
  INPUT: 'input',
  CLICK: 'click',
  NAVIGATION: 'navigation',
  SCROLL: 'scroll',
  SUBMIT: 'submit',
  CHANGE: 'change',
};

export const DEFAULT_EVENT_CONFIG = {
  domEvents: [
    { name: 'click', enabled: true, handler: 'recordEvent' },
    { name: 'pointerdown', enabled: true, handler: 'recordEvent' },
    { name: 'selectstart', enabled: true, handler: 'recordEvent' },
    { name: 'keydown', enabled: true, handler: 'recordEvent' },
    { name: 'scroll', enabled: true, handler: 'debouncedRecordScroll' },
    { name: 'input', enabled: true, handler: 'debouncedRecordInput' },
    { name: 'change', enabled: true, handler: 'debouncedRecordInput' },
    { name: 'submit', enabled: true, handler: 'recordEvent' },
  ],
  navigationEvents: [
    { name: 'popstate', enabled: true },
    { name: 'pushState', enabled: true },
    { name: 'replaceState', enabled: true },
    { name: 'beforeunload', enabled: true }
  ],
  observers: {
    dynamicDom: true
  },
  htmlCapture: {
    enabled: true
  }
};

export const PREBUFFER_WINDOW_MS = 2000;
export const HTMLCOOLDOWN = 3000;

