// Use an IIFE to avoid polluting global scope and prevent redeclaration issues
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

  // Utility function to get element CSS path
  function getElementCssPath(element) {
    if (!element || element.nodeType !== 1) return '';
    
    let path = [];
    while (element && element.nodeType === 1) {
      let selector = element.tagName.toLowerCase();
      
      if (element.id) {
        selector += '#' + element.id;
        path.unshift(selector);
        break; // ID is unique, no need to go further up
      } else {
        // Add classes (but keep it reasonable)
        if (element.className && typeof element.className === 'string') {
          const classes = element.className.split(/\s+/).filter(c => c);
          if (classes.length > 0) {
            selector += '.' + classes.join('.');
          }
        }
        
        // Add position among siblings if needed
        let sibling = element, index = 1;
        while (sibling = sibling.previousElementSibling) {
          if (sibling.tagName === element.tagName) index++;
        }
        if (index > 1) selector += ':nth-of-type(' + index + ')';
        
        path.unshift(selector);
        element = element.parentNode;
      }
      
      // Limit path length to avoid excessive selectors
      if (path.length > 5) break;
    }
    
    return path.join(' > ');
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

  // Function to initialize recording (attach event listeners)
  function initializeRecording() {
    console.log("Initializing recording with event listeners");
    
    // Record clicks
    document.removeEventListener('click', recordClick); // Remove first to prevent duplicates
    document.addEventListener('click', recordClick);
    
    // Record form inputs
    document.removeEventListener('input', recordInput);
    document.addEventListener('input', recordInput);
    
    // Add focus and mousedown listeners
    // document.removeEventListener('focus', recordFocus, true);
    // document.addEventListener('focus', recordFocus, true);
    
    // document.removeEventListener('mousedown', recordMouseDown, true);
    // document.addEventListener('mousedown', recordMouseDown, true);
    
    // Set up observer for dynamic elements
    dynamicObserver = observeDynamicChanges();
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
        type: 'pageLoad',
        url: window.location.href,
        timestamp: Date.now(),
        title: document.title
      };
      events.push(pageLoadEvent);
      saveEvents();
    });
  }

  function stopRecording() {
    console.log("Recording stopped");
    isRecording = false;
    
    // Remove event listeners
    document.removeEventListener('click', recordClick);
    document.removeEventListener('input', recordInput);
    document.removeEventListener('focus', recordFocus, true);
    document.removeEventListener('mousedown', recordMouseDown, true);
    
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

  function recordClick(e) {
    if (!isRecording) return;
    
    try {
      // Create the basic event data
      const eventData = {
        type: 'click',
        timestamp: Date.now(),
        url: window.location.href,
        
        // Add just enough a11y info to identify the element in the tree
        a11y: getA11yIdentifiers(e.target),
        
        // Include text content for easier identification
        textContent: e.target.textContent ? e.target.textContent.trim().substring(0, 100) : ''
      };
      
      console.log("Click recorded with a11y identifiers:", eventData);
      events.push(eventData);
      saveEvents();
    } catch (error) {
      console.error("Error recording click:", error);
    }
  }

  function recordInput(e) {
    if (!isRecording) return;
    
    try {
      const eventData = {
        type: 'input',
        timestamp: Date.now(),
        url: window.location.href,
        value: e.target.value || '',
        a11y: getA11yIdentifiers(e.target)
      };
      
      console.log("Input recorded:", eventData);
      events.push(eventData);
      saveEvents();
    } catch (error) {
      console.error("Error recording input:", error);
    }
  }

  function recordFocus(e) {
    if (!isRecording) return;
    
    try {
      // Only record focus on input elements, selects, and textareas
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
        const eventData = {
          type: 'focus',
          timestamp: Date.now(),
          url: window.location.href,
          a11y: getA11yIdentifiers(e.target)
        };
        
        console.log("Focus recorded:", eventData);
        events.push(eventData);
        saveEvents();
      }
    } catch (error) {
      console.error("Error recording focus:", error);
    }
  }

  function recordMouseDown(e) {
    if (!isRecording) return;
    
    try {
      // Find if this is a dropdown/suggestion item
      const dropdownItem = e.target.closest('li') || 
                           e.target.closest('[role="option"]') || 
                           e.target.closest('[role="menuitem"]') ||
                           e.target.closest('.dropdown-item');
      
      // Create the basic event data
      const eventData = {
        type: 'mousedown',
        target: e.target.tagName,
        id: e.target.id || '',
        class: typeof e.target.className === 'string' ? e.target.className : '',
        timestamp: Date.now(),
        url: window.location.href,
        x: e.clientX,
        y: e.clientY,
        textContent: e.target.textContent ? e.target.textContent.trim().substring(0, 100) : '',
        cssPath: getElementCssPath(e.target),
        attributes: {}
      };
      
      // If this is a dropdown item, add more context
      if (dropdownItem) {
        eventData.isDropdownItem = true;
        eventData.dropdownItemText = dropdownItem.textContent ? dropdownItem.textContent.trim() : '';
        
        // Find the closest link element
        const linkElement = e.target.closest('a') || dropdownItem.querySelector('a');
        if (linkElement) {
          eventData.linkHref = linkElement.href || linkElement.getAttribute('href') || '';
          eventData.linkText = linkElement.textContent ? linkElement.textContent.trim() : '';
        }
        
        // Try to find the parent container
        const container = dropdownItem.closest('ul') || 
                          dropdownItem.closest('[role="menu"]') || 
                          dropdownItem.closest('[role="listbox"]');
        if (container) {
          eventData.containerType = container.tagName;
          eventData.containerClass = typeof container.className === 'string' ? container.className : '';
          eventData.containerItems = container.children.length;
        }
      }
      
      // Capture important attributes
      const importantAttrs = ['href', 'src', 'alt', 'title', 'name', 'value', 'type', 'placeholder', 'role', 'aria-label', 'data-title'];
      importantAttrs.forEach(attr => {
        if (e.target.hasAttribute(attr)) {
          eventData.attributes[attr] = e.target.getAttribute(attr);
        }
      });
      
      console.log("Mousedown recorded:", eventData);
      events.push(eventData);
      saveEvents();
    } catch (error) {
      console.error("Error recording mousedown:", error);
    }
  }

  function observeDynamicChanges() {
    // Make sure we have a valid target to observe
    if (!document.body) {
      console.log("Body not available yet, will retry observer setup");
      // Retry after a short delay
      setTimeout(observeDynamicChanges, 100);
      return null;
    }

    try {
      const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
          if (mutation.type === 'childList') {
            // Check for any new interactive elements
            for (const node of mutation.addedNodes) {
              if (node.nodeType === 1) { // Element node
                try {
                  // Look for dropdown menus, lists, and other interactive elements
                  const dropdownElements = node.querySelectorAll('ul, [role="menu"], [role="listbox"], .dropdown-menu');
                  if (dropdownElements.length > 0) {
                    console.log("Dynamic dropdown elements detected:", dropdownElements);
                  }
                  
                  // Look for form elements
                  const formElements = node.querySelectorAll('input, select, textarea, button');
                  if (formElements.length > 0) {
                    console.log("Dynamic form elements detected:", formElements);
                  }
                  
                  // No need to attach special listeners - our document-level listeners will catch events
                  // from these elements. We're just logging them for debugging purposes.
                } catch (e) {
                  console.error("Error processing mutation node:", e);
                }
              }
            }
          }
        }
      });
      
      observer.observe(document.body, { childList: true, subtree: true });
      console.log("MutationObserver successfully attached to document.body");
      return observer;
    } catch (error) {
      console.error("Error setting up MutationObserver:", error);
      return null;
    }
  }

  // Add navigation event listeners
  window.addEventListener('beforeunload', function() {
    if (!isRecording) return;
    
    try {
      const eventData = {
        type: 'navigation',
        fromUrl: window.location.href,
        timestamp: Date.now()
      };
      
      console.log("Navigation event recorded:", eventData);
      
      // We need to use synchronous storage here since the page is unloading
      try {
        // Get current events
        const storageData = JSON.parse(localStorage.getItem('tempNavigationData') || '{}');
        storageData.lastFromUrl = window.location.href;
        storageData.lastNavigationTime = Date.now();
        storageData.taskId = currentTaskId;
        localStorage.setItem('tempNavigationData', JSON.stringify(storageData));
      } catch (e) {
        console.error("Error saving navigation data:", e);
      }
    } catch (error) {
      console.error("Error in beforeunload handler:", error);
    }
  });

  // When page loads, check if we have pending navigation data
  window.addEventListener('load', function() {
    try {
      if (!isRecording) return;
      
      try {
        const storageData = JSON.parse(localStorage.getItem('tempNavigationData') || '{}');
        if (storageData.lastFromUrl && storageData.lastNavigationTime && storageData.taskId) {
          // If the last navigation was recent (within 5 seconds), record it
          if (Date.now() - storageData.lastNavigationTime < 5000) {
            const navigationEventData = {
              type: 'navigation',
              fromUrl: storageData.lastFromUrl,
              toUrl: window.location.href,
              timestamp: storageData.lastNavigationTime,
              completedTimestamp: Date.now()
            };
            
            console.log("Navigation completed:", navigationEventData);
            
            // Get existing events and add this navigation
            chrome.storage.local.get(['taskHistory'], (data) => {
              const taskHistory = data.taskHistory || {};
              const taskId = storageData.taskId;
              
              if (taskHistory[taskId]) {
                const currentEvents = taskHistory[taskId].events || [];
                currentEvents.push(navigationEventData);
                taskHistory[taskId].events = currentEvents;
                
                // Save updated events
                chrome.storage.local.set({ taskHistory: taskHistory }, function() {
                  console.log("Navigation event saved to task history");
                });
              }
            });
          }
          
          // Clear the temporary navigation data
          localStorage.removeItem('tempNavigationData');
        }
      } catch (e) {
        console.error("Error processing navigation data:", e);
      }
      
      // Record page load event
      const pageLoadEventData = {
        type: 'pageLoad',
        url: window.location.href,
        timestamp: Date.now(),
        title: document.title,
        referrer: document.referrer
      };
      
      console.log("Page load recorded:", pageLoadEventData);
      
      // Get existing events first
      chrome.storage.local.get(['taskHistory', 'currentTaskId'], (data) => {
        if (data.currentTaskId) {
          const taskHistory = data.taskHistory || {};
          const taskId = data.currentTaskId;
          
          if (taskHistory[taskId]) {
            const currentEvents = taskHistory[taskId].events || [];
            currentEvents.push(pageLoadEventData);
            taskHistory[taskId].events = currentEvents;
            
            // Save updated events
            chrome.storage.local.set({ taskHistory: taskHistory }, function() {
              console.log("Page load event saved to task history");
            });
          }
        }
      });
      
    } catch (error) {
      console.error("Error in load handler:", error);
    }
  });
})(); // End of IIFE
