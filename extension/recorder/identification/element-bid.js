// BrowserGym BID generation and retrieval

import { hashString } from '../utils/helpers.js';

// Function to get stable BID for an element (BrowserGym)
export function getStableBID(element) {
  // First try to get BrowserGym injected BID
  if (element.hasAttribute('data-bid')) {
    return element.getAttribute('data-bid');
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
      return prefix + value.toLowerCase().replace(/[^a-z0-9]/g, '-');
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
  return `${tag}${classes ? '-' + classes : ''}-${hash}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

