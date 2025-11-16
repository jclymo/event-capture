window.RecorderDOMUtils = {


    // Get a CSS selector path to uniquely identify an element
  // This helps us find elements again later, even if the page changes
  getElementCssPath: function(element) {
    if (!element || element.nodeType !== 1) return '';
    
    let path = [];
    while (element && element.nodeType === 1) {
      let selector = element.tagName.toLowerCase();
      
      // If element has an ID, we can stop here - IDs are unique!
      if (element.id) {
        selector += '#' + element.id;
        path.unshift(selector);
        break;
      } else {
        // Add classes to make the selector more specific
        if (element.className && typeof element.className === 'string') {
          const classes = element.className.split(/\s+/).filter(c => c);
          if (classes.length > 0) {
            selector += '.' + classes.join('.');
          }
        }
        
        // Add position information if there are similar siblings
        let sibling = element, index = 1;
        while (sibling = sibling.previousElementSibling) {
          if (sibling.tagName === element.tagName) index++;
        }
        if (index > 1) selector += ':nth-of-type(' + index + ')';
        
        path.unshift(selector);
        element = element.parentNode;
      }
      
      // Keep the path reasonably short
      if (path.length > 5) break;
    }
    
    return path.join(' > ');
  },

  // Utility function to get element XPath
  getElementXPath: function(element) {
    if (!element || element.nodeType !== 1) return '';
    
    if (element.id !== '') {
      return `//*[@id="${element.id}"]`;
    }
    
    if (element === document.body) {
      return '/html/body';
    }
    
    let ix = 0;
    const siblings = element.parentNode.childNodes;
    for (let i = 0; i < siblings.length; i++) {
      const sibling = siblings[i];
      if (sibling === element) {
        return this.getElementXPath(element.parentNode) + '/' + element.tagName.toLowerCase() + '[' + (ix + 1) + ']';
      }
      if (sibling.nodeType === 1 && sibling.tagName === element.tagName) {
        ix++;
      }
    }
  },

  // Function to get stable BID for an element (BrowserGym)
  getStableBID: function(element) {
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
    const hash = this.hashString(semanticId);
    return `${tag}${classes ? '-' + classes : ''}-${hash}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  },


  // Element Metata
  getElementBoundingBox: function(element) {
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
  },

    // Simple function to get accessibility identifiers for an element
    getA11yIdentifiers: function(element) {
        if (!element) return {};
        
        return {
          // Role is the most important identifier in the a11y tree
          role: element.getAttribute('role') || this.getImplicitRole(element),
          
          // Name is how the element is announced (crucial for identification)
          name: this.getAccessibleName(element),
          
          // Basic path through the a11y tree (for locating in the tree)
          path: this.getSimpleA11yPath(element),
          
          // Additional identifiers that help locate the element
          id: element.id || '',
          tagName: element.tagName.toLowerCase()
        };
      },
    
      // Unified way to read an element's current value/text for inputs and contenteditable
      getElementValueUnified: function(element) {
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
      },
    
      // Get a simple path through the accessibility tree
      getSimpleA11yPath: function(element) {
        if (!element) return '';
        
        const path = [];
        let current = element;
        let depth = 0;
        const MAX_DEPTH = 5; // Limit path depth to avoid excessive length
        
        while (current && current.nodeType === 1 && depth < MAX_DEPTH) {
          const role = current.getAttribute('role') || this.getImplicitRole(current);
          const name = this.getAccessibleName(current);
          
          let pathSegment = role || current.tagName.toLowerCase();
          if (name) {
            // Include name but keep it short
            const shortName = name.length > 25 ? name.substring(0, 25) + '...' : name;
            pathSegment += `[${shortName}]`;
          }
          
          path.unshift(pathSegment);
          current = current.parentElement;
          depth++;
        }
        
        return path.join(' > ');
      },
    
      // Simple function to get accessible name
      getAccessibleName: function(element) {
        // Check common name sources in priority order
        return element.getAttribute('aria-label') || 
               element.getAttribute('alt') || 
               element.getAttribute('title') || 
               element.textContent.trim().substring(0, 50) || '';
      },
    
      // Simple function to determine implicit role
      getImplicitRole: function(element) {
        const tagName = element.tagName.toLowerCase();
        
        // Very simplified mapping of common elements to roles
        const simpleRoleMap = {
          'a': 'link',
          'button': 'button',
          'h1': 'heading',
          'h2': 'heading',
          'h3': 'heading',
          'input': 'textbox',
          'select': 'combobox',
          'textarea': 'textbox',
          'img': 'img',
          'ul': 'list',
          'ol': 'list',
          'li': 'listitem'
        };
        
        return simpleRoleMap[tagName] || '';
      },
    
    // Element Type Checks
      // Helper to identify interactive elements that users can click or interact with
  isInteractiveElement: function(element) {
    const interactiveTags = ['button', 'input', 'select', 'textarea', 'a'];
    const interactiveRoles = ['button', 'link', 'checkbox', 'radio', 'textbox', 'combobox', 'listbox', 'menuitem'];
    
    return (
      interactiveTags.includes(element.tagName.toLowerCase()) ||
      interactiveRoles.includes(element.getAttribute('role')) ||
      element.onclick != null ||
      element.getAttribute('tabindex') === '0'
    );
  },

  // Quick check for images and links
  isImageOrLink: function(element) {
    return element.tagName.toLowerCase() === 'img' || element.tagName.toLowerCase() === 'a';
  },



  // Enhanced hash function for better uniqueness
  hashString: function(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
    }
    // Convert to base36 and take first 6 characters
    return (hash >>> 0).toString(36).substring(0, 6);
  },

  resolveEventTarget: function(node) {
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
      '[role=\"button\"]',
      '[role=\"link\"]',
      '[role=\"menuitem\"]',
      '[role=\"option\"]',
      '[role=\"radio\"]',
      '[role=\"checkbox\"]',
      '[role=\"tab\"]',
      '[role=\"textbox\"]',
      '[contenteditable]',
      '[data-action]',
      '[data-testid]',
      '[data-bid]',
      '[aria-label]',
      '[aria-labelledby]',
      '[tabindex]:not([tabindex=\"-1\"])'
    ].join(', ');

    const primary = element.closest(interactiveSelector) || element;
    return { primary, original: element };
  },


  buildTargetMetadata: function(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }

    const attributes = {};
    try {
      Array.from(element.attributes || []).forEach(attr => {
        attributes[attr.name] = attr.value;
      });
    } catch (err) {
      console.warn('Failed to serialize attributes for element', element, err);
    }

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
      isInteractive: this.isInteractiveElement(element),
      xpath: this.getElementXPath(element),
      cssPath: this.getElementCssPath(element),
      bid: this.getStableBID(element),
      a11y: this.getA11yIdentifiers(element),
      attributes,
      boundingBox: this.getElementBoundingBox(element),
      browsergym_set_of_marks: element.getAttribute('browsergym_set_of_marks') || null,
      browsergym_visibility_ratio: element.getAttribute('browsergym_visibility_ratio') || null,
      outerHTMLSnippet,
      outerHTMLFull
    };
  }

    
    };    

    window.RecorderDOMUtils.debounce =   function(func, wait) {
        let timeout;
        return function executedFunction(...args) {
          const later = () => {
            clearTimeout(timeout);
            func(...args);
          };
          clearTimeout(timeout);
          timeout = setTimeout(later, wait);
        };
      }
    