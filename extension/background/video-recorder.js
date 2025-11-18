// Video recording module for Task Recorder
// Handles screen recording via offscreen document and video upload

import { API_BASE, API_KEY_HEADER } from './config.js';

// Screen recording state
export const videoRecording = {
  isActive: false,
  startedAtMs: null,
  folderIso: null,
  localPath: null
};

export let pendingVideoBlob = null;

export function setPendingVideoBlob(blob) {
  pendingVideoBlob = blob;
}

export async function ensureOffscreenDocument() {
  try {
    const has = await chrome.offscreen.hasDocument?.();
    if (has) {
      console.log('Offscreen document already exists');
      return;
    }
    console.log('Creating offscreen document for screen recording...');
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DISPLAY_MEDIA'],  // For getDisplayMedia/screen capture
      justification: 'Record whole screen during task'
    });
    console.log('Offscreen document created successfully');
  } catch (e) {
    console.error('Failed to create offscreen document:', e);
    throw new Error(`Offscreen document creation failed: ${e.message}`);
  }
}

export async function startScreenRecording() {
  await ensureOffscreenDocument();
  await chrome.runtime.sendMessage({ type: 'OFFSCREEN_START' });
}

export async function stopScreenRecording() {
  await chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP' });
}

export async function uploadVideoBlob(folderIso, blob) {
  try {
    const form = new FormData();
    form.append('folderIso', folderIso);
    form.append('file', new File([blob], 'video.webm', { type: 'video/webm' }));
    const headers = { ...API_KEY_HEADER };
    const resp = await fetch(`${API_BASE}/api/events/video`, {
      method: 'POST',
      body: form,
      headers
    });
    if (!resp.ok) {
      const tx = await resp.text();
      throw new Error(tx || `HTTP ${resp.status}`);
    }
    const json = await resp.json().catch(() => ({}));
    const serverPath = json && json.path ? json.path : null;
    if (serverPath) {
      // Persist on the last completed task for display in details
      chrome.storage.local.get(['taskHistory','lastCompletedTaskId'], (data) => {
        const taskId = data.lastCompletedTaskId;
        if (taskId && data.taskHistory && data.taskHistory[taskId]) {
          data.taskHistory[taskId].video_server_path = serverPath;
          if (videoRecording.localPath) {
            data.taskHistory[taskId].video_local_path = videoRecording.localPath;
          }
          chrome.storage.local.set({ taskHistory: data.taskHistory });
        }
      });
    }
  } catch (err) {
    console.error('Video upload error:', err);
  }
}

// Handle video recording start
export function handleVideoStart(message, sender, sendResponse) {
  startScreenRecording()
    .then(() => sendResponse?.({ ok: true }))
    .catch(err => {
      console.error('start video failed', err);
      sendResponse?.({ ok: false, error: String(err) });
    });
  return true; // Keep message channel open for async response
}

// Handle video recording stop
export function handleVideoStop(message, sender, sendResponse) {
  stopScreenRecording().then(() => {
    // Compute and save local path immediately from videoStartedAtMs
    chrome.storage.local.get(['taskHistory', 'lastCompletedTaskId', 'videoStartedAtMs'], (data) => {
      const taskId = data.lastCompletedTaskId;
      if (taskId && data.taskHistory && data.taskHistory[taskId]) {
        // Compute path from videoStartedAtMs
        const baseIso = data.videoStartedAtMs 
          ? new Date(data.videoStartedAtMs).toISOString().replace(/[:.]/g, '-') 
          : (videoRecording.startedAtMs ? new Date(videoRecording.startedAtMs).toISOString().replace(/[:.]/g, '-') : null);
        
        if (baseIso) {
          const computedPath = `event-capture-archives/${baseIso}/video.webm`;
          data.taskHistory[taskId].video_local_path = computedPath;
          chrome.storage.local.set({ taskHistory: data.taskHistory });
          console.log('Video local path saved on stop:', computedPath);
        }
      }
    });
    sendResponse?.({ ok: true });
  }).catch(err => {
    console.error('stop video failed', err);
    sendResponse?.({ ok: false, error: String(err) });
  });
  return true; // Keep message channel open for async response
}

// Handle offscreen recording started notification
export function handleOffscreenStarted(message, sender, sendResponse) {
  videoRecording.isActive = true;
  videoRecording.startedAtMs = message.startedAtMs;
  chrome.storage.local.set({ videoStartedAtMs: message.startedAtMs });
  sendResponse?.({ ok: true });
  return true;
}

// Handle offscreen recording stopped notification
export function handleOffscreenStopped(message, sender, sendResponse) {
  videoRecording.isActive = false;
  sendResponse?.({ ok: true });
  return true;
}

// Handle blob ready from offscreen document
export function handleBlobReady(message, sender, sendResponse) {
  const { blobUrl } = message;
  (async () => {
    try {
      const res = await fetch(blobUrl);
      const blob = await res.blob();
      // 1) Save locally first under Downloads/event-capture-archives/<iso>/video.webm
      const baseIso = videoRecording.startedAtMs 
        ? new Date(videoRecording.startedAtMs).toISOString().replace(/[:.]/g, '-') 
        : String(Date.now());
      const filename = `event-capture-archives/${baseIso}/video.webm`;

      // Convert blob to data URL (service workers don't have URL.createObjectURL)
      await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const dataUrl = reader.result;
          chrome.downloads.download({
            url: dataUrl,
            filename,
            saveAs: false,
            conflictAction: 'overwrite'
          }, (downloadId) => {
            if (chrome.runtime.lastError) {
              console.error('Video local save failed:', chrome.runtime.lastError);
              // Even if video save fails, attempt to save trace below
            }
            // Try to resolve absolute path using downloads API
            if (typeof downloadId === 'number') {
              chrome.downloads.search({ id: downloadId }, (items) => {
                const abs = Array.isArray(items) && items[0] && items[0].filename ? items[0].filename : null;
                if (abs) {
                  // Persist absolute path on last completed task
                  chrome.storage.local.get(['taskHistory','lastCompletedTaskId'], (data) => {
                    const taskId = data.lastCompletedTaskId;
                    if (taskId && data.taskHistory && data.taskHistory[taskId]) {
                      data.taskHistory[taskId].video_local_path = abs;
                      chrome.storage.local.set({ taskHistory: data.taskHistory });
                    }
                  });
                }
                // After video save, also save a trace.json alongside it
                saveTraceFile(baseIso, filename, resolve);
              });
            } else {
              // No downloadId returned; still attempt to write trace.json
              saveTraceFile(baseIso, filename, resolve);
            }
          });
        };
        reader.readAsDataURL(blob);
      });

      // Store for later upload when folderIso is known
      pendingVideoBlob = blob;
      videoRecording.localPath = filename; // relative path under Downloads

      // Also persist local path to last completed task immediately
      chrome.storage.local.get(['taskHistory','lastCompletedTaskId'], (data) => {
        const taskId = data.lastCompletedTaskId;
        if (taskId && data.taskHistory && data.taskHistory[taskId]) {
          data.taskHistory[taskId].video_local_path = filename;
          chrome.storage.local.set({ taskHistory: data.taskHistory });
        }
      });

      // Try immediate upload if folderIso already present
      chrome.storage.local.get(['lastIngestResponse'], async (data) => {
        const folderIso = data?.lastIngestResponse?.folderIso || videoRecording.folderIso;
        if (folderIso && pendingVideoBlob) {
          await uploadVideoBlob(folderIso, pendingVideoBlob);
          pendingVideoBlob = null;
        }
      });
    } catch (e) {
      console.error('Processing video blob failed:', e);
    } finally {
      // Do not revoke here; offscreen page owns the blob URL
    }
  })();
  sendResponse?.({ ok: true });
  return true;
}

// Handle ingest completion
export function handleIngestDone(message, sender, sendResponse) {
  const { folderIso } = message;
  if (folderIso) videoRecording.folderIso = folderIso;
  (async () => {
    try {
      if (folderIso && pendingVideoBlob) {
        await uploadVideoBlob(folderIso, pendingVideoBlob);
        pendingVideoBlob = null;
      }
    } catch (e) {
      console.error('Deferred upload failed:', e);
    }
  })();
  sendResponse?.({ ok: true });
  return true;
}

// Helper to save trace.json file
function saveTraceFile(baseIso, videoFilename, callback) {
  chrome.storage.local.get(['taskHistory','lastCompletedTaskId'], (data2) => {
    const taskId = data2.lastCompletedTaskId;
    const task = taskId && data2.taskHistory ? data2.taskHistory[taskId] : null;
    if (!task) { 
      callback(); 
      return; 
    }

    const durationSeconds = typeof task.startTime === 'number' && typeof task.endTime === 'number'
      ? Math.max(0, Math.floor((task.endTime - task.startTime) / 1000))
      : null;
      
    const trace = {
      id: task.id,
      title: task.title,
      startUrl: task.startUrl || null,
      endUrl: task.endUrl || null,
      durationSeconds,
      video_local_path: (data2.taskHistory[taskId] && data2.taskHistory[taskId].video_local_path) || videoFilename,
      video_server_path: task.video_server_path || null,
      events: Array.isArray(task.events) ? task.events.map(e => ({
        ...e,
        video_timestamp: typeof e.video_timestamp === 'number' ? e.video_timestamp : (typeof e.videoTimeMs === 'number' ? e.videoTimeMs : null),
        video_event_start_ms: typeof e.video_event_start_ms === 'number' ? e.video_event_start_ms : (typeof e.video_timestamp === 'number' ? e.video_timestamp : (typeof e.videoTimeMs === 'number' ? e.videoTimeMs : null)),
        video_event_end_ms: typeof e.video_event_end_ms === 'number' ? e.video_event_end_ms : (typeof e.video_timestamp === 'number' ? e.video_timestamp : (typeof e.videoTimeMs === 'number' ? e.videoTimeMs : null))
      })) : []
    };

    try {
      const blobTrace = new Blob([JSON.stringify(trace, null, 2)], { type: 'application/json' });
      const fr = new FileReader();
      fr.onloadend = () => {
        const traceUrl = fr.result;
        const traceName = `event-capture-archives/${baseIso}/trace.json`;
        chrome.downloads.download({ 
          url: traceUrl, 
          filename: traceName, 
          saveAs: false, 
          conflictAction: 'overwrite' 
        }, () => {
          if (chrome.runtime.lastError) {
            console.error('Trace save failed:', chrome.runtime.lastError);
          }
          callback();
        });
      };
      fr.readAsDataURL(blobTrace);
    } catch (err) {
      console.error('Trace serialization failed:', err);
      callback();
    }
  });
}

