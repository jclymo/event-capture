// Event types and default configuration constants

export const EVENT_TYPES = {
  // Form/Input events
  INPUT: 'input',
  CHANGE: 'change',
  SUBMIT: 'submit',
  
  // Mouse/Click events
  CLICK: 'click',
  MOUSE_DOWN: 'mousedown',
  MOUSE_UP: 'mouseup',
  MOUSE_OVER: 'mouseover',
  MOUSE_OUT: 'mouseout',
  
  // Pointer events
  POINTER_DOWN: 'pointerdown',
  POINTER_UP: 'pointerup',
  POINTER_MOVE: 'pointermove',
  
  // Keyboard events
  KEY_DOWN: 'keydown',
  KEY_UP: 'keyup',
  KEY_PRESS: 'keypress',
  
  // Other events
  SCROLL: 'scroll',
  NAVIGATION: 'navigation',
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
    { name: 'pageshow', enabled: true },
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
export const HTMLCOOLDOWN = 1000; // Reduced from 3000ms for more frequent captures

