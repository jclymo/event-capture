// Details window script for viewing a task's recorded events.
//
// Purpose: Render a human-readable view of a single task's events with basic
// filtering and sorting. Provides a button that pushes the normalized task
// payload to the configured backend (the same flow used by the popup).
//
// What it does:
// - Reads the taskId from the query string.
// - Loads the task from chrome.storage.local and renders events.
// - Provides simple filter (by type) and sort (by timestamp/type).
// - Includes a push button to POST the task to the backend API.

// Parse taskId from URL
const urlParams = new URLSearchParams(window.location.search);
const taskId = urlParams.get('taskId');

document.getElementById('eventData').textContent = 'Loading...';
document.getElementById('eventCount').textContent = '';

const pushButton = document.getElementById('pushToMongoBtn');
let currentTask = null;

function normalizeEvents(events = []) {
  return events.map((event) => ({
    ...event,
    video_timestamp: typeof event.video_timestamp === 'number'
      ? event.video_timestamp
      : (typeof event.videoTimeMs === 'number' ? event.videoTimeMs : null),
  }));
}

/**
 * Open HTML document in a new tab
 * @param {string} documentKey - The IndexedDB key for the HTML document
 */
async function openHtmlDocument(documentKey) {
  try {
    // Request HTML content from background script
    const response = await chrome.runtime.sendMessage({
      type: 'GET_HTML_DOCUMENT',
      documentKey: documentKey
    });
    
    if (response && response.success && response.html) {
      // Create a blob URL and open in new tab
      const blob = new Blob([response.html], { type: 'text/html' });
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, '_blank');
      
      // Clean up blob URL after a delay (tab will have loaded by then)
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    } else {
      alert('Could not load HTML document: ' + (response?.error || 'Unknown error'));
    }
  } catch (err) {
    console.error('Error opening HTML document:', err);
    alert('Error opening HTML document: ' + err.message);
  }
}

/**
 * Reconstruct HTML content via background message passing
 * Uses single source of truth in background/html-indexeddb.js
 * @param {Array} events - Array of events
 * @returns {Promise<Array>} - Events with html property restored
 */
async function reconstructHtmlInEvents(events) {
  if (!Array.isArray(events)) return events;
  
  // Check if there are any htmlCapture events that need reconstruction
  const needsReconstruction = events.some(e => 
    e.type === 'htmlCapture' && e.documentKey && !e.html
  );
  
  if (!needsReconstruction) {
    console.log('📄 No HTML reconstruction needed');
    return events;
  }
  
  console.log('📄 Requesting HTML reconstruction from background...');
  
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'RECONSTRUCT_HTML_EVENTS',
      events: events
    });
    
    if (response && response.success) {
      const restored = response.events.filter(e => e.type === 'htmlCapture' && e.html).length;
      const total = response.events.filter(e => e.type === 'htmlCapture').length;
      console.log(`📄 Reconstructed ${restored}/${total} HTML documents`);
      return response.events;
    } else {
      console.warn('⚠️ HTML reconstruction failed:', response?.error);
      return events;
    }
  } catch (err) {
    console.error('Error requesting HTML reconstruction:', err);
    return events;
  }
}

async function pushTaskToMongo(buttonElement) {
  if (!currentTask) {
    alert('Task data not available.');
    return;
  }

  // Reconstruct HTML content from IndexedDB before building payload
  let eventsToSync = currentTask.events;
  if (eventsToSync && Array.isArray(eventsToSync)) {
    try {
      eventsToSync = await reconstructHtmlInEvents(eventsToSync);
    } catch (err) {
      console.error('Error reconstructing HTML content:', err);
      // Continue with events as-is
    }
  }

  const taskWithReconstructedHtml = { ...currentTask, events: eventsToSync };
  const payload = buildTaskPayload(taskWithReconstructedHtml);
  if (!payload) {
    alert('Unable to build payload from task data.');
    return;
  }

  payload.data = eventsToSync;
  if (currentTask.video_local_path) payload.video_local_path = currentTask.video_local_path;
  if (currentTask.video_server_path) payload.video_server_path = currentTask.video_server_path;

  try {
    let pushedOk = false;
    if (buttonElement) {
      buttonElement.disabled = true;
      buttonElement.textContent = 'Pushing...';
    }

    const result = await sendTaskPayload(payload);
    if (
      result &&
      result.folderIso &&
      typeof chrome !== 'undefined' &&
      chrome.runtime &&
      typeof chrome.runtime.sendMessage === 'function'
    ) {
      try {
        await chrome.runtime.sendMessage({ type: 'INGEST_DONE', folderIso: result.folderIso });
      } catch (messageError) {
        console.warn('Failed to notify background of INGEST_DONE:', messageError);
      }
    }

    try {
      await savePayloadAndAssets(currentTask, payload, { success: true, response: result });
    } catch (archiveError) {
      console.warn('Failed to archive payload locally:', archiveError);
    }

    if (result && result.success) {
      pushedOk = true;
      chrome.storage.local.get(['taskHistory'], (data) => {
        const taskHistory = data.taskHistory || {};
        if (taskHistory[currentTask.id]) {
          taskHistory[currentTask.id].pushedToMongo = true;
          taskHistory[currentTask.id].pushedAt = Date.now();
          chrome.storage.local.set({ taskHistory });
        }
      });
      alert('Task synced to MongoDB.');
    } else {
      alert('Task sent to MongoDB (check server response).');
    }
  } catch (error) {
    console.error('Error pushing to MongoDB:', error);
    try {
      await savePayloadAndAssets(currentTask, payload, { success: false, error: error.message });
    } catch (archiveError) {
      console.warn('Failed to archive payload after error:', archiveError);
    }
    alert('Could not sync to MongoDB: ' + error.message);
  } finally {
    if (buttonElement) {
      if (pushedOk) {
        buttonElement.disabled = true;
        buttonElement.textContent = 'Already synced';
      } else {
        buttonElement.disabled = false;
        buttonElement.textContent = 'Sync to MongoDB';
      }
    }
  }
}

document.addEventListener('DOMContentLoaded', function() {
  chrome.storage.local.get(['taskHistory'], (data) => {
    const task = data.taskHistory?.[taskId];
    if (!task) {
      document.getElementById('taskTitle').textContent = 'Task not found';
      document.getElementById('eventData').textContent = '';
      if (pushButton) pushButton.disabled = true;
      return;
    }

    document.getElementById('taskTitle').textContent = task.title + (task.pushedToMongo ? ' (synced to MongoDB)' : '');
    const events = normalizeEvents(task.events || []);
    const eventTypes = Array.from(new Set(events.map(e => e.type))).sort();
    currentTask = { ...task, events };

    // Populate filter dropdown
    const filter = document.getElementById('eventTypeFilter');
    filter.innerHTML = '<option value="">All</option>' + eventTypes.map(type => `<option value="${type}">${type}</option>`).join('');
    let currentSort = 'timestamp';
    let currentFilter = '';

    function renderEvents() {
      let filtered = events;
      if (currentFilter) filtered = filtered.filter(e => e.type === currentFilter);
      if (currentSort === 'type') {
        filtered = filtered.slice().sort((a, b) => a.type.localeCompare(b.type) || a.timestamp - b.timestamp);
      } else {
        filtered = filtered.slice().sort((a, b) => a.timestamp - b.timestamp);
      }
      document.getElementById('eventCount').textContent = `Total Events: ${filtered.length}`;
      
      // Show full JSON with video paths and per-event timestamps
      const full = {
        id: task.id,
        title: task.title,
        startUrl: task.startUrl,
        endUrl: task.endUrl,
        durationSeconds: Math.floor(((task.endTime||0) - (task.startTime||0)) / 1000),
        video_local_path: task.video_local_path || null,
        video_server_path: task.video_server_path || null,
        events: filtered.map(e => ({
          ...e,
          video_timestamp: typeof e.video_timestamp === 'number' ? e.video_timestamp : (typeof e.videoTimeMs === 'number' ? e.videoTimeMs : null)
        }))
      };
      
      // Convert to JSON string
      let jsonStr = JSON.stringify(full, null, 2);
      
      // Escape HTML entities first
      jsonStr = jsonStr.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      
      // Make documentKey values clickable (matches "documentKey": "value")
      jsonStr = jsonStr.replace(
        /"documentKey":\s*"([^"]+)"/g,
        '"documentKey": "<span class="doc-link" data-key="$1">$1 [View HTML]</span>"'
      );
      
      // Use innerHTML to render clickable links
      const eventDataEl = document.getElementById('eventData');
      eventDataEl.innerHTML = jsonStr;
      
      // Attach click handlers to all doc-link elements
      eventDataEl.querySelectorAll('.doc-link').forEach(link => {
        link.addEventListener('click', () => {
          const key = link.getAttribute('data-key');
          if (key) openHtmlDocument(key);
        });
      });
    }

    filter.addEventListener('change', function(e) {
      currentFilter = e.target.value;
      renderEvents();
    });

    document.getElementById('sortBtn').addEventListener('click', function() {
      if (currentSort === 'timestamp') {
        currentSort = 'type';
        this.textContent = 'Sort by Timestamp';
      } else {
        currentSort = 'timestamp';
        this.textContent = 'Sort by Event Type';
      }
      renderEvents();
    });

    if (pushButton) {
      pushButton.disabled = events.length === 0 || !!task.pushedToMongo;
      if (task.pushedToMongo) {
        pushButton.textContent = 'Already synced';
      }
      pushButton.addEventListener('click', function() {
        pushTaskToMongo(pushButton);
      });
    }

    renderEvents();
  });
});
