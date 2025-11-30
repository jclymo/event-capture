// Build complete element metadata

import { getElementXPath, getElementCssPath } from './element-selectors.js';
import { getStableBID } from './element-bid.js';
import { getA11yIdentifiers } from './a11y.js';
import { isInteractiveElement, getElementBoundingBox } from '../utils/element-utils.js';

export function buildTargetMetadata(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const attributes = {};
  // JUDE: this is collecting some pretty big attributes that we then never use. removing to improve speed
  // try {
  //   Array.from(element.attributes || []).forEach(attr => {
  //     attributes[attr.name] = attr.value;
  //   });
  // } catch (err) {
  //   console.warn('Failed to serialize attributes for element', element, err);
  // }

  let textContent = element.textContent || '';
  textContent = textContent.trim().replace(/\s+/g, ' ');
  const truncatedText = textContent.length > 200 ? `${textContent.slice(0, 200)}...` : textContent;

  let outerHTMLSnippet = null;
  let outerHTMLFull = null;
  if (typeof element.outerHTML === 'string') {
    const trimmedOuter = element.outerHTML.trim();
    if (trimmedOuter) {
      outerHTMLFull = trimmedOuter;
      outerHTMLSnippet = trimmedOuter.length > 3000
        ? `${trimmedOuter.slice(0, 3000)}...`
        : trimmedOuter;
    }
  }

  return {
    tag: element.tagName,
    id: element.id,
    class: element.className,
    text: truncatedText,
    value: element.value,
    isInteractive: isInteractiveElement(element),
    xpath: getElementXPath(element),
    cssPath: getElementCssPath(element),
    bid: getStableBID(element),
    a11y: getA11yIdentifiers(element),
    attributes,
    boundingBox: getElementBoundingBox(element),
    browsergym_set_of_marks: element.getAttribute('browsergym_set_of_marks') || null,
    browsergym_visibility_ratio: element.getAttribute('browsergym_visibility_ratio') || null,
    outerHTMLSnippet,
    outerHTMLFull
  };
}

