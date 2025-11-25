// Element utility functions

// Unified way to read an element's current value/text for inputs and contenteditable
export function getElementValueUnified(element) {
  if (!element) return '';
  if (typeof element.value !== 'undefined') {
    return element.value ?? '';
  }
  if (element.isContentEditable) {
    return (element.textContent || '').trim();
  }
  const attrVal = element.getAttribute && element.getAttribute('value');
  if (attrVal != null) return attrVal;
  return (element.textContent || '').trim();
}

// Helper to identify interactive elements that users can click or interact with
export function isInteractiveElement(element) {
  const interactiveTags = ['button', 'input', 'select', 'textarea', 'a'];
  const interactiveRoles = ['button', 'link', 'checkbox', 'radio', 'textbox', 'combobox', 'listbox', 'menuitem'];
  
  return (
    interactiveTags.includes(element.tagName.toLowerCase()) ||
    interactiveRoles.includes(element.getAttribute('role')) ||
    element.onclick != null ||
    element.getAttribute('tabindex') === '0'
  );
}

// Quick check for images and links
export function isImageOrLink(element) {
  return element.tagName.toLowerCase() === 'img' || element.tagName.toLowerCase() === 'a';
}

export function getElementBoundingBox(element) {
  if (!element || typeof element.getBoundingClientRect !== 'function') {
    return null;
  }

  try {
    const rect = element.getBoundingClientRect();
    if (!rect) return null;
    if (typeof rect.toJSON === 'function') {
      return rect.toJSON();
    }
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left
    };
  } catch (err) {
    console.error('Failed to compute bounding box:', err);
    return null;
  }
}

export function resolveEventTarget(node) {
  if (!node) {
    return { primary: null, original: null };
  }

  let element = node;
  if (element.nodeType !== Node.ELEMENT_NODE) {
    element = element.parentElement;
  }

  if (!element) {
    return { primary: null, original: null };
  }

  const interactiveSelector = [
    'button',
    'select',
    'textarea',
    'input',
    'option',
    'label',
    'summary',
    'details',
    'a[href]',
    '[role="button"]',
    '[role="link"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[role="radio"]',
    '[role="checkbox"]',
    '[role="tab"]',
    '[role="textbox"]',
    '[contenteditable]',
    '[data-action]',
    '[data-testid]',
    '[data-bid]',
    '[aria-label]',
    '[aria-labelledby]',
    '[tabindex]:not([tabindex="-1"])'
  ].join(', ');

  const primary = element.closest(interactiveSelector) || element;
  return { primary, original: element };
}

