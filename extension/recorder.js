// Content script that captures user interactions on the active page.
//
// Purpose: Attach configurable DOM and navigation listeners to capture
// meaningful user interactions (e.g., clicks, inputs, navigations) and send
// normalized event objects to the background script for persistence.
//
// What it does:
// - Loads `event-config.json` to decide which listeners to attach.
// - Records events with stable element identifiers (CSS, XPath, semantics).
// - Handles navigation and dynamic DOM changes where enabled by config.
// - Streams events to the background via chrome.runtime messaging.

// We wrap everything in an IIFE (Immediately Invoked Function Expression) 


(function() {
  // Check if we've already initialized to prevent duplicate initialization
  if (window.taskRecorderInitialized) {
    console.log("Recorder already initialized, skipping initialization");
    return;
  }
  
  // Mark as initialized
  window.taskRecorderInitialized = true;
  console.log("Recorder script loaded and initialized");

  // Private variables within this closure
  let events = [];
  let isRecording = false;
  let currentTaskId = null;
  let dynamicObserver = null; // Properly declare the observer variable

  const formStateTracker = {
    dropdowns: new Map(),           // id -> current value
    inputs: new Map(),              // id -> current value  
    checkboxes: new Map(),          // id -> checked state
    checkboxGroups: new Map(),      // name -> array of checked values
    radioGroups: new Map(),         // name -> selected value
    initialized: false
  };


  console.log('🐛 Debug available: window.debugFormState.getState()');
  // =========================================
  // Add debouncing utility
  function debounce(func, wait) {
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

  // Keep track of the last event to avoid duplicates
  const lastEventData = {
    type: null,
    target: null,
    value: null,
    timestamp: 0,
    lastInputValue: null
  };

  // Track page navigation to handle URL changes smoothly
  const navigationState = {
    lastUrl: null,
    lastTitle: null,
    pendingNavigation: false
  };

  // Error recovery system - Dont fail :((
  const recoveryState = {
    lastSavedTimestamp: Date.now(),
    errorCount: 0,
    maxErrors: 3  // We'll try 3 times before giving up
  };

  // All the different types of events we can capture
  // This is like our dictionary of possible user actions
  const EVENT_TYPES = {
    PAGE_LOAD: 'pageLoad',    // When a page first loads
    INPUT: 'input',          // When user types or changes input
    CLICK: 'click',          // Mouse clicks
    NAVIGATION: 'navigation', // Page navigation
    FOCUS: 'focus',          // When an element gets focus
    MOUSE_OVER: 'mouseover', // Mouse hovering over elements
    MOUSE_OUT: 'mouseout',   // Mouse leaving elements
    KEY_DOWN: 'keydown',     // Keyboard key press
    KEY_UP: 'keyup',         // Keyboard key release
    KEY_PRESS: 'keypress',   // Character input
    SCROLL: 'scroll',        // Page scrolling
    SUBMIT: 'submit',        // Form submissions
    CHANGE: 'change',        // Value changes
    BLUR: 'blur',           // Element losing focus
    TOUCH_START: 'touchstart', // Mobile touch start
    TOUCH_END: 'touchend',    // Mobile touch end
    TOUCH_MOVE: 'touchmove'   // Mobile touch movement
  };

  const DEFAULT_EVENT_CONFIG = {
    domEvents: [
      { name: 'click', enabled: true, handler: 'recordEvent' },
      { name: 'mousedown', enabled: true, handler: 'recordEvent' },
      { name: 'mouseup', enabled: true, handler: 'recordEvent' },
      { name: 'mouseover', enabled: true, handler: 'recordEvent' },
      { name: 'mouseout', enabled: true, handler: 'recordEvent' },
      { name: 'keydown', enabled: true, handler: 'recordEvent' },
      { name: 'keyup', enabled: true, handler: 'recordEvent' },
      { name: 'keypress', enabled: true, handler: 'recordEvent' },
      { name: 'scroll', enabled: true, handler: 'debouncedRecordScroll' },
      { name: 'input', enabled: true, handler: 'debouncedRecordInput' },
      { name: 'change', enabled: true, handler: 'debouncedRecordInput' },
      { name: 'focus', enabled: true, handler: 'recordEvent' },
      { name: 'blur', enabled: true, handler: 'recordEvent' },
      { name: 'submit', enabled: true, handler: 'recordEvent' },
      { name: 'touchstart', enabled: true, handler: 'recordEvent' },
      { name: 'touchend', enabled: true, handler: 'recordEvent' },
      { name: 'touchmove', enabled: true, handler: 'recordEvent' }
    ],
    navigationEvents: [
      { name: 'popstate', enabled: true },
      { name: 'pushState', enabled: true },
      { name: 'replaceState', enabled: true },
      { name: 'beforeunload', enabled: true }
    ],
    observers: {
      dynamicDom: true
    }
  };

  let cachedEventConfig = null;
  const activeDomListeners = new Map();
  const activeNavigationListeners = new Map();

  function mergeEventConfig(userConfig) {
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

    return configClone;
  }

  async function loadEventConfig() {
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

    return cachedEventConfig;
  }

  const debouncedRecordInput = debounce((e) => {
    if (e.target.value !== lastEventData.lastInputValue) {
      recordEvent(e);
    }
  }, 500);

  const debouncedRecordScroll = debounce((e) => {
    recordEvent(e);
  }, 100);

  // Track click behavior to handle double-clicks and rapid clicks
  const clickState = {
    lastClickTime: 0,
    lastClickTarget: null,
    clickCount: 0
  };

  // Verify that our event capture is working correctly
  const eventVerification = {
    clicks: [],
    inputs: [],
    navigations: [],
    lastEventTime: 0
  };

  // Test mode settings for debugging and validation
  const testMode = {
    enabled: true,
    validationQueue: [],
    lastValidationTime: 0,
    validationInterval: 1000, // Check every second
    maxQueueSize: 100        // Don't let the queue get too big
  };

  // Format timestamps in a consistent way
  function formatTimestamp(timestamp) {
    return new Date(timestamp).toISOString();
  }

  // This function helps us decide if we should ignore an event
  // We don't want to record every tiny movement or duplicate actions
  function shouldIgnoreEvent(event, type) {
    const element = event.target;
    const currentValue = element.value || '';
    const currentTime = Date.now();
    
    // Special handling for clicks - we want to be smart about what clicks we record
    if (type === EVENT_TYPES.CLICK || type === 'mouseup') {
        // Ignore super quick double-clicks (less than 25ms apart)
        if (currentTime - clickState.lastClickTime < 25 && 
            element === clickState.lastClickTarget) {
            return true;
        }

        // Remember this click for next time
        clickState.lastClickTime = currentTime;
        clickState.lastClickTarget = element;
        clickState.clickCount++;
        
        // Log what we clicked on - helpful for debugging
        console.log(`Click detected on:`, {
            element: element.tagName,
            id: element.id,
            class: element.className,
            text: element.textContent.trim().substring(0, 50),
            clickCount: clickState.clickCount,
            type: type,
            timestamp: new Date(currentTime).toISOString(),
            button: event.button,  // Which mouse button was used
            buttons: event.buttons // State of all mouse buttons
        });

        // Always record clicks on interactive elements (buttons, links, etc.)
        if (isInteractiveElement(element)) {
            return false;
        }
    }
    
    // Handle input events - we only care about actual changes
    if (type === EVENT_TYPES.INPUT) {
        // Skip if the value hasn't changed
        if (currentValue === lastEventData.lastInputValue) {
            return true;
        }
        // Remember this value for next time
        lastEventData.lastInputValue = currentValue;
    }

    // Handle scroll events - we only care about significant scrolling
    if (type === EVENT_TYPES.SCROLL) {
        const scrollThreshold = 50; // pixels
        if (Math.abs(event.deltaY) < scrollThreshold) {
            return true; // Ignore tiny scrolls
        }
    }

    // Handle mouse hover events - only record for interactive elements or tooltips
    if (type === EVENT_TYPES.MOUSE_OVER || type === EVENT_TYPES.MOUSE_OUT) {
        if (!isInteractiveElement(element) && !element.hasAttribute('title')) {
            return true; // Ignore hovering over regular text
        }
    }

    // Check for duplicate events within a short time window
    if (lastEventData.type === type && 
        lastEventData.target === element && 
        currentTime - lastEventData.timestamp < 300) {
        return true; // Ignore duplicates within 300ms
    }
    
    // Update our memory of the last event
    lastEventData.type = type;
    lastEventData.target = element;
    lastEventData.value = currentValue;
    lastEventData.timestamp = currentTime;
    
    return false;
  }

  // Helper to identify interactive elements that users can click or interact with
  function isInteractiveElement(element) {
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
  function isImageOrLink(element) {
    return element.tagName.toLowerCase() === 'img' || element.tagName.toLowerCase() === 'a';
  }

  // Get a CSS selector path to uniquely identify an element
  // This helps us find elements again later, even if the page changes
  function getElementCssPath(element) {
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
  }

  // Utility function to get element XPath
  function getElementXPath(element) {
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
        return getElementXPath(element.parentNode) + '/' + element.tagName.toLowerCase() + '[' + (ix + 1) + ']';
      }
      if (sibling.nodeType === 1 && sibling.tagName === element.tagName) {
        ix++;
      }
    }
  }

  // Function to get stable BID for an element
  function getStableBID(element) {
    // First try to get a stable ID from common attributes
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

    // Fallback: always generate a semantic hash
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

  // Enhanced hash function for better uniqueness
  function hashString(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
    }
    // Convert to base36 and take first 6 characters
    return (hash >>> 0).toString(36).substring(0, 6);
  }

  // Helper function to get a stable identifier for an element
  function getElementIdentifier(element) {
    // Priority: id > name > bid > generated
    return element.id || 
          element.name || 
          getStableBID(element) || 
          `element-${Math.random().toString(36).substr(2, 9)}`;
  }

  
  // Function to verify and log event capture
  function verifyEventCapture(event, type) {
    const currentTime = Date.now();
    const element = event.target;
    
    // Enhanced logging for click events
    if (type === EVENT_TYPES.CLICK) {
        console.log(`Click verification:`, {
            type: type,
            element: {
                tag: element.tagName,
                id: element.id,
                class: element.className,
                text: element.textContent.trim().substring(0, 50),
                value: element.value || '',
                isInteractive: isInteractiveElement(element)
            },
            time: new Date(currentTime).toISOString(),
            url: window.location.href,
            clickCount: clickState.clickCount
        });
    } else {
        // Log all other events for verification
        console.log(`Event detected:`, {
            type: type,
            element: {
                tag: element.tagName,
                id: element.id,
                class: element.className,
                text: element.textContent.trim().substring(0, 50),
                value: element.value || ''
            },
            time: new Date(currentTime).toISOString(),
            url: window.location.href
        });
    }

    // Track different event types
    switch(type) {
        case EVENT_TYPES.CLICK:
            eventVerification.clicks.push({
                time: currentTime,
                element: {
                    tag: element.tagName,
                    id: element.id,
                    text: element.textContent.trim().substring(0, 50),
                    isInteractive: isInteractiveElement(element)
                },
                url: window.location.href
            });
            break;
        case EVENT_TYPES.INPUT:
            eventVerification.inputs.push({
                time: currentTime,
                element: {
                    tag: element.tagName,
                    id: element.id,
                    value: element.value
                }
            });
            break;
        case EVENT_TYPES.NAVIGATION:
            eventVerification.navigations.push({
                time: currentTime,
                fromUrl: navigationState.lastUrl,
                toUrl: window.location.href
            });
            break;
    }

    // Log verification state periodically
    if (currentTime - eventVerification.lastEventTime > 1000) {
        console.log('Event Capture Verification:', {
            totalClicks: eventVerification.clicks.length,
            totalInputs: eventVerification.inputs.length,
            totalNavigations: eventVerification.navigations.length,
            lastMinute: {
                clicks: eventVerification.clicks.filter(c => currentTime - c.time < 60000).length,
                inputs: eventVerification.inputs.filter(i => currentTime - i.time < 60000).length,
                navigations: eventVerification.navigations.filter(n => currentTime - n.time < 60000).length
            },
            clickState: {
                lastClickTime: new Date(clickState.lastClickTime).toISOString(),
                clickCount: clickState.clickCount
            }
        });
        eventVerification.lastEventTime = currentTime;
    }
  }

  // Function to validate event capture
  function validateEventCapture(event, type) {
    if (!testMode.enabled) return;

    const validation = {
      timestamp: Date.now(),
      type: type,
      element: {
        tag: event.target.tagName,
        id: event.target.id,
        class: event.target.className,
        text: event.target.textContent.trim().substring(0, 50),
        value: event.target.value || ''
      },
      url: window.location.href,
      verified: false
    };

    // Add to validation queue
    testMode.validationQueue.push(validation);
    if (testMode.validationQueue.length > testMode.maxQueueSize) {
      testMode.validationQueue.shift(); // Remove oldest
    }

    // Log validation attempt
    console.log(`Event validation attempt:`, validation);

    // Verify against recorded events
    const matchingEvent = events.find(e => 
      e.timestamp === formatTimestamp(validation.timestamp) &&
      e.type === validation.type &&
      e.url === validation.url
    );

    if (matchingEvent) {
      validation.verified = true;
      console.log(`Event validation SUCCESS:`, {
        type: validation.type,
        element: validation.element,
        timestamp: validation.timestamp
      });
    } else {
      console.warn(`Event validation FAILED:`, {
        type: validation.type,
        element: validation.element,
        timestamp: validation.timestamp
      });
    }

    return validation.verified;
  }

  // Enhanced function to record an event
  function recordEvent(event) {
    if (!isRecording) return;
    
    // Create event object with BrowserGym-like structure
    const eventData = {
      type: event.type,
      timestamp: Date.now(),
      url: window.location.href,
      target: {
        tag: event.target.tagName,
        id: event.target.id,
        class: event.target.className,
        text: event.target.textContent,
        value: event.target.value,
        isInteractive: isInteractiveElement(event.target),
        xpath: getElementXPath(event.target),
        cssPath: getElementCssPath(event.target),
        bid: getStableBID(event.target),
        a11y: getA11yIdentifiers(event.target),
        attributes: Array.from(event.target.attributes).reduce((acc, attr) => {
          acc[attr.name] = attr.value;
          return acc;
        }, {}),
        boundingBox: event.target.getBoundingClientRect().toJSON()
      }
    };

    // Add event-specific data
    if (event.type === 'click') {
      eventData.button = event.button;
      eventData.buttons = event.buttons;
      eventData.clientX = event.clientX;
      eventData.clientY = event.clientY;
      eventData.screenX = event.screenX;
      eventData.screenY = event.screenY;
      eventData.pageX = event.pageX;
      eventData.pageY = event.pageY;
      eventData.offsetX = event.offsetX;
      eventData.offsetY = event.offsetY;
      eventData.movementX = event.movementX;
      eventData.movementY = event.movementY;
      eventData.ctrlKey = event.ctrlKey;
      eventData.altKey = event.altKey;
      eventData.shiftKey = event.shiftKey;
      eventData.metaKey = event.metaKey;
      eventData.detail = event.detail; // For double clicks
    }

    // Send event to background script
    chrome.runtime.sendMessage({ type: 'recordedEvent', event: eventData });

    // Also store locally for verification
    events.push(eventData);

    // Log click events for debugging
    if (event.type === 'click') {
      console.log('Click recorded:', {
        type: event.type,
        target: {
          tag: event.target.tagName,
          id: event.target.id,
          class: event.target.className,
          text: event.target.textContent.trim().substring(0, 50),
          isInteractive: isInteractiveElement(event.target),
          bid: eventData.target.bid
        },
        position: {
          client: { x: event.clientX, y: event.clientY },
          screen: { x: event.screenX, y: event.screenY },
          page: { x: event.pageX, y: event.pageY }
        },
        buttons: {
          button: event.button,
          buttons: event.buttons,
          detail: event.detail
        },
        modifiers: {
          ctrl: event.ctrlKey,
          alt: event.altKey,
          shift: event.shiftKey,
          meta: event.metaKey
        },
        timestamp: new Date(eventData.timestamp).toISOString()
      });
    }
  }

  // Simple function to get accessibility identifiers for an element
  function getA11yIdentifiers(element) {
    if (!element) return {};
    
    return {
      // Role is the most important identifier in the a11y tree
      role: element.getAttribute('role') || getImplicitRole(element),
      
      // Name is how the element is announced (crucial for identification)
      name: getAccessibleName(element),
      
      // Basic path through the a11y tree (for locating in the tree)
      path: getSimpleA11yPath(element),
      
      // Additional identifiers that help locate the element
      id: element.id || '',
      tagName: element.tagName.toLowerCase()
    };
  }

  // Get a simple path through the accessibility tree
  function getSimpleA11yPath(element) {
    if (!element) return '';
    
    const path = [];
    let current = element;
    let depth = 0;
    const MAX_DEPTH = 5; // Limit path depth to avoid excessive length
    
    while (current && current.nodeType === 1 && depth < MAX_DEPTH) {
      const role = current.getAttribute('role') || getImplicitRole(current);
      const name = getAccessibleName(current);
      
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
  }

  // Simple function to get accessible name
  function getAccessibleName(element) {
    // Check common name sources in priority order
    return element.getAttribute('aria-label') || 
           element.getAttribute('alt') || 
           element.getAttribute('title') || 
           element.textContent.trim().substring(0, 50) || '';
  }

  // Simple function to determine implicit role
  function getImplicitRole(element) {
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
  }
  
  // ===== ADD THIS ENTIRE BLOCK =====
  function initializeFormState() {
    // Allow multiple scans, don't block
    if (!formStateTracker.initialized) {
      formStateTracker.initialized = true;
      formStateTracker.scanCount = 0;
    }
    formStateTracker.scanCount = (formStateTracker.scanCount || 0) + 1;
    
    console.log(`🔄 Form state scan #${formStateTracker.scanCount}...`);
    console.log('🔍 Page:', window.location.href);
    console.log('🔍 Document ready state:', document.readyState);
    
    let foundCount = 0;
    
    // ========== 1. NATIVE HTML FORMS ==========
    console.log('🔍 Checking native selects...');
    const nativeSelects = document.querySelectorAll('select');
    console.log(`   Found ${nativeSelects.length} native select elements`);
    
    nativeSelects.forEach(select => {
      const id = getElementIdentifier(select);
      if (!formStateTracker.dropdowns.has(id)) {
        const defaultValue = select.value || select.options[select.selectedIndex]?.value;
        if (defaultValue) {
          formStateTracker.dropdowns.set(id, defaultValue);
          foundCount++;
          console.log(`   ✅ Native select: ${id} = ${defaultValue}`);
        }
      }
    });
    
    // ========== 2. AMAZON DROPDOWN CONTAINERS (MAIN PATTERN) ==========
    console.log('🔍 Checking Amazon dropdown containers...');
    const amazonContainers = document.querySelectorAll('.a-dropdown-container');
    console.log(`   Found ${amazonContainers.length} Amazon dropdown containers`);
    
    amazonContainers.forEach(container => {
      const id = getElementIdentifier(container);
      if (!formStateTracker.dropdowns.has(id)) {
        // Get the button text element (this has the selected value)
        const buttonText = container.querySelector('.a-button-text');
        if (buttonText) {
          const selectedText = buttonText.textContent.trim();
          console.log(`   🔍 Container ${id}: text="${selectedText}"`);
          if (selectedText && selectedText !== 'Select') {
            formStateTracker.dropdowns.set(id, selectedText);
            foundCount++;
            console.log(`   ✅ Amazon dropdown container: ${id} = ${selectedText}`);
          }
        } else {
          console.log(`   ⚠️ Container ${id}: no .a-button-text found`);
        }
      }
    });
    
    // ========== 3. AMAZON DATA-ACTION DROPDOWNS ==========
    console.log('🔍 Checking Amazon data-action dropdowns...');
    const amazonDataAction = document.querySelectorAll('[data-action*="dropdown"]');
    console.log(`   Found ${amazonDataAction.length} data-action dropdowns`);
    
    amazonDataAction.forEach(dropdown => {
      const id = getElementIdentifier(dropdown);
      if (!formStateTracker.dropdowns.has(id)) {
        // Look for inner button text
        const innerButton = dropdown.querySelector('.a-button-inner');
        const buttonText = dropdown.querySelector('.a-button-text');
        
        let selectedText = '';
        if (buttonText) {
          selectedText = buttonText.textContent.trim();
        } else if (innerButton) {
          selectedText = innerButton.textContent.trim();
        } else {
          selectedText = dropdown.textContent.trim();
        }
        
        // Clean up the text (remove labels)
        selectedText = selectedText
          .replace(/^(Select|Choose|Quantity|Size|Color):\s*/i, '')
          .trim();
        
        console.log(`   🔍 Data-action ${id}: text="${selectedText}"`);
        
        if (selectedText && selectedText.length > 0 && selectedText.length < 50) {
          formStateTracker.dropdowns.set(id, selectedText);
          foundCount++;
          console.log(`   ✅ Amazon data-action dropdown: ${id} = ${selectedText}`);
        }
      }
    });
    
    // ========== 4. TEXT INPUTS ==========
    document.querySelectorAll('input[type="text"], input[type="email"], input[type="password"], textarea').forEach(input => {
      const id = getElementIdentifier(input);
      if (!formStateTracker.inputs.has(id)) {
        formStateTracker.inputs.set(id, input.value || '');
      }
    });
    
    // ========== 5. CHECKBOXES (INDIVIDUAL + GROUPS) ==========
    const checkboxGroups = new Map();
    
    document.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
      const name = checkbox.name;
      const id = checkbox.id || getElementIdentifier(checkbox);
      
      if (name) {
        // Part of a group
        if (!checkboxGroups.has(name)) {
          checkboxGroups.set(name, []);
        }
        if (checkbox.checked) {
          const currentValues = formStateTracker.checkboxGroups.get(name) || [];
          const value = checkbox.value || id;
          if (!currentValues.includes(value)) {
            checkboxGroups.get(name).push(value);
          }
        }
      } else {
        // Individual checkbox
        if (!formStateTracker.checkboxes.has(id)) {
          formStateTracker.checkboxes.set(id, checkbox.checked);
        }
      }
    });
    
    // Merge checkbox groups
    checkboxGroups.forEach((values, name) => {
      if (!formStateTracker.checkboxGroups.has(name)) {
        formStateTracker.checkboxGroups.set(name, values);
      } else {
        // Add any new values
        const existing = formStateTracker.checkboxGroups.get(name);
        values.forEach(v => {
          if (!existing.includes(v)) existing.push(v);
        });
      }
    });
    
    // ========== 6. RADIO BUTTONS ==========
    const radioGroups = {};
    document.querySelectorAll('input[type="radio"]').forEach(radio => {
      const groupName = radio.name;
      if (radio.checked && groupName) {
        radioGroups[groupName] = radio.value;
      }
    });
    Object.entries(radioGroups).forEach(([name, value]) => {
      if (!formStateTracker.radioGroups.has(name)) {
        formStateTracker.radioGroups.set(name, value);
      }
    });
    
    // ========== 7. QUANTITY SELECTORS (GENERIC) ==========
    document.querySelectorAll('[name="quantity"], [id*="quantity"], #qty, [name="qty"]').forEach(qty => {
      const id = getElementIdentifier(qty);
      if (!formStateTracker.inputs.has(id)) {
        let value;
        if (qty.tagName === 'SELECT') {
          value = qty.value || qty.options[qty.selectedIndex]?.value;
        } else if (qty.tagName === 'INPUT') {
          value = qty.value;
        }
        if (value) {
          formStateTracker.inputs.set(id, value);
          foundCount++;
          console.log(`   ✅ Quantity input: ${id} = ${value}`);
        }
      }
    });
    
    console.log(`📊 Scan #${formStateTracker.scanCount} complete: Found ${foundCount} new elements`);
    console.log('📊 Total tracked:', {
      dropdowns: formStateTracker.dropdowns.size,
      inputs: formStateTracker.inputs.size,
      checkboxes: formStateTracker.checkboxes.size,
      checkboxGroups: formStateTracker.checkboxGroups.size,
      radioGroups: formStateTracker.radioGroups.size
    });
    
    // Debug: Show what we actually captured
    if (formStateTracker.dropdowns.size > 0) {
      console.log('📋 Captured dropdowns:', Object.fromEntries(formStateTracker.dropdowns));
    }
    
    // If nothing found after 3 seconds, log a warning
    if (formStateTracker.scanCount >= 4 && formStateTracker.dropdowns.size === 0) {
      console.warn('⚠️ WARNING: No form elements found after 4 scans!');
      console.warn('   This might indicate:');
      console.warn('   1. Amazon changed their HTML structure');
      console.warn('   2. Page is loading very slowly');
      console.warn('   3. Selectors need to be updated');
    }
  }
  
  function recordStateChange(element, elementType, oldValue, newValue) {
    if (!isRecording) return;
    
    // Compare to detect if we should record (internal logic only)
    if (Array.isArray(oldValue) && Array.isArray(newValue)) {
      const sameLength = oldValue.length === newValue.length;
      const sameValues = oldValue.every(v => newValue.includes(v)) && 
                         newValue.every(v => oldValue.includes(v));
      if (sameLength && sameValues) return;
    } else if (oldValue === newValue) {
      return;
    }
    
    // Build event with ONLY current state (no oldValue/newValue in schema)
    const eventData = {
      type: 'change',
      timestamp: Date.now(),
      url: window.location.href,
      target: {
        tag: element.tagName,
        id: element.id,
        class: element.className,
        name: element.name,
        type: element.type,
        value: newValue,
        bid: getStableBID(element),
        xpath: getElementXPath(element),
        cssPath: getElementCssPath(element),
        a11y: getA11yIdentifiers(element),
        attributes: Array.from(element.attributes).reduce((acc, attr) => {
          acc[attr.name] = attr.value;
          return acc;
        }, {}),
        boundingBox: element.getBoundingClientRect().toJSON(),
        isInteractive: isInteractiveElement(element)
      }
    };
    
    // For checkbox groups, value is an array
    if (Array.isArray(newValue)) {
      eventData.target.value = newValue;
      eventData.target.type = 'checkbox-group';
    }
    
    // Send to background
    chrome.runtime.sendMessage({ type: 'recordedEvent', event: eventData });
    events.push(eventData);
    
    console.log('State change recorded:', {
      type: elementType,
      element: element.id || element.name,
      currentValue: Array.isArray(newValue) ? newValue.join(', ') : newValue
    });
  }
  
  function attachStateChangeListeners() {
    // Listen for form element changes
    document.addEventListener('change', (e) => {
      if (!isRecording) return;
      
      const element = e.target;
      const id = getElementIdentifier(element);
      
      // Handle SELECT dropdowns
      if (element.tagName === 'SELECT') {
        const oldValue = formStateTracker.dropdowns.get(id);
        const newValue = element.value;
        
        if (oldValue !== newValue) {
          formStateTracker.dropdowns.set(id, newValue);
          recordStateChange(element, 'dropdown', oldValue, newValue);
        }
      }
      // Handle checkboxes
      else if (element.type === 'checkbox') {
        const name = element.name;
        
        if (name) {
          // Part of a checkbox group
          const oldValues = formStateTracker.checkboxGroups.get(name) || [];
          const value = element.value || id;
          
          let newValues;
          if (element.checked) {
            newValues = [...oldValues, value];
          } else {
            newValues = oldValues.filter(v => v !== value);
          }
          
          formStateTracker.checkboxGroups.set(name, newValues);
          recordStateChange(element, 'checkbox_group', oldValues, newValues);
          
        } else {
          // Individual checkbox
          const oldValue = formStateTracker.checkboxes.get(id);
          const newValue = element.checked;
          
          if (oldValue !== newValue) {
            formStateTracker.checkboxes.set(id, newValue);
            recordStateChange(element, 'checkbox', oldValue, newValue);
          }
        }
      }
      // Handle radio buttons
      else if (element.type === 'radio') {
        const groupName = element.name;
        const oldValue = formStateTracker.radioGroups.get(groupName);
        const newValue = element.value;
        
        if (oldValue !== newValue) {
          formStateTracker.radioGroups.set(groupName, newValue);
          recordStateChange(element, 'radio', oldValue, newValue);
        }
      }
    }, true);
    
    // Listen for input changes (debounced)
    const debouncedInputHandler = debounce((e) => {
      if (!isRecording) return;
      
      const element = e.target;
      const id = getElementIdentifier(element);
      
      if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
        const oldValue = formStateTracker.inputs.get(id) || '';
        const newValue = element.value;
        
        if (oldValue !== newValue) {
          formStateTracker.inputs.set(id, newValue);
          recordStateChange(element, 'input', oldValue, newValue);
        }
      }
    }, 500);
    
    document.addEventListener('input', debouncedInputHandler, true);
    
    console.log('State change listeners attached');
  }
  
  function handleCustomDropdownSelection(element) {
    if (!isRecording) return;
    
    // Check if this is a dropdown option selection
    const isDropdownOption = 
      (element.hasAttribute('data-action') && 
       element.getAttribute('data-action').includes('dropdown')) ||
      element.classList.contains('a-dropdown-link') ||
      element.closest('[role="listbox"]');
    
    if (!isDropdownOption) return;
    
    // Find the parent dropdown container
    const dropdownContainer = 
      element.closest('[data-action*="dropdown"]') ||
      element.closest('[role="listbox"]')?.previousElementSibling;
    
    if (!dropdownContainer) return;
    
    const id = getElementIdentifier(dropdownContainer);
    const oldValue = formStateTracker.dropdowns.get(id);
    const newValue = element.textContent.trim() || element.getAttribute('data-value');
    
    if (oldValue !== newValue && newValue) {
      formStateTracker.dropdowns.set(id, newValue);
      recordStateChange(dropdownContainer, 'custom_dropdown', oldValue, newValue);
    }
  }
  // ===== END ADD =====


  // Check if we should be recording when script loads
  chrome.storage.local.get(['isRecording', 'currentTaskId', 'taskHistory'], (data) => {
    console.log("Checking recording state:", data);
    if (data.isRecording && data.currentTaskId) {
      isRecording = true;
      currentTaskId = data.currentTaskId;
      
      // Get existing events for this task
      if (data.taskHistory && data.taskHistory[currentTaskId]) {
        events = data.taskHistory[currentTaskId].events || [];
      }
      
      // Initialize recording - but wait for DOM to be ready
      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        initializeRecording();
      } else {
        document.addEventListener('DOMContentLoaded', initializeRecording);
      }
    }
  });

  function getHandlerByKey(handlerKey) {
    switch (handlerKey) {
      case 'debouncedRecordInput':
        return debouncedRecordInput;
      case 'debouncedRecordScroll':
        return debouncedRecordScroll;
      case 'recordEvent':
      default:
        return recordEvent;
    }
  }

  function detachDomListeners() {
    activeDomListeners.forEach((handler, eventName) => {
      document.removeEventListener(eventName, handler, true);
    });
    activeDomListeners.clear();
  }

  function detachNavigationListeners() {
    activeNavigationListeners.forEach(({ handler, options }, eventName) => {
      window.removeEventListener(eventName, handler, options);
    });
    activeNavigationListeners.clear();
  }

  const NAVIGATION_HANDLER_MAP = {
    popstate: handleNavigation,
    pushState: handleNavigation,
    replaceState: handleNavigation,
    beforeunload: handleBeforeUnload
  };

  // ===== ADD THIS ENTIRE FUNCTION =====
  function observeDynamicChanges() {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        // Handle attribute changes
        if (mutation.type === 'attributes') {
          if (mutation.attributeName === 'disabled' || 
              mutation.attributeName === 'value' ||
              mutation.attributeName === 'selected') {
            const element = mutation.target;
            
            if (element.tagName === 'SELECT' || 
                element.tagName === 'INPUT' || 
                element.tagName === 'TEXTAREA') {
              const id = getElementIdentifier(element);
              
              if (element.tagName === 'SELECT') {
                const currentValue = element.value;
                const trackedValue = formStateTracker.dropdowns.get(id);
                if (currentValue !== trackedValue) {
                  formStateTracker.dropdowns.set(id, currentValue);
                }
              }
            }
          }
        }
        
        // Handle newly added form elements
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) {
            if (node.tagName === 'SELECT') {
              const id = getElementIdentifier(node);
              const value = node.value || node.options[node.selectedIndex]?.value;
              formStateTracker.dropdowns.set(id, value);
              console.log('New dropdown detected:', id, value);
            }
            
            if (node.querySelectorAll) {
              node.querySelectorAll('select, input, textarea').forEach(formElement => {
                const id = getElementIdentifier(formElement);
                if (formElement.tagName === 'SELECT') {
                  const value = formElement.value;
                  formStateTracker.dropdowns.set(id, value);
                }
              });
            }
          }
        });
      });
    });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['disabled', 'value', 'selected', 'checked', 'data-value']
  });

  return observer;
  }
// ===== END ADD =====
  // Function to observe dynamic changes in the DOM
  async function initializeRecording() {
    console.log('Initializing recording with configurable listeners');

    try {
      const config = await loadEventConfig();

      detachDomListeners();
      detachNavigationListeners();

      // ========== MULTI-PASS SCANNING FOR DYNAMIC CONTENT ==========
      console.log('🚀 Starting multi-pass form state scanning...');
      console.log('🚀 Current URL:', window.location.href);
      console.log('🚀 Page ready state:', document.readyState);

      // Pass 1: Immediate (catches pre-rendered content)
      console.log('🔄 Running scan #1 (immediate)...');
      initializeFormState();

      // Pass 2: After 500ms (catches fast-loading dynamic content)
      setTimeout(() => {
        console.log('🔄 Running scan #2 (500ms delay)...');
        initializeFormState();
      }, 500);

      // Pass 3: After 1.5s (catches most dynamic content)
      setTimeout(() => {
        console.log('🔄 Running scan #3 (1500ms delay)...');
        initializeFormState();
      }, 1500);

      // Pass 4: After 3s (Amazon usually loaded by now)
      setTimeout(() => {
        console.log('🔄 Running scan #4 (3000ms delay)...');
        initializeFormState();
      }, 3000);

      // Pass 5: After 5s (final safety net)
      setTimeout(() => {
        console.log('🔄 Running scan #5 (5000ms delay - FINAL)...');
        initializeFormState();
        console.log('✅ All scans complete');
      }, 5000);

      attachStateChangeListeners();
      const enabledDomEvents = (config.domEvents || []).filter(evt => evt && evt.enabled !== false);
      enabledDomEvents.forEach(({ name, handler }) => {
        const resolvedHandler = getHandlerByKey(handler);
        if (!resolvedHandler) {
          console.warn(`No handler resolved for event '${name}' (key: ${handler}).`);
          return;
        }

        // Special handling for clicks to detect custom dropdowns
        if (name === 'click') {
          const clickHandler = (e) => {
            const element = e.target;
            
            // Skip clicks on dropdown-related elements
            const skipClick = 
              element.classList.contains('a-dropdown-label') ||
              element.classList.contains('a-dropdown-link') ||
              element.closest('[role="listbox"]') ||
              element.closest('.a-popover-wrapper') ||
              (element.hasAttribute('data-action') && 
               element.getAttribute('data-action').includes('dropdown'));
            
            if (skipClick) {
              // Only handle state change, don't record click
              handleCustomDropdownSelection(element);
              console.log('Skipped dropdown click, handled as state change');
              return; // Don't record this click
            }
            
            // Regular click - record it
            resolvedHandler(e);
          };
          document.addEventListener(name, clickHandler, true);
          activeDomListeners.set(name, clickHandler);
        } else {
          document.addEventListener(name, resolvedHandler, true);
          activeDomListeners.set(name, resolvedHandler);
        }

        console.log(`Added event listener for ${name}`);
      });

      const enabledNavigationEvents = (config.navigationEvents || []).filter(evt => evt && evt.enabled !== false);
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

      if (config.observers && config.observers.dynamicDom === false) {
        if (dynamicObserver) {
          dynamicObserver.disconnect();
          dynamicObserver = null;
        }
      } else {
        if (dynamicObserver) {
          dynamicObserver.disconnect();
        }
        dynamicObserver = observeDynamicChanges();
      }

      navigationState.lastUrl = window.location.href;
      navigationState.lastTitle = document.title;

      console.log('Recording initialized with state:', {
        isRecording,
        currentTaskId,
        domEvents: enabledDomEvents.map(evt => evt.name),
        navigationEvents: enabledNavigationEvents.map(evt => evt.name)
      });
    } catch (error) {
      console.error('Failed to initialize recording configuration:', error);
    }
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Message received in recorder:", message);
    if (message.action === "startRecording") {
      startRecording(message.taskId);
      sendResponse({status: "recording started"});
    } else if (message.action === "stopRecording") {
      stopRecording();
      sendResponse({status: "recording stopped"});
    }
    return true; // Required for async sendResponse
  });

  function startRecording(taskId) {
    console.log("Recording started for task:", taskId);
    isRecording = true;
    currentTaskId = taskId;
    cachedEventConfig = null; // Reload configuration for each new recording session
    
    // Get existing events if any
    chrome.storage.local.get(['taskHistory'], (data) => {
      const taskHistory = data.taskHistory || {};
      if (taskHistory[currentTaskId]) {
        events = taskHistory[currentTaskId].events || [];
      } else {
        events = [];
      }
      
      console.log("Retrieved existing events:", events);
      
      // Initialize recording - but wait for DOM to be ready
      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        initializeRecording();
      } else {
        document.addEventListener('DOMContentLoaded', initializeRecording);
      }
      
      // Record initial page load as an event
      const pageLoadEvent = {
        type: EVENT_TYPES.PAGE_LOAD,
        timestamp: Date.now(),
        url: window.location.href,
        title: document.title
      };
      events.push(pageLoadEvent);
      saveEvents();
    });
  }

  function stopRecording() {
    console.log("Recording stopped");
    isRecording = false;
    

      // Capture final form state
    const finalFormState = {
      type: 'final_form_state',
      timestamp: Date.now(),
      url: window.location.href,
      state: {
        dropdowns: Object.fromEntries(formStateTracker.dropdowns),
        inputs: Object.fromEntries(formStateTracker.inputs),
        checkboxes: Object.fromEntries(formStateTracker.checkboxes),
        checkboxGroups: Object.fromEntries(formStateTracker.checkboxGroups),
        radioGroups: Object.fromEntries(formStateTracker.radioGroups)
      }
    };
  
  events.push(finalFormState);
    // Remove event listeners configured for this session
    detachDomListeners();
    detachNavigationListeners();
    
    // Disconnect observer
    if (dynamicObserver) {
      try {
        dynamicObserver.disconnect();
        dynamicObserver = null;
      } catch (e) {
        console.error("Error disconnecting observer:", e);
      }
    }
    
    // Log recorded events
    console.log("Recorded events to save:", events);
    
    // Save the events to the task history
    if (currentTaskId) {
      chrome.storage.local.get(['taskHistory'], function(data) {
        const taskHistory = data.taskHistory || {};
        
        if (taskHistory[currentTaskId]) {
          taskHistory[currentTaskId].events = events;
          
          // Save the updated task history
          chrome.storage.local.set({ taskHistory: taskHistory }, function() {
            console.log("Events saved to task history");
          });
        }
      });
    }
    
    currentTaskId = null;
  }

  function saveEvents() {
    if (!isRecording || !currentTaskId) return;
    
    try {
      chrome.storage.local.get(['taskHistory'], function(data) {
        const taskHistory = data.taskHistory || {};
        
        if (taskHistory[currentTaskId]) {
          taskHistory[currentTaskId].events = events;
          
          // Save the updated task history
          chrome.storage.local.set({ taskHistory: taskHistory }, function() {
            console.log("Events saved to task history");
            recoveryState.lastSavedTimestamp = Date.now();
            recoveryState.errorCount = 0;
          });
        }
      });
    } catch (error) {
      console.error("Error saving events:", error);
      recoveryState.errorCount++;
      
      // Attempt recovery if we've hit too many errors
      if (recoveryState.errorCount >= recoveryState.maxErrors) {
        attemptRecovery();
      }
    }
  }

  // Function to handle navigation events
  function handleNavigation(event) {
    if (!isRecording) return;
    
    const currentUrl = window.location.href;
    const previousUrl = navigationState.lastUrl || document.referrer;
    
    if (currentUrl !== previousUrl) {
      recordNavigationEvent(previousUrl, currentUrl);
    }
  }

  function handleBeforeUnload() {
    if (!isRecording) return;

    navigationState.pendingNavigation = true;
    const currentUrl = window.location.href;

    try {
      localStorage.setItem('pendingNavigation', JSON.stringify({
        fromUrl: currentUrl,
        timestamp: Date.now(),
        taskId: currentTaskId
      }));
    } catch (e) {
      console.error('Error saving navigation state:', e);
    }
  }

  // Function to attempt recovery from errors
  function attemptRecovery() {
    console.log("Attempting recovery from errors...");
    
    // Clear error count
    recoveryState.errorCount = 0;
    
    // Try to save events to localStorage as backup
    try {
      localStorage.setItem('eventCaptureBackup', JSON.stringify({
        events: events,
        timestamp: Date.now(),
        taskId: currentTaskId
      }));
    } catch (e) {
      console.error("Failed to create backup:", e);
    }
    
    // Reinitialize recording
    initializeRecording();
  }

  // Enhanced function to record navigation events
  function recordNavigationEvent(fromUrl, toUrl, type = EVENT_TYPES.NAVIGATION) {
    if (!isRecording) return;

    const eventData = {
      type: type,
      timestamp: formatTimestamp(Date.now()),
      fromUrl: fromUrl,
      toUrl: toUrl,
      title: document.title,
      referrer: document.referrer,
      fromUserInput: clickState.clickCount > 0
    };

    events.push(eventData);
    saveEvents();
    
    // Update navigation state
    navigationState.lastUrl = toUrl;
    navigationState.lastTitle = document.title;
    navigationState.pendingNavigation = false;
    
    // Reset click count after navigation
    clickState.clickCount = 0;

    // Log navigation event
    console.log(`Navigation recorded:`, {
      from: fromUrl,
      to: toUrl,
      userInitiated: clickState.clickCount > 0,
      totalNavigations: eventVerification.navigations.length
    });
  }

  // Add periodic event verification
  setInterval(() => {
    if (isRecording) {
      console.log('Event Capture Status:', {
        totalEvents: events.length,
        clicks: eventVerification.clicks.length,
        inputs: eventVerification.inputs.length,
        navigations: eventVerification.navigations.length,
        lastMinute: {
          clicks: eventVerification.clicks.filter(c => Date.now() - c.time < 60000).length,
          inputs: eventVerification.inputs.filter(i => Date.now() - i.time < 60000).length,
          navigations: eventVerification.navigations.filter(n => Date.now() - n.time < 60000).length
        }
      });
    }
  }, 5000);

  // Add periodic validation check
  setInterval(() => {
    if (isRecording && testMode.enabled) {
      const currentTime = Date.now();
      if (currentTime - testMode.lastValidationTime >= testMode.validationInterval) {
        // Check validation queue
        const unverified = testMode.validationQueue.filter(v => !v.verified);
        if (unverified.length > 0) {
          console.warn(`Found ${unverified.length} unverified events:`, unverified);
        }
        
        // Log validation statistics
        console.log('Event Capture Validation Status:', {
          totalEvents: events.length,
          validationQueueSize: testMode.validationQueue.length,
          verifiedEvents: testMode.validationQueue.filter(v => v.verified).length,
          unverifiedEvents: unverified.length,
          lastMinute: {
            total: testMode.validationQueue.filter(v => currentTime - v.timestamp < 60000).length,
            verified: testMode.validationQueue.filter(v => v.verified && currentTime - v.timestamp < 60000).length
          }
        });
        
        testMode.lastValidationTime = currentTime;
      }
    }
  }, 1000);

  // Add periodic recording state verification
  setInterval(() => {
    if (isRecording) {
      console.log('Recording State Check:', {
        isRecording,
        currentTaskId,
        totalEvents: events.length,
        lastEventTime: events.length > 0 ? events[events.length - 1].timestamp : null,
        clickCount: clickState.clickCount,
        eventListeners: {
          click: document.onclick !== null,
          mousedown: document.onmousedown !== null,
          mouseup: document.onmouseup !== null
        }
      });
    }
  }, 2000);

  // Add click event verification
  document.addEventListener('click', function verifyClick(e) {
    if (isRecording) {
      console.log('Click Verification:', {
        target: e.target.tagName,
        id: e.target.id,
        class: e.target.className,
        isInteractive: isInteractiveElement(e.target),
        recordingState: {
          isRecording,
          currentTaskId,
          clickCount: clickState.clickCount
        }
      });
    }
  }, true);
})(); // End of IIFE
