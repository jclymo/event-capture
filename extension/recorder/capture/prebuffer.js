// Prebuffer system for events captured before recording starts

import { PREBUFFER_WINDOW_MS } from '../config/constants.js';

export const prebufferEvents = [];

export function minimalEventSnapshot(e) {
  const base = {
    type: e.type,
    target: e.target,
    isSynthetic: true
  };
  if (e.type === 'click' || e.type === 'mousedown' || e.type === 'mouseup' || e.type === 'pointerdown' || e.type === 'pointerup' || e.type === 'selectstart') {
    base.button = e.button;
    base.buttons = e.buttons;
    base.clientX = e.clientX; base.clientY = e.clientY;
    base.screenX = e.screenX; base.screenY = e.screenY;
    base.pageX = e.pageX; base.pageY = e.pageY;
    base.offsetX = e.offsetX; base.offsetY = e.offsetY;
    base.movementX = e.movementX; base.movementY = e.movementY;
    base.ctrlKey = e.ctrlKey; base.altKey = e.altKey; base.shiftKey = e.shiftKey; base.metaKey = e.metaKey;
    base.detail = e.detail;
  }
  if (e.type === 'keydown' || e.type === 'keyup' || e.type === 'keypress') {
    base.key = e.key; base.code = e.code; base.keyCode = e.keyCode; base.location = e.location; base.repeat = e.repeat;
    base.ctrlKey = e.ctrlKey; base.altKey = e.altKey; base.shiftKey = e.shiftKey; base.metaKey = e.metaKey;
    base.getModifierState = () => false;
  }
  if (e.type === 'input' || e.type === 'change') {
    base.inputType = e.inputType;
    base.data = e.data;
  }
  return base;
}

export function addToPrebuffer(eventSnapshot) {
  prebufferEvents.push({ ts: Date.now(), ev: eventSnapshot });
  prunePrebuffer();
}

export function prunePrebuffer() {
  const now = Date.now();
  while (prebufferEvents.length && (now - prebufferEvents[0].ts) > PREBUFFER_WINDOW_MS) {
    prebufferEvents.shift();
  }
  const MAX_BUFFER = 100;
  if (prebufferEvents.length > MAX_BUFFER) {
    prebufferEvents.splice(0, prebufferEvents.length - MAX_BUFFER);
  }
}

export function flushPrebuffer(startMs, recordEventFn) {
  try {
    const cutoff = (typeof startMs === 'number' ? startMs : Date.now()) - 250; // small margin
    const items = prebufferEvents.filter(x => x.ts >= cutoff);
    if (items.length) {
      console.log('Flushing prebuffered events:', items.length);
    }
    items.forEach(({ ev }) => {
      try { recordEventFn(ev); } catch (err) { console.warn('Failed to flush prebuffered event:', err); }
    });
  } finally {
    prebufferEvents.length = 0;
  }
}

