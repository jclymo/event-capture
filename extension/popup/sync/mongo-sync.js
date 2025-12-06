// MongoDB sync functionality

import { showToast } from '../ui/toast.js';
import { refreshSummaryFromStorage } from '../storage/task-storage.js';
import { getTaskTitle, setTaskTitle, TASK_TITLE_STORAGE_KEY } from '../input/task-description.js';

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

export async function pushTaskToMongo(taskData, buttonElement) {
  if (!taskData) {
    showToast('Task data not available.', 'error');
    return;
  }

  // Update title from input
  const updatedTitle = getTaskTitle();
  taskData.title = updatedTitle;
  taskData.task = updatedTitle;
  setTaskTitle(updatedTitle);

  // Reconstruct HTML content from IndexedDB before building payload
  if (taskData.events && Array.isArray(taskData.events)) {
    try {
      taskData.events = await reconstructHtmlInEvents(taskData.events);
    } catch (err) {
      console.error('Error reconstructing HTML content:', err);
      // Continue with events as-is - server will receive documentPath references
    }
  }

  const payload = window.buildTaskPayload ? window.buildTaskPayload(taskData) : null;

  if (!payload) {
    showToast('Unable to build payload from task data.', 'error');
    return;
  }

  try {
    let pushedOk = false;
    // Attach local video path if available
    try {
      const store = await chrome.storage.local.get(['videoStartedAtMs']);
      const iso = store?.videoStartedAtMs ? new Date(store.videoStartedAtMs).toISOString().replace(/[:.]/g, '-') : null;
      if (iso) {
        payload.video_local_path = `Downloads/event-capture-archives/${iso}/video.webm`;
      }
    } catch (err) {
      console.error('Error retrieving videoStartedAtMs from storage:', err);
    }
    if (buttonElement) {
      buttonElement.disabled = true;
      buttonElement.textContent = 'Pushing...';
    }

    const result = window.sendTaskPayload ? await window.sendTaskPayload(payload) : null;
    try {
      // Notify background so it can upload pending video with folderIso
      if (result && result.folderIso) {
        await chrome.runtime.sendMessage({ type: 'INGEST_DONE', folderIso: result.folderIso });
      }
    } catch (messageError) {
      console.error('Failed to notify background of INGEST_DONE:', messageError);
    }
    try {
      if (window.savePayloadAndAssets) {
        await window.savePayloadAndAssets(taskData, payload, { success: true, response: result });
      }
    } catch (archiveError) {
      console.error('Failed to archive payload locally:', archiveError);
    }

    if (result && result.success) {
      showToast('Latest recording synced to MongoDB.', 'success');
      pushedOk = true;
      const taskId = taskData.id;
      if (taskId) {
        chrome.storage.local.get(['taskHistory'], (data) => {
          const taskHistory = data.taskHistory || {};
          if (taskHistory[taskId]) {
            taskHistory[taskId].pushedToMongo = true;
            taskHistory[taskId].pushedAt = Date.now();
            chrome.storage.local.set({ taskHistory }, () => {
              refreshSummaryFromStorage();
            });
          } else {
            refreshSummaryFromStorage();
          }
        });
      } else {
        refreshSummaryFromStorage();
      }
    } else {
      showToast('Task data sent (check server).', 'success');
    }
  } catch (error) {
    console.error('Error pushing to MongoDB:', error);
    try {
      if (window.savePayloadAndAssets) {
        await window.savePayloadAndAssets(taskData, payload, { success: false, error: error.message });
      }
    } catch (archiveError) {
      console.error('Failed to archive payload after error:', archiveError);
    }
    showToast('Could not sync to MongoDB.', 'error');
  } finally {
    if (buttonElement) {
      if (pushedOk) {
        buttonElement.disabled = true;
        buttonElement.textContent = 'Synced';
      } else {
        buttonElement.disabled = false;
        buttonElement.textContent = 'Sync to MongoDB';
      }
    }
  }
}

export function setupPushButton(getLastCompletedTaskId) {
  const mainPushButton = document.getElementById('pushToMongo');
  if (!mainPushButton) return;
  
  mainPushButton.addEventListener('click', () => {
    const lastCompletedTaskId = getLastCompletedTaskId();
    if (!lastCompletedTaskId) {
      showToast('Finish a recording before syncing.', 'error');
      return;
    }

    chrome.storage.local.get(['taskHistory'], (data) => {
      const taskHistory = data.taskHistory || {};
      const taskData = taskHistory[lastCompletedTaskId];

      if (!taskData) {
        showToast('Latest task not found. Please record again.', 'error');
        return;
      }

      const updatedTitle = getTaskTitle();
      taskData.title = updatedTitle;
      taskData.task = updatedTitle;
      setTaskTitle(updatedTitle);
      taskHistory[lastCompletedTaskId] = taskData;

      chrome.storage.local.set({ taskHistory, [TASK_TITLE_STORAGE_KEY]: updatedTitle }, () => {
        pushTaskToMongo(taskData, mainPushButton);
      });
    });
  });
}

