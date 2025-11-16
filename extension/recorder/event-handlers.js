/**
 * Event Handlers Module
 * Manages event configuration, listener attachment/detachment, and event handler mapping
 */

window.RecorderEventHandlers = {
  
  // State
  _cachedEventConfig: null,
  _activeDomListeners: new Map(),
  _activeNavigationListeners: new Map(),
  _criticalDomListeners: new Map(),
  
  // Default configuration
  DEFAULT_EVENT_CONFIG: {
    domEvents: [
      { name: 'click', enabled: true, handler: 'recordEvent' },
      { name: 'scroll', enabled: true, handler: 'debouncedRecordScroll' },
      { name: 'input', enabled: true, handler: 'debouncedRecordInput' },
      { name: 'change', enabled: true, handler: 'debouncedRecordInput' },
      { name: 'submit', enabled: true, handler: 'recordEvent' }
    ],
    navigationEvents: [
      { name: 'popstate', enabled: true },
      { name: 'beforeunload', enabled: true }
    ],
    observers: {
      dynamicDom: false
    }
  },

  // Navigation handler map
  NAVIGATION_HANDLER_MAP: null, // Will be set by recorder.js
  
  /**
   * Merge user config with default config
   */
  mergeEventConfig: function(userConfig) {
    const configClone = JSON.parse(JSON.stringify(this.DEFAULT_EVENT_CONFIG));

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
  },

  /**
   * Load event configuration from event-config.json
   */
  loadEventConfig: async function() {
    if (this._cachedEventConfig) {
      return this._cachedEventConfig;
    }

    try {
      const configUrl = chrome.runtime.getURL('event-config.json');
      const response = await fetch(configUrl, { cache: 'no-cache' });
      if (!response.ok) {
        throw new Error(`Failed to load event-config.json: ${response.status}`);
      }
      const userConfig = await response.json();
      this._cachedEventConfig = this.mergeEventConfig(userConfig);
      console.log('Event config loaded:', this._cachedEventConfig);
    } catch (error) {
      console.warn('Falling back to default event configuration.', error);
      this._cachedEventConfig = this.mergeEventConfig(null);
    }

    return this._cachedEventConfig;
  },

  /**
   * Get cached config (synchronous)
   */
  getConfig: function() {
    return this._cachedEventConfig || this.DEFAULT_EVENT_CONFIG;
  },

  /**
   * Pre-attach critical listeners that should always be active
   * These run in capture phase before any other listeners
   */
  preAttachCriticalListeners: function(targetDocument, isRecording, recordEvent, prebufferCallback) {
    targetDocument = targetDocument || document;
    
    try {
      const critical = ['pointerdown', 'mousedown', 'mouseup', 'click', 'submit', 'input', 'change', 'keydown'];
      critical.forEach((name) => {
        // Use document as key to track which documents have listeners
        const key = `${name}_${targetDocument === document ? 'main' : 'iframe'}`;
        if (!this._criticalDomListeners.has(key)) {
          targetDocument.addEventListener(name, (e) => {
            try {
              if (isRecording) {
                recordEvent(e);
              } else if (prebufferCallback) {
                prebufferCallback(e);
              }
            } catch (err) {
              console.warn('Critical listener error:', err);
            }
          }, true);
          this._criticalDomListeners.set(key, true);
          console.log(`Pre-attached critical listener for ${name} on`, targetDocument === document ? 'main document' : 'iframe');
        }
      });
    } catch (err) {
      console.warn('Failed to pre-attach critical listeners:', err);
    }
  },

  /**
   * Map handler key to actual handler function
   */
  getHandlerByKey: function(handlerKey, handlers) {
    if (!handlers) return null;
    
    switch (handlerKey) {
      case 'debouncedRecordInput':
        return handlers.debouncedRecordInput;
      case 'debouncedRecordScroll':
        return handlers.debouncedRecordScroll;
      case 'recordEvent':
      default:
        return handlers.recordEvent;
    }
  },

  /**
   * Attach DOM event listeners to a specific document (main or iframe)
   */
  attachDomListenersToDocument: function(targetDocument, handlers) {
    try {
      const config = this.getConfig();
      const enabledDomEvents = (config.domEvents || []).filter(evt => evt && evt.enabled !== false);

      enabledDomEvents.forEach(({ name, handler }) => {
        const resolvedHandler = this.getHandlerByKey(handler, handlers);
        if (!resolvedHandler) {
          console.warn(`No handler resolved for event '${name}' (key: ${handler}).`);
          return;
        }
        // Skip if already handled by critical listener for main document
        if (targetDocument === document && this._criticalDomListeners.has(`${name}_main`)) {
          return;
        }
        targetDocument.addEventListener(name, resolvedHandler, true);
        this._activeDomListeners.set(name, resolvedHandler);
        console.log(`Added event listener for ${name} on`, targetDocument === document ? 'main' : 'iframe');
      });
    } catch (err) {
      console.error('Failed to attach DOM listeners to document:', err);
    }
  },

  /**
   * Attach navigation event listeners
   */
  attachNavigationListeners: function(handlers) {
    try {
      const config = this.getConfig();
      const enabledNavEvents = (config.navigationEvents || []).filter(evt => evt && evt.enabled !== false);

      enabledNavEvents.forEach(({ name }) => {
        const handler = this.NAVIGATION_HANDLER_MAP && this.NAVIGATION_HANDLER_MAP[name];
        if (!handler) {
          console.warn(`No navigation handler found for '${name}'.`);
          return;
        }
        const options = name === 'beforeunload' ? undefined : true;
        window.addEventListener(name, handler, options);
        this._activeNavigationListeners.set(name, { handler, options });
        console.log(`Added navigation listener for ${name}`);
      });
    } catch (err) {
      console.error('Failed to attach navigation listeners:', err);
    }
  },

  /**
   * Detach DOM event listeners
   */
  detachDomListeners: function(targetDocument) {
    targetDocument = targetDocument || document;
    
    this._activeDomListeners.forEach((handler, eventName) => {
      targetDocument.removeEventListener(eventName, handler, true);
    });
    if (targetDocument === document) {
      this._activeDomListeners.clear();
    }
  },

  /**
   * Detach navigation event listeners
   */
  detachNavigationListeners: function() {
    this._activeNavigationListeners.forEach(({ handler, options }, eventName) => {
      window.removeEventListener(eventName, handler, options);
    });
    this._activeNavigationListeners.clear();
  },

  /**
   * Initialize with navigation handler map
   */
  setNavigationHandlers: function(handlerMap) {
    this.NAVIGATION_HANDLER_MAP = handlerMap;
  }
};

