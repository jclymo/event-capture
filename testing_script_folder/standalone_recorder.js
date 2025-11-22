// Standalone recorder for testing (non-extension).
// Captures DOM events in a schema similar to extension/recorder.js
// and stores them on window.__testingEvents for Playwright to read.

(function () {
  if (window.__testingRecorderInitialized) {
    return;
  }
  window.__testingRecorderInitialized = true;
  window.__testingEvents = window.__testingEvents || [];

  function isInteractiveElement(element) {
    if (!element || !element.tagName) return false;
    const interactiveTags = ['button', 'input', 'select', 'textarea', 'a'];
    const interactiveRoles = [
      'button',
      'link',
      'checkbox',
      'radio',
      'textbox',
      'combobox',
      'listbox',
      'menuitem',
    ];
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute && element.getAttribute('role');
    return (
      interactiveTags.includes(tag) ||
      (role && interactiveRoles.includes(role)) ||
      typeof element.onclick === 'function' ||
      element.getAttribute && element.getAttribute('tabindex') === '0'
    );
  }

  function getElementCssPath(element) {
    if (!element || element.nodeType !== 1) return '';
    const path = [];
    let el = element;
    while (el && el.nodeType === 1) {
      let selector = el.tagName.toLowerCase();
      if (el.id) {
        selector += '#' + el.id;
        path.unshift(selector);
        break;
      } else {
        if (el.className && typeof el.className === 'string') {
          const classes = el.className.split(/\s+/).filter(Boolean);
          if (classes.length > 0) {
            selector += '.' + classes.join('.');
          }
        }
        let sibling = el;
        let index = 1;
        while ((sibling = sibling.previousElementSibling)) {
          if (sibling.tagName === el.tagName) index++;
        }
        if (index > 1) selector += ':nth-of-type(' + index + ')';
        path.unshift(selector);
        el = el.parentNode;
      }
      if (path.length > 5) break;
    }
    return path.join(' > ');
  }

  function getElementXPath(element) {
    if (!element || element.nodeType !== 1) return '';
    if (element.id) {
      return '//*[@id="' + element.id + '"]';
    }
    if (element === document.body) {
      return '/html/body';
    }
    let ix = 0;
    const siblings = element.parentNode ? element.parentNode.childNodes : [];
    for (let i = 0; i < siblings.length; i++) {
      const sibling = siblings[i];
      if (sibling === element) {
        return (
          getElementXPath(element.parentNode) +
          '/' +
          element.tagName.toLowerCase() +
          '[' +
          (ix + 1) +
          ']'
        );
      }
      if (sibling.nodeType === 1 && sibling.tagName === element.tagName) {
        ix++;
      }
    }
    return '';
  }

  function hashString(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) + hash + str.charCodeAt(i);
    }
    return (hash >>> 0).toString(36).substring(0, 6);
  }

  function getStableBID(element) {
    if (!element) return null;
    if (element.hasAttribute && element.hasAttribute('data-bid')) {
      return element.getAttribute('data-bid');
    }
    const attributes = [
      { attr: 'data-testid', prefix: 'test-' },
      { attr: 'aria-label', prefix: 'aria-' },
      { attr: 'id', prefix: 'id-' },
      { attr: 'name', prefix: 'name-' },
      { attr: 'placeholder', prefix: 'place-' },
      { attr: 'alt', prefix: 'alt-' },
      { attr: 'title', prefix: 'title-' },
      { attr: 'role', prefix: 'role-' },
    ];
    for (const { attr, prefix } of attributes) {
      if (!element.getAttribute) continue;
      const value = element.getAttribute(attr);
      if (value) {
        return (
          prefix +
          value
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '-')
        );
      }
    }
    const tag = element.tagName ? element.tagName.toLowerCase() : 'node';
    const classes =
      element.className && typeof element.className === 'string'
        ? element.className
            .split(/\s+/)
            .filter(Boolean)
            .join('-')
        : '';
    const text = element.textContent
      ? element.textContent.trim().substring(0, 30)
      : '';
    const siblings = Array.from(
      (element.parentNode && element.parentNode.children) || []
    );
    const index = siblings.indexOf(element);
    const semanticId = tag + '-' + classes + '-' + text + '-' + index;
    const hash = hashString(semanticId);
    return (
      (tag + (classes ? '-' + classes : '') + '-' + hash)
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
    );
  }

  function getElementBoundingBox(element) {
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
        left: rect.left,
      };
    } catch (err) {
      console.warn('Failed to compute bounding box:', err);
      return null;
    }
  }

  function getAccessibleName(element) {
    if (!element || !element.getAttribute) return '';
    return (
      element.getAttribute('aria-label') ||
      element.getAttribute('alt') ||
      element.getAttribute('title') ||
      (element.textContent || '').trim().substring(0, 50) ||
      ''
    );
  }

  function getImplicitRole(element) {
    if (!element || !element.tagName) return '';
    const tagName = element.tagName.toLowerCase();
    const simpleRoleMap = {
      a: 'link',
      button: 'button',
      h1: 'heading',
      h2: 'heading',
      h3: 'heading',
      input: 'textbox',
      select: 'combobox',
      textarea: 'textbox',
      img: 'img',
      ul: 'list',
      ol: 'list',
      li: 'listitem',
    };
    return simpleRoleMap[tagName] || '';
  }

  function getSimpleA11yPath(element) {
    if (!element) return '';
    const path = [];
    let current = element;
    let depth = 0;
    const MAX_DEPTH = 5;
    while (current && current.nodeType === 1 && depth < MAX_DEPTH) {
      const role =
        (current.getAttribute && current.getAttribute('role')) ||
        getImplicitRole(current);
      const name = getAccessibleName(current);
      let segment = role || current.tagName.toLowerCase();
      if (name) {
        const shortName =
          name.length > 25 ? name.substring(0, 25) + '...' : name;
        segment += '[' + shortName + ']';
      }
      path.unshift(segment);
      current = current.parentElement;
      depth++;
    }
    return path.join(' > ');
  }

  function getA11yIdentifiers(element) {
    if (!element || !element.tagName) return {};
    return {
      role:
        (element.getAttribute && element.getAttribute('role')) ||
        getImplicitRole(element),
      name: getAccessibleName(element),
      path: getSimpleA11yPath(element),
      id: element.id || '',
      tagName: element.tagName.toLowerCase(),
    };
  }

  function getElementValueUnified(element) {
    if (!element) return '';
    if (typeof element.value !== 'undefined') {
      return element.value == null ? '' : String(element.value);
    }
    if (element.isContentEditable) {
      return (element.textContent || '').trim();
    }
    if (element.getAttribute) {
      const attrVal = element.getAttribute('value');
      if (attrVal != null) return attrVal;
    }
    return (element.textContent || '').trim();
  }

  function buildTargetMetadata(element) {
    if (!element || element.nodeType !== 1) return null;
    const attributes = {};
    if (element.attributes) {
      for (let i = 0; i < element.attributes.length; i++) {
        const attr = element.attributes[i];
        attributes[attr.name] = attr.value;
      }
    }
    let textContent = element.textContent || '';
    textContent = textContent.trim().replace(/\s+/g, ' ');
    const truncatedText =
      textContent.length > 200
        ? textContent.slice(0, 200) + '...'
        : textContent;

    let outerHTMLSnippet = null;
    let outerHTMLFull = null;
    if (typeof element.outerHTML === 'string') {
      const trimmed = element.outerHTML.trim();
      if (trimmed) {
        outerHTMLFull = trimmed;
        outerHTMLSnippet =
          trimmed.length > 3000 ? trimmed.slice(0, 3000) + '...' : trimmed;
      }
    }

    return {
      tag: element.tagName,
      id: element.id || '',
      class: element.className || '',
      text: truncatedText,
      value: getElementValueUnified(element),
      isInteractive: isInteractiveElement(element),
      xpath: getElementXPath(element),
      cssPath: getElementCssPath(element),
      bid: getStableBID(element),
      a11y: getA11yIdentifiers(element),
      attributes: attributes,
      boundingBox: getElementBoundingBox(element),
      browsergym_set_of_marks:
        element.getAttribute && element.getAttribute('browsergym_set_of_marks')
          ? element.getAttribute('browsergym_set_of_marks')
          : null,
      browsergym_visibility_ratio:
        element.getAttribute &&
        element.getAttribute('browsergym_visibility_ratio')
          ? element.getAttribute('browsergym_visibility_ratio')
          : null,
      outerHTMLSnippet: outerHTMLSnippet,
      outerHTMLFull: outerHTMLFull,
    };
  }

  function resolveTarget(node) {
    if (!node) return null;
    let element = node;
    if (element.nodeType !== 1) {
      element = element.parentElement;
    }
    if (!element) return null;
    const selector = [
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
      '[tabindex]:not([tabindex="-1"])',
    ].join(', ');
    const primary =
      element.closest && element.closest(selector) ? element.closest(selector) : element;
    return primary;
  }

  function recordEvent(e) {
    try {
      const targetElement = resolveTarget(e.target || e.srcElement);
      if (!targetElement) return;

      const metadata = buildTargetMetadata(targetElement);
      if (!metadata) return;

      const inIframe = window !== window.top;
      const eventData = {
        type: e.type,
        timestamp: Date.now(),
        url: window.location.href,
        target: metadata,
        isInIframe: inIframe,
      };

      if (
        e.type === 'click' ||
        e.type === 'mousedown' ||
        e.type === 'mouseup'
      ) {
        eventData.button = e.button;
        eventData.buttons = e.buttons;
        eventData.clientX = e.clientX;
        eventData.clientY = e.clientY;
        eventData.screenX = e.screenX;
        eventData.screenY = e.screenY;
        eventData.pageX = e.pageX;
        eventData.pageY = e.pageY;
        eventData.offsetX = e.offsetX;
        eventData.offsetY = e.offsetY;
        eventData.movementX = e.movementX;
        eventData.movementY = e.movementY;
        eventData.ctrlKey = e.ctrlKey;
        eventData.altKey = e.altKey;
        eventData.shiftKey = e.shiftKey;
        eventData.metaKey = e.metaKey;
        eventData.detail = e.detail;
      }

      if (
        e.type === 'keydown' ||
        e.type === 'keyup' ||
        e.type === 'keypress'
      ) {
        eventData.key = e.key;
        eventData.code = e.code;
        eventData.keyCode = e.keyCode;
        eventData.location = e.location;
        eventData.repeat = e.repeat;
        eventData.modifierState = {
          ctrl: e.ctrlKey,
          alt: e.altKey,
          shift: e.shiftKey,
          meta: e.metaKey,
        };
      }

      if (e.type === 'input' || e.type === 'change') {
        eventData.inputType = e.inputType;
        eventData.value = getElementValueUnified(targetElement);
      }

      if (e.type === 'scroll') {
        const target =
          targetElement === document.documentElement
            ? document.scrollingElement || document.documentElement
            : targetElement;
        if (target) {
          eventData.scroll = {
            scrollTop: target.scrollTop,
            scrollLeft: target.scrollLeft,
            scrollHeight: target.scrollHeight,
            scrollWidth: target.scrollWidth,
            clientHeight: target.clientHeight,
            clientWidth: target.clientWidth,
          };
        }
      }

      window.__testingEvents.push(eventData);
    } catch (err) {
      console.warn('standalone_recorder recordEvent error:', err);
    }
  }

  function attachListeners(doc) {
    if (!doc || !doc.addEventListener) return;
    const events = [
      'click',
      'mousedown',
      'mouseup',
      'input',
      'change',
      'keydown',
      'keyup',
      'scroll',
      'submit',
    ];
    events.forEach(function (name) {
      try {
        doc.addEventListener(name, recordEvent, true);
      } catch (err) {
        console.warn('Failed to attach listener for', name, err);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      attachListeners(document);
    });
  } else {
    attachListeners(document);
  }
})();

