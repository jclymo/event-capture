# Background Service Worker Modules

This directory contains the modular architecture for the Task Recorder background service worker.

## Architecture Overview

The monolithic `background.js` (558 lines) has been split into focused, maintainable modules:

```
background/
├── config.js (11 lines) - Shared configuration
├── video-recorder.js (297 lines) - Screen recording & upload
├── event-storage.js (117 lines) - Event persistence & queuing
├── tab-manager.js (81 lines) - Tab lifecycle management
├── browsergym-injector.js (27 lines) - BrowserGym injection
└── message-router.js (103 lines) - Central message routing
```

**Main entry point:** `background.js` (24 lines)

## Module Responsibilities

### config.js
- Exports shared constants (API_BASE, API_KEY_HEADER)
- Single source of truth for configuration

### video-recorder.js
**Exports:**
- `videoRecording` - Recording state object
- `startScreenRecording()` - Initiates screen capture
- `stopScreenRecording()` - Stops capture
- `uploadVideoBlob()` - Uploads video to server
- `handleVideoStart/Stop/Blob/etc()` - Message handlers

**What it does:**
- Manages offscreen document for screen recording
- Handles video blob processing and downloads
- Generates trace.json files alongside videos
- Uploads videos to server when folder available

### event-storage.js
**Exports:**
- `eventQueue` - Queue system for event storage
- `recordingDebug` - Debug state tracking
- `updateEventStorage()` - Persist events to chrome.storage
- `addRelativeRecordingTimestampToEvent()` - Add video timestamps

**What it does:**
- Queues events to avoid race conditions
- Adds relative video timestamps to events
- Persists events to chrome.storage.local
- Provides debug information

### tab-manager.js
**Exports:**
- `injectRecorderIntoTab()` - Inject recorder.js
- `rehydrateRecordingTab()` - Re-inject after navigation
- `setupTabListeners()` - Initialize all tab listeners

**What it does:**
- Monitors tab creation and updates
- Injects recorder script on navigation
- Handles recording tab lifecycle
- Responds to storage changes

### browsergym-injector.js
**Exports:**
- `handleBrowserGymInjection()` - Message handler

**What it does:**
- Injects browsergym-inject.js into tabs/frames
- Handles BrowserGym marking requests
- Reports injection success/failure

### message-router.js
**Exports:**
- `setupMessageHandlers()` - Initialize all message routing

**What it does:**
- Central message dispatch hub
- Routes messages to appropriate module handlers
- Handles task management actions (view, export, delete)
- Coordinates all chrome.runtime.onMessage listeners

## Benefits of Modular Architecture

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| **Main file size** | 558 lines | 24 lines | **95.7% reduction** |
| **Modules** | 1 monolithic | 6 focused | **Better separation** |
| **Testability** | Hard | Easy | **Unit testable** |
| **Maintainability** | Low | High | **Clear responsibilities** |
| **Code reuse** | None | Possible | **Modular imports** |
| **Debugging** | Difficult | Easy | **Isolated concerns** |

## Usage in Main background.js

```javascript
import { setupMessageHandlers } from './background/message-router.js';
import { setupTabListeners } from './background/tab-manager.js';

// Initialize all modules
setupMessageHandlers();
setupTabListeners();
```

## ES Modules Support

**manifest.json configuration:**
```json
"background": {
  "service_worker": "background.js",
  "type": "module"
}
```

Chrome 91+ supports ES modules in service workers.

## State Management

Shared state is managed through:
- **Exports from modules** (e.g., `videoRecording` from video-recorder.js)
- **chrome.storage.local** for persistent state
- **Event queue** for ordered operations

## Testing

Each module can be tested independently:

```javascript
// Example: Testing video-recorder.js
import { videoRecording, startScreenRecording } from './background/video-recorder.js';

// Test recording state
assert(videoRecording.isActive === false);

// Test start function
await startScreenRecording();
assert(videoRecording.isActive === true);
```

## Migration Notes

- All functionality preserved from original implementation
- No breaking changes to external interfaces
- Backward compatible with existing popup.js and recorder.js
- Chrome extension APIs work identically in modules

## Future Enhancements

Potential additions:
- Add TypeScript for type safety
- Implement unit tests for each module
- Add module-level documentation with JSDoc
- Consider state management library for complex shared state
- Add performance monitoring per module

