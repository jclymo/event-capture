(function() {
    'use strict';
    
    // Prevent re-injection
    if (window.taskRecorderInitialized) {
      console.log("Recorder script re-injected, skipping");
      return;
    }
    window.taskRecorderInitialized = true;
    console.log("Recorder script loaded and initialized");
    
    // ============================================================
    // IMPORT MODULES (loaded via manifest)
    // ============================================================
    const DOM = window.RecorderDOMUtils;
    const IframeManager = window.RecorderIframeManager;
    const EventHandlers = window.RecorderEventHandlers;
    
    // ============================================================
    // STATE & CONSTANTS
    // ============================================================
    let isRecording = false;
    let currentTaskId = null;
    let events = [];
    let recordingStartAtMs = null;
    let dynamicObserver = null;
    
    // HTML Capture state
    let lastHtmlCapture = 0;
    let isNewPageLoad = true;
    let HTMLCOOLDOWN = 3000;
    let htmlCaptureLocked = false;
    let HTMLCOOLDOWNOVERRIDE = Date.now() - 3000;
    
    // Prebuffer
    const prebufferEvents = [];
    const PREBUFFER_WINDOW_MS = 2000;
    
    // State tracking
    const trackedIframes = new WeakSet();
    const criticalDomListeners = new Map();
    let cachedEventConfig = null;
    let enabledDomEventNames = null;
    let enabledNavigationEventNames = null;
    
    const lastEventData = {
      type: null,
      target: null,
      value: null,
      timestamp: 0,
      lastInputValue: null
    };
    
    const navigationState = {
      lastUrl: null,
      lastTitle: null,
      pendingNavigation: false
    };
    
    const recoveryState = {
      lastSavedTimestamp: Date.now(),
      errorCount: 0,
      maxErrors: 3
    };
    
    const EVENT_TYPES = {
      INPUT: 'input',
      CLICK: 'click',
      NAVIGATION: 'navigation',
      SCROLL: 'scroll',
      SUBMIT: 'submit',
      CHANGE: 'change',
      MOUSE_OVER: 'mouseover',
      MOUSE_OUT: 'mouseout',
      KEY_DOWN: 'keydown',
      KEY_UP: 'keyup',
      KEY_PRESS: 'keypress',
      POINTER_DOWN: 'pointerdown',
      POINTER_UP: 'pointerup',
      POINTER_MOVE: 'pointermove'
    };
    
    const clickState = {
      lastClickTime: 0,
      lastMouseUpTime: 0,
      lastClickTarget: null,
      lastClickButton: null,
      lastClickCoords: null,
      clickCount: 0
    };
    
    const eventVerification = {
      clicks: [],
      inputs: [],
      navigations: [],
      lastEventTime: 0
    };
    
    const testMode = {
      enabled: true,
      validationQueue: [],
      lastValidationTime: 0,
      validationInterval: 1000,
      maxQueueSize: 100
    };
    
    // ============================================================
    // HTML CAPTURE
    // ============================================================
    
    function requestHtmlCapture(eventTimestamp) {
      if (htmlCaptureLocked) {
        return;
      }
      htmlCaptureLocked = true;
      const now = Date.now();
      
      if (isNewPageLoad || (now - HTMLCOOLDOWNOVERRIDE)<250 || (now - lastHtmlCapture) >= HTMLCOOLDOWN) {
        lastHtmlCapture = Date.now();
        captureHtml(eventTimestamp);
        isNewPageLoad = false;
      }
      
      htmlCaptureLocked = false;
    }
    
    function captureHtml(eventType) {
      console.log('📸 HTML capture approved for:', eventType);
      
      const clone = document.documentElement.cloneNode(true);
      
      clone.querySelectorAll('script, noscript').forEach(el => el.remove());
      clone.querySelectorAll('*').forEach(el => {
        for (const attr of Array.from(el.attributes)) {
          if (attr.name.startsWith('on')) el.removeAttribute(attr.name);
        }
      });
      
      const styles = Array.from(document.styleSheets);
      for (const sheet of styles) {
        try {
          const rules = Array.from(sheet.cssRules)
            .map(r => r.cssText.replace(/\s+/g, ' ').trim())
            .join('');
          const style = document.createElement('style');
          style.textContent = rules;
          clone.querySelector('head').appendChild(style);
        } catch (err) {
          console.warn('Skipped stylesheet:', sheet.href);
        }
      }
      
      clone.querySelectorAll('img, video, source').forEach(el => {
        el.removeAttribute('src');
      });
      
      const currentHtml =
        '<!DOCTYPE html>\n' +
        clone.outerHTML
          .replace(/\s+/g, ' ')
          .replace(/> </g, '><');
      
      chrome.runtime.sendMessage({ 
        type: 'htmlCapture', 
        event: {
          html: currentHtml,
          type: 'htmlCapture',
          eventType: eventType,
          timestamp: Date.now(),
          url: window.location.href
        } 
      });
      
      if (eventType === "change") {
        HTMLCOOLDOWNOVERRIDE = Date.now();
      }
    }
    
    function formatTimestamp(timestamp) {
      return new Date(timestamp).toISOString();
    }
    
    document.addEventListener('DOMContentLoaded', function() {
      isNewPageLoad = true;
      requestHtmlCapture('new page loaded');
    });
    
    // ============================================================
    // PREBUFFER
    // ============================================================
    
    function prunePrebuffer() {
      const now = Date.now();
      while (prebufferEvents.length && (now - prebufferEvents[0].ts) > PREBUFFER_WINDOW_MS) {
        prebufferEvents.shift();
      }
      const MAX_BUFFER = 100;
      if (prebufferEvents.length > MAX_BUFFER) {
        prebufferEvents.splice(0, prebufferEvents.length - MAX_BUFFER);
      }
    }
    
    function minimalEventSnapshot(e) {
      const base = {
        type: e.type,
        target: e.target,
        isSynthetic: true
      };
      if (e.type === 'click' || e.type === 'mousedown' || e.type === 'mouseup' || e.type === 'pointerdown' || e.type === 'pointerup') {
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
    
    function flushPrebuffer(startMs) {
      try {
        const cutoff = (typeof startMs === 'number' ? startMs : Date.now()) - 250;
        const items = prebufferEvents.filter(x => x.ts >= cutoff);
        if (items.length) {
          console.log('Flushing prebuffered events:', items.length);
        }
        items.forEach(({ ev }) => {
          try { recordEvent(ev); } catch (err) { console.warn('Failed to flush prebuffered event:', err); }
        });
      } finally {
        prebufferEvents.length = 0;
      }
    }
    
    function prebufferCallback(e) {
      const snap = minimalEventSnapshot(e);
      prebufferEvents.push({ ts: Date.now(), ev: snap });
      prunePrebuffer();
    }
    
    // ============================================================
    // HELPER FUNCTIONS
    // ============================================================
    
    const debouncedRecordInput = DOM.debounce((e) => {
      const val = DOM.getElementValueUnified(e.target);
      if (val !== lastEventData.lastInputValue) {
        recordEvent(e);
      }
    }, 300);
    
    const debouncedRecordScroll = DOM.debounce((e) => {
      recordEvent(e);
    }, 100);
    
    // ============================================================
    // EVENT FILTERING & RECORDING
    // ============================================================
    
    function shouldIgnoreEvent(event, type) {
      const { primary: resolvedTarget, original: originalTarget } = DOM.resolveEventTarget(event.target);
      const element = resolvedTarget || originalTarget;
      if (!element) {
        return true;
      }
      
      const currentValue = DOM.getElementValueUnified(element);
      const currentTime = Date.now();
      
      if (type === EVENT_TYPES.CLICK || type === 'mouseup') {
        const isClickEvent = type === EVENT_TYPES.CLICK;
        const sameTarget = element === clickState.lastClickTarget;
        const sameButton = clickState.lastClickButton === event.button;
        const lastCoords = clickState.lastClickCoords;
        const currentCoords = {
          x: typeof event.screenX === 'number' ? event.screenX : 0,
          y: typeof event.screenY === 'number' ? event.screenY : 0
        };
        const previousTime = isClickEvent ? clickState.lastClickTime : clickState.lastMouseUpTime;
        
        if (lastCoords && sameButton) {
          const deltaX = Math.abs(currentCoords.x - lastCoords.x);
          const deltaY = Math.abs(currentCoords.y - lastCoords.y);
          const isSameSpot = deltaX <= 2 && deltaY <= 2;
          if (isSameSpot && previousTime && (currentTime - previousTime) < 200) {
            return true;
          }
        }
        
        if (isClickEvent && previousTime && sameTarget && (currentTime - previousTime) < 25) {
          return true;
        }
        
        if (isClickEvent) {
          clickState.lastClickTime = currentTime;
        } else {
          clickState.lastMouseUpTime = currentTime;
        }
        clickState.lastClickTarget = element;
        clickState.lastClickButton = event.button;
        clickState.lastClickCoords = currentCoords;
        clickState.clickCount++;
        
        if (DOM.isInteractiveElement(element)) {
          return false;
        }
      }
      
      if (type === EVENT_TYPES.INPUT) {
        if (currentValue === lastEventData.lastInputValue) {
          return true;
        }
        lastEventData.lastInputValue = currentValue;
      }
      
      if (type === EVENT_TYPES.SCROLL) {
        const scrollThreshold = 50;
        if (Math.abs(event.deltaY) < scrollThreshold) {
          return true;
        }
      }
      
      if (type === EVENT_TYPES.MOUSE_OVER || type === EVENT_TYPES.MOUSE_OUT) {
        if (!DOM.isInteractiveElement(element) && !element.hasAttribute('title')) {
          return true;
        }
      }
      
      if (type !== EVENT_TYPES.CLICK &&
          type !== EVENT_TYPES.INPUT &&
          lastEventData.type === type && 
          lastEventData.target === element && 
          currentTime - lastEventData.timestamp < 300) {
        return true;
      }
      
      lastEventData.type = type;
      lastEventData.target = element;
      lastEventData.value = currentValue;
      lastEventData.timestamp = currentTime;
      
      return false;
    }
    
    function recordEvent(event) {
      if (!isRecording) {
        console.debug(`🚫 Event ${event.type} not recorded - isRecording is false`);
        return;
      }
      
      if (enabledDomEventNames && !enabledDomEventNames.has(event.type)) {
        console.debug(`Ignoring DOM event '${event.type}' because it is disabled in configuration.`);
        return;
      }
      
      if (shouldIgnoreEvent(event, event.type)) {
        return;
      }
      console.log(`📝 Recording event: ${event.type}`);
      
      const { primary: targetElement, original: originalTarget } = DOM.resolveEventTarget(event.target);
      const metadataElement = targetElement || originalTarget;
      
      if (!metadataElement) {
        console.warn('Unable to resolve a target element for event:', event.type);
        return;
      }
      
      const targetMetadata = DOM.buildTargetMetadata(metadataElement);
      if (!targetMetadata) {
        console.warn('Failed to build metadata for event target:', metadataElement);
        return;
      }
      
      const inIframe = window !== window.top;
      const iframeInfo = inIframe ? {
        isInIframe: true,
        iframeUrl: window.location.href,
        topUrl: window.top?.location?.href || 'unknown'
      } : { isInIframe: false };
      
      const eventData = {
        type: event.type,
        timestamp: Date.now(),
        url: window.location.href,
        target: targetMetadata,
        ...iframeInfo
      };
      
      if (originalTarget && originalTarget !== metadataElement) {
        eventData.originalTarget = {
          tag: originalTarget.tagName,
          id: originalTarget.id,
          class: originalTarget.className,
          cssPath: DOM.getElementCssPath(originalTarget),
          xpath: DOM.getElementXPath(originalTarget)
        };
      }
      
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
        eventData.detail = event.detail;
      }
      
      if (event.type === EVENT_TYPES.INPUT || event.type === EVENT_TYPES.CHANGE) {
        eventData.inputType = event.inputType;
        eventData.data = event.data;
        const activeElement = metadataElement;
        const unifiedValue = DOM.getElementValueUnified(activeElement);
        eventData.value = unifiedValue;
        eventData.oldValue = lastEventData.lastInputValue;
        lastEventData.lastInputValue = unifiedValue;
        if (activeElement && typeof activeElement.selectionStart === 'number') {
          eventData.selectionStart = activeElement.selectionStart;
          eventData.selectionEnd = activeElement.selectionEnd;
          eventData.selectionDirection = activeElement.selectionDirection || null;
        }
      }
      
      if (event.type === EVENT_TYPES.SCROLL) {
        const target = metadataElement === document.documentElement ? document.scrollingElement || document.documentElement : metadataElement;
        if (target) {
          eventData.scroll = {
            scrollTop: target.scrollTop,
            scrollLeft: target.scrollLeft,
            scrollHeight: target.scrollHeight,
            scrollWidth: target.scrollWidth,
            clientHeight: target.clientHeight,
            clientWidth: target.clientWidth
          };
        }
      }
      
      chrome.runtime.sendMessage({ type: 'recordedEvent', event: eventData });
      requestHtmlCapture(event.type);
      
      events.push(eventData);
      saveEvents();
    }
    
    // ============================================================
    // SESSION MANAGEMENT
    // ============================================================
    
    async function initializeRecording() {
      console.log('Initializing recording with configurable listeners');
      
      try {
        const config = await EventHandlers.loadEventConfig();
        
        EventHandlers.detachDomListeners();
        EventHandlers.detachNavigationListeners();
        
        const enabledDomEvents = (config.domEvents || []).filter(evt => evt && evt.enabled !== false);
        enabledDomEventNames = new Set(enabledDomEvents.map(evt => evt.name));
        console.log('Enabled DOM events:', Array.from(enabledDomEventNames));
        
        const handlers = {
          recordEvent: recordEvent,
          debouncedRecordInput: debouncedRecordInput,
          debouncedRecordScroll: debouncedRecordScroll
        };
        
        EventHandlers.attachDomListenersToDocument(document, handlers);
        
        const enabledNavigationEvents = (config.navigationEvents || []).filter(evt => evt && evt.enabled !== false);
        enabledNavigationEventNames = new Set(enabledNavigationEvents.map(evt => evt.name));
        console.log('Enabled navigation events:', Array.from(enabledNavigationEventNames));
        
        EventHandlers.attachNavigationListeners(handlers);
        
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
    
    async function initializeRecordingSession(taskId, options = {}) {
      const {
        isResuming = false,
        existingEvents = [],
        clearCache = false,
        startAtMs = null
      } = options;
      
      console.log(`Initializing recording session: ${isResuming ? 'RESUMED' : 'NEW'}`, { taskId });
      
      isRecording = true;
      currentTaskId = taskId;
      events = existingEvents;
      recordingStartAtMs = startAtMs || Date.now();
      
      if (clearCache) {
        cachedEventConfig = null;
      }
      
      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        initializeRecording();
      } else {
        document.addEventListener('DOMContentLoaded', initializeRecording);
      }
      
      flushPrebuffer(recordingStartAtMs);
      
      try {
        const injectionSuccess = await IframeManager.injectBrowserGymScript();
        if (injectionSuccess) {
          console.log('✅ BrowserGym injection successful');
          IframeManager.startBrowserGymObserver(isRecording);
        } else {
          console.warn('⚠️ BrowserGym injection failed, using fallback BIDs');
        }
      } catch (err) {
        console.error('❌ BrowserGym injection error:', err);
      }
      
      // Create wrapper functions that capture recorder scope
      const preAttachForIframe = (iframeDoc) => {
        EventHandlers.preAttachCriticalListeners(iframeDoc, isRecording, recordEvent, prebufferCallback);
      };
      
      const attachListenersForIframe = (iframeDoc) => {
        const handlers = {
          recordEvent: recordEvent,
          debouncedRecordInput: debouncedRecordInput,
          debouncedRecordScroll: debouncedRecordScroll
        };
        EventHandlers.attachDomListenersToDocument(iframeDoc, handlers);
      };
      
      IframeManager.startIframeObserver(isRecording, preAttachForIframe, attachListenersForIframe);
      IframeManager.instrumentAllIframes(isRecording, preAttachForIframe, attachListenersForIframe);
    }
    
    function startRecording(taskId, startAtMs) {
      console.log("🎬 Recording started for task:", taskId);
      
      chrome.storage.local.get(['taskHistory'], (data) => {
        const taskHistory = data.taskHistory || {};
        const existingEvents = taskHistory[taskId] ? (taskHistory[taskId].events || []) : [];
        
        console.log("🎬 Retrieved existing events:", existingEvents.length);
        
        initializeRecordingSession(taskId, {
          isResuming: false,
          existingEvents: existingEvents,
          clearCache: true,
          startAtMs
        });
        
        console.log("🎬 isRecording after initialization:", isRecording);
        console.log("🎬 currentTaskId:", currentTaskId);
      });
    }
    
    function stopRecording() {
      console.log("⏹️ Recording stopped");
      isRecording = false;
      
      EventHandlers.detachDomListeners();
      EventHandlers.detachNavigationListeners();
      
      if (dynamicObserver) {
        try {
          dynamicObserver.disconnect();
          dynamicObserver = null;
        } catch (e) {
          console.error("Error disconnecting observer:", e);
        }
      }
      
      IframeManager.stopBrowserGymObserver();
      IframeManager.stopIframeObserver();
      
      console.log("Recorded events to save:", events);
      
      if (currentTaskId) {
        chrome.storage.local.get(['taskHistory'], function(data) {
          const taskHistory = data.taskHistory || {};
          
          if (taskHistory[currentTaskId]) {
            taskHistory[currentTaskId].events = events;
            
            chrome.storage.local.set({ taskHistory: taskHistory }, function() {
              if (chrome.runtime.lastError) {
                console.error("Events failed to save:", chrome.runtime.lastError);
                return;
              }
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
            
            chrome.storage.local.set({ taskHistory: taskHistory }, function() {
              if (chrome.runtime.lastError) {
                console.error("Events failed to save:", chrome.runtime.lastError);
                recoveryState.errorCount++;
                if (recoveryState.errorCount >= recoveryState.maxErrors) {
                  attemptRecovery();
                }
                return;
              }
              recoveryState.lastSavedTimestamp = Date.now();
              recoveryState.errorCount = 0;
            });
          }
        });
      } catch (error) {
        console.error("Error saving events:", error);
        recoveryState.errorCount++;
        
        if (recoveryState.errorCount >= recoveryState.maxErrors) {
          attemptRecovery();
        }
      }
    }
    
    // ============================================================
    // NAVIGATION
    // ============================================================
    
    function handleNavigation(event) {
      if (!isRecording) return;
      
      const currentUrl = window.location.href;
      const previousUrl = navigationState.lastUrl || document.referrer;
      
      if (currentUrl !== previousUrl) {
        recordNavigationEvent(previousUrl, currentUrl, event?.type);
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
    
    function attemptRecovery() {
      console.log("Attempting recovery from errors...");
      
      recoveryState.errorCount = 0;
      
      try {
        localStorage.setItem('eventCaptureBackup', JSON.stringify({
          events: events,
          timestamp: Date.now(),
          taskId: currentTaskId
        }));
      } catch (e) {
        console.error("Failed to create backup:", e);
      }
      
      initializeRecording();
    }
    
    function recordNavigationEvent(fromUrl, toUrl, rawType) {
      if (!isRecording) return;
      
      let eventType = rawType || EVENT_TYPES.NAVIGATION;
      if (enabledNavigationEventNames) {
        if (enabledNavigationEventNames.has(eventType)) {
          // ok
        } else if (!rawType && enabledNavigationEventNames.has(EVENT_TYPES.NAVIGATION)) {
          eventType = EVENT_TYPES.NAVIGATION;
        } else {
          console.debug(`Ignoring navigation event '${eventType}' because it is disabled in configuration.`);
          return;
        }
      }
      
      const eventData = {
        type: eventType,
        category: EVENT_TYPES.NAVIGATION,
        timestamp: formatTimestamp(Date.now()),
        fromUrl: fromUrl,
        toUrl: toUrl,
        title: document.title,
        referrer: document.referrer,
        fromUserInput: clickState.clickCount > 0
      };
      
      events.push(eventData);
      eventVerification.navigations.push({
        time: Date.now(),
        type: eventType,
        fromUrl,
        toUrl
      });
      saveEvents();
      
      navigationState.lastUrl = toUrl;
      navigationState.lastTitle = document.title;
      navigationState.pendingNavigation = false;
      
      clickState.clickCount = 0;
      
      console.log(`Navigation recorded:`, {
        type: eventType,
        from: fromUrl,
        to: toUrl,
        userInitiated: clickState.clickCount > 0,
        totalNavigations: eventVerification.navigations.length
      });
    }
    
    // ============================================================
    // INITIALIZATION
    // ============================================================
    
    // Initialize modules
    IframeManager.init(trackedIframes);
    
    // Set navigation handlers
    const NAVIGATION_HANDLER_MAP = {
      popstate: handleNavigation,
      pushState: handleNavigation,
      replaceState: handleNavigation,
      beforeunload: handleBeforeUnload
    };
    EventHandlers.setNavigationHandlers(NAVIGATION_HANDLER_MAP);
    
    // Pre-attach critical listeners
    if (!window.__recorderCriticalAttached) {
      EventHandlers.preAttachCriticalListeners(document, isRecording, recordEvent, prebufferCallback);
      window.__recorderCriticalAttached = true;
    } else {
      console.log('Critical listeners already attached (previous injection)');
    }
    
    // Load event config
    EventHandlers.loadEventConfig();
    
    // Check if we should be recording (handles navigation during recording)
    chrome.storage.local.get(['isRecording', 'currentTaskId', 'taskHistory'], (data) => {
      console.log("Checking recording state:", data);
      if (data.isRecording && data.currentTaskId) {
        const existingEvents = (data.taskHistory && data.taskHistory[data.currentTaskId]) 
          ? (data.taskHistory[data.currentTaskId].events || [])
          : [];
        
        initializeRecordingSession(data.currentTaskId, {
          isResuming: true,
          existingEvents: existingEvents,
          clearCache: false
        });
      }
    });
    
    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log("📬 Message received in recorder:", message);
      console.log("📬 Current recording state:", { isRecording, currentTaskId, eventsCount: events.length });
      
      if (message.action === "startRecording") {
        startRecording(message.taskId, message.startAtMs);
        sendResponse({status: "recording started", isRecording, taskId: currentTaskId});
      } else if (message.action === "stopRecording") {
        stopRecording();
        sendResponse({status: "recording stopped", eventsCount: events.length});
      }
      return true;
    });
    
    console.log("✅ Recorder fully initialized and ready");
    
})();

