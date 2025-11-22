// Popup UI controller for the extension.
//
// Purpose: Provide a simple UI to start/stop recording on the active tab,
// show a summary, and send the recorded task to the backend API.
//
// What it does:
// - Manages the recording lifecycle (start/stop) and persists state.
// - Injects `recorder.js` into the active tab when recording starts.
// - Builds a payload and calls the API helpers from `config.js`.
// - Offers quick access to view history and export/delete tasks.

// Add this function to check storage
function checkStorage() {
  chrome.storage.local.get(null, function(data) {
    console.log("All storage data:", data);
  });
}

const timerElement = document.getElementById('timer');
const statusBadge = document.getElementById('recordingStatus');
const summaryBadge = document.getElementById('summaryBadge');
let taskDetailsButton = null;

let timerInterval;
let mainPushButton = null;
let lastCompletedTaskId = null;
const taskDescriptionInput = document.getElementById('taskDescription');
const TASK_TITLE_STORAGE_KEY = 'taskTitleDraft';
let sortedTaskList = [];
let unsyncedTasksCount = 0;

// Lightweight toast element for quick feedback
let toastElement = null;
let toastTimeoutId = null;

function ensureToast() {
  if (!toastElement) {
    toastElement = document.createElement('div');
    toastElement.className = 'toast';
    document.body.appendChild(toastElement);
  }
}

function showToast(message, variant = 'default') {
  ensureToast();
  toastElement.textContent = message;
  toastElement.className = 'toast';
  if (variant === 'success') {
    toastElement.classList.add('toast--success');
  } else if (variant === 'error') {
    toastElement.classList.add('toast--error');
  }
  toastElement.classList.add('toast--visible');
  if (toastTimeoutId) {
    clearTimeout(toastTimeoutId);
  }
  toastTimeoutId = setTimeout(() => {
    toastElement.classList.remove('toast--visible');
  }, 2200);
}

function setRecordingStatus(text, variant = 'idle') {
  if (!statusBadge) return;
  statusBadge.textContent = text;
  statusBadge.classList.remove('status-pill--idle', 'status-pill--recording', 'status-pill--finished');
  let background = '#0284c7';
  if (variant === 'recording') {
    statusBadge.classList.add('status-pill--recording');
    background = '#b91c1c';
  } else if (variant === 'finished') {
    statusBadge.classList.add('status-pill--finished');
    background = '#16a34a';
  } else {
    statusBadge.classList.add('status-pill--idle');
    background = '#0284c7';
  }
  statusBadge.style.backgroundColor = background;
}

function setSummaryBadge(text, background = '#22c55e') {
  if (!summaryBadge) return;
  summaryBadge.textContent = text;
  summaryBadge.style.backgroundColor = background;
}

function sortTasksBySync(taskHistory = {}) {
  const tasks = Object.values(taskHistory || {});
  return tasks.slice().sort((a, b) => {
    const aSynced = a.pushedToMongo ? 1 : 0;
    const bSynced = b.pushedToMongo ? 1 : 0;
    if (aSynced !== bSynced) {
      return aSynced - bSynced;
    }
    const aTime = (a.endTime || a.startTime || 0);
    const bTime = (b.endTime || b.startTime || 0);
    return bTime - aTime;
  });
}

function startTimer(startTime) {
  const updateTimer = () => {
    const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    if (timerElement) {
      timerElement.textContent = `Time: ${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
  };
  
  // Clear any existing timer
  if (timerInterval) clearInterval(timerInterval);
  
  // Update immediately and then every second
  updateTimer();
  timerInterval = setInterval(updateTimer, 1000);
}

function refreshSummaryFromStorage() {
  chrome.storage.local.get(['taskHistory'], (data) => {
    const taskHistory = data.taskHistory || {};
    sortedTaskList = sortTasksBySync(taskHistory);
    const pending = sortedTaskList.filter((t) => !t.pushedToMongo);
    unsyncedTasksCount = pending.length;
    const summaryTask = pending[0] || sortedTaskList[0];
    if (summaryTask) {
      lastCompletedTaskId = summaryTask.id;
      showTaskSummary(summaryTask, unsyncedTasksCount);
    } else {
      const resultsDiv = document.getElementById('results');
      if (resultsDiv) {
        resultsDiv.innerHTML = `<p class="placeholder-text">Finish a recording to populate this summary area.</p>`;
      }
      setSummaryBadge('No tasks yet', '#94a3b8');
      if (mainPushButton) {
        mainPushButton.disabled = true;
        mainPushButton.textContent = 'Sync to MongoDB';
      }
      if (taskDetailsButton) {
        taskDetailsButton.disabled = true;
      }
    }
  });
}

// Initialize task description input
if (taskDescriptionInput) {
  chrome.storage.local.get([TASK_TITLE_STORAGE_KEY], (data) => {
    const storedTitle = data[TASK_TITLE_STORAGE_KEY];
    if (typeof storedTitle === 'string') {
      taskDescriptionInput.value = storedTitle;
    }
  });

  taskDescriptionInput.addEventListener('input', () => {
    chrome.storage.local.set({ [TASK_TITLE_STORAGE_KEY]: taskDescriptionInput.value });
  });
}

async function pushTaskToMongo(taskData, buttonElement) {
  if (!taskData) {
    showToast('Task data not available.', 'error');
    return;
  }

  if (taskDescriptionInput) {
    const updatedTitle = taskDescriptionInput.value.trim() || 'Untitled Task';
    taskData.title = updatedTitle;
    taskData.task = updatedTitle;
    taskDescriptionInput.value = updatedTitle;
    chrome.storage.local.set({ [TASK_TITLE_STORAGE_KEY]: updatedTitle });
  }

  const payload = buildTaskPayload(taskData);

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

    const result = await sendTaskPayload(payload);
    try {
      // Notify background so it can upload pending video with folderIso
      if (result && result.folderIso) {
        await chrome.runtime.sendMessage({ type: 'INGEST_DONE', folderIso: result.folderIso });
      }
    } catch (messageError) {
      console.error('Failed to notify background of INGEST_DONE:', messageError);
    }
    try {
      await savePayloadAndAssets(taskData, payload, { success: true, response: result });
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
      await savePayloadAndAssets(taskData, payload, { success: false, error: error.message });
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

document.getElementById('startTask').addEventListener('click', async () => {
  try {
    // Disable start button, enable end button
    document.getElementById('startTask').disabled = true;
    document.getElementById('endTask').disabled = false;
    if (mainPushButton) {
      mainPushButton.disabled = true;
    }
    lastCompletedTaskId = null;

    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Check if we can inject scripts into this tab
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('brave://')) {
      console.error("Cannot inject scripts into browser pages. Please navigate to a website first.");
      alert("Cannot record on browser pages. Please navigate to a website first.");
      document.getElementById('startTask').disabled = false;
      document.getElementById('endTask').disabled = true;
      setRecordingStatus('Idle', 'idle');
      return;
    }
    
    // Generate a unique task ID
    const taskId = 'task_' + Date.now();
    const startTime = Date.now();
    const taskTitle = taskDescriptionInput ? (taskDescriptionInput.value.trim() || 'Untitled Task') : 'Untitled Task';
    if (taskDescriptionInput) {
      taskDescriptionInput.value = taskTitle;
      chrome.storage.local.set({ [TASK_TITLE_STORAGE_KEY]: taskTitle });
    }
    
    // Initialize a new task record
    await new Promise((resolve) => chrome.storage.local.get(['taskHistory'], function(data) {
      const taskHistory = data.taskHistory || {};
      
      // Create a new task entry
      taskHistory[taskId] = {
        id: taskId,
        startTime: startTime,
        events: [],
        status: 'recording',
        startUrl: tab.url,
        title: taskTitle,
        task: taskTitle
      };
      
      // Save the updated task history
      chrome.storage.local.set({ 
        taskHistory: taskHistory,
        currentTaskId: taskId,
        isRecording: true,
        recordingStartTime: startTime,
        recordingTabId: tab.id
      }, function() {
        console.log("New task started:", taskId);
        resolve();
      });
    }));
    
    // Start timer
    startTimer(startTime);
    
    // Start screen recording and wait for it to initialize AFTER timer begins
    try {
      const videoResult = await chrome.runtime.sendMessage({ type: 'POPUP_START_VIDEO' });
      if (!videoResult || !videoResult.ok) {
        throw new Error('Screen recording failed to start');
      }
      // Wait for videoStartedAtMs to be persisted
      await new Promise(resolve => setTimeout(resolve, 300));
    } catch (e) {
      console.error('Failed to start video:', e);
      alert('Screen recording failed. Please try again.');
      // Roll back recording state
      await new Promise((resolve) => chrome.storage.local.get(['taskHistory'], (data) => {
        const taskHistory = data.taskHistory || {};
        if (taskHistory[taskId]) {
          taskHistory[taskId].status = 'cancelled';
        }
        chrome.storage.local.set({
          taskHistory,
          isRecording: false,
          recordingStartTime: null,
          currentTaskId: null,
          recordingTabId: null
        }, resolve);
      }));
      // Reset UI
      document.getElementById('startTask').disabled = false;
      document.getElementById('endTask').disabled = true;
      if (timerInterval) clearInterval(timerInterval);
      if (timerElement) timerElement.textContent = '';
      return;
    }

    // Always inject the latest content script, then robust start handshake
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['recorder.js'] });
      await new Promise(r => setTimeout(r, 100));
    } catch (e) {
      console.warn('Initial recorder injection failed (will retry if needed):', e);
    }

    // Robust start handshake: wait for ack; reinject once if needed
    const sendStart = () => new Promise(resolve => {
      let settled = false;
      const t = setTimeout(() => { if (!settled) resolve(null); }, 800);
      try {
        chrome.tabs.sendMessage(tab.id, { action: "startRecording", taskId, startAtMs: startTime }, (resp) => {
          clearTimeout(t);
          settled = true;
          resolve(resp);
        });
      } catch (_) {
        clearTimeout(t);
        resolve(null);
      }
    });

    let ack = await sendStart();
    if (!ack || ack.status !== 'recording started') {
      console.warn('Recorder did not ack; attempting one reinjection...');
      await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['recorder.js'] });
      await new Promise(r => setTimeout(r, 150));
      ack = await sendStart();
    }
    if (!ack || ack.status !== 'recording started') {
      console.warn('Recorder still not acknowledged. If events do not appear, refresh the page.');
    } else {
      console.log('Recording started ack:', ack);
    }
    setRecordingStatus('Recording', 'recording');
    showToast('Recording started.', 'success');
  } catch (error) {
    console.error("Error starting recording:", error);
    alert("Error: " + error.message);
    // Reset buttons
    document.getElementById('startTask').disabled = false;
    document.getElementById('endTask').disabled = true;
    setRecordingStatus('Idle', 'idle');
  }
});

document.getElementById('endTask').addEventListener('click', async () => {
  try {
    // Disable end button, enable start button
    document.getElementById('endTask').disabled = true;
    document.getElementById('startTask').disabled = false;
    
    // Clear timer
    if (timerInterval) clearInterval(timerInterval);
    if (timerElement) timerElement.textContent = '';
    
    // Get current task ID
    chrome.storage.local.get(['currentTaskId', 'recordingTabId', 'taskHistory'], async (data) => {
      const taskId = data.currentTaskId;
      
      if (taskId && data.taskHistory && data.taskHistory[taskId]) {
        // Update task status
        const taskHistory = data.taskHistory;
        taskHistory[taskId].status = 'completed';
        taskHistory[taskId].endTime = Date.now();

        // Get the current tab to record the end URL
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        taskHistory[taskId].endUrl = tab.url;
        
        // Save the updated task history
        chrome.storage.local.set({ 
          taskHistory: taskHistory,
          isRecording: false,
          recordingStartTime: null,
          recordingTabId: null,
          currentTaskId: null,
          lastCompletedTaskId: taskId
        });

        console.log("Task completed:", taskId);

        // Show task summary
        refreshSummaryFromStorage();
        setRecordingStatus('Idle', 'finished');

        lastCompletedTaskId = taskId;
        if (mainPushButton) {
          mainPushButton.disabled = false;
        }
        if (taskDetailsButton) {
          taskDetailsButton.disabled = false;
        }
        showToast('Recording finished.', 'success');
      }
      
      if (data.recordingTabId) {
        try {
          // Send message to stop recording
          chrome.tabs.sendMessage(data.recordingTabId, { action: "stopRecording" });
        } catch (e) {
          console.error("Error sending stop message:", e);
        }
      }

      // Stop screen recording
      try {
        await chrome.runtime.sendMessage({ type: 'POPUP_STOP_VIDEO' });
      } catch (e) {
        console.error('Failed to stop video:', e);
      }
    });
  } catch (error) {
    console.error("Error stopping recording:", error);
    alert("Error: " + error.message);
  }
});

// Function to show task summary
function showTaskSummary(taskData, pendingCount = 0) {
  // Create or get the results container
  let resultsDiv = document.getElementById('results');
  if (!resultsDiv) {
    resultsDiv = document.createElement('div');
    resultsDiv.id = 'results';
    document.body.appendChild(resultsDiv);
  }
  
  // Clear previous results
  resultsDiv.innerHTML = '';
  
  const safeTitle = (taskData && typeof taskData.title === 'string' && taskData.title.trim())
    ? taskData.title.trim()
    : 'Untitled task';
  const events = Array.isArray(taskData.events) ? taskData.events : [];
  const totalEvents = events.length;
  const durationSeconds = taskData.endTime && taskData.startTime
    ? Math.max(0, Math.floor((taskData.endTime - taskData.startTime) / 1000))
    : 0;
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;

  const countsByType = events.reduce((acc, ev) => {
    const t = ev && ev.type ? String(ev.type) : 'unknown';
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});
  const clickCount = countsByType.click || 0;
  const keyCount =
    (countsByType.keydown || 0) +
    (countsByType.keyup || 0) +
    (countsByType.keypress || 0);
  const inputCount = countsByType.input || 0;

  const startTime = taskData.startTime ? new Date(taskData.startTime) : null;
  const endTime = taskData.endTime ? new Date(taskData.endTime) : null;
  const formatClock = (d) =>
    d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';

  // Create summary header
  const header = document.createElement('h2');
  header.textContent = 'Task Summary';
  resultsDiv.appendChild(header);

  const summaryContainer = document.createElement('div');
  summaryContainer.className = 'summary-rows';

  const rows = [
    ['Task', safeTitle],
    ['Duration', `${minutes}m ${seconds.toString().padStart(2, '0')}s`],
    [
      'Events',
      `${totalEvents} total  •  ${clickCount} clicks  •  ${keyCount} keys  •  ${inputCount} inputs`
    ],
    [
      'Time window',
      `${formatClock(startTime)} → ${formatClock(endTime)}`
    ]
  ];

  rows.forEach(([label, value]) => {
    const row = document.createElement('div');
    row.className = 'summary-row';

    const labelSpan = document.createElement('span');
    labelSpan.className = 'summary-label';
    labelSpan.textContent = label;

    const valueSpan = document.createElement('span');
    valueSpan.className = 'summary-value';
    valueSpan.textContent = value;

    row.appendChild(labelSpan);
    row.appendChild(valueSpan);
    summaryContainer.appendChild(row);
  });

  resultsDiv.appendChild(summaryContainer);
  const summaryNote = document.createElement('div');
  summaryNote.className = 'summary-note';
  summaryNote.textContent = pendingCount > 0
    ? `${pendingCount} task${pendingCount === 1 ? '' : 's'} waiting to sync`
    : 'All recorded tasks synced';
  resultsDiv.appendChild(summaryNote);
  const alreadyPushed = !!taskData.pushedToMongo;
  if (alreadyPushed) {
    setSummaryBadge(`Synced · ${totalEvents} events`, '#16a34a');
  } else {
    setSummaryBadge(`Ready to sync · ${totalEvents} events`, '#22c55e');
  }

  if (mainPushButton) {
    const canPush = totalEvents > 0 && !alreadyPushed;
    mainPushButton.disabled = !canPush;
    mainPushButton.textContent = alreadyPushed ? 'Synced to MongoDB' : 'Sync to MongoDB';
  }
  if (taskDetailsButton) {
    taskDetailsButton.disabled = totalEvents === 0;
  }
}

// Function to view task history
function addTaskHistoryButton() {
  const historyButton = document.getElementById('historyButton');
  if (!historyButton) return;

  historyButton.addEventListener('click', () => {
    const url = chrome.runtime.getURL('history.html');
    chrome.tabs.create({ url });
  });
}

// Call this function when the popup is loaded
document.addEventListener('DOMContentLoaded', async function() {
  console.log("Popup opened");
  ensureToast();
  checkStorage();
  
  mainPushButton = document.getElementById('pushToMongo');
  taskDetailsButton = document.getElementById('taskDetailsButton');
  if (mainPushButton) {
    mainPushButton.disabled = true;
  }
  
  chrome.storage.local.get(['isRecording', 'recordingStartTime'], (data) => {
    if (data.isRecording) {
      document.getElementById('startTask').disabled = true;
      document.getElementById('endTask').disabled = false;
      
      if (data.recordingStartTime) {
        startTimer(data.recordingStartTime);
      }
      setRecordingStatus('Recording', 'recording');
    } else {
      setRecordingStatus('Idle', 'idle');
    }
  });
  
  addTaskHistoryButton();
  setSummaryBadge('No tasks yet', '#94a3b8');

  refreshSummaryFromStorage();

  if (mainPushButton) {
    mainPushButton.addEventListener('click', () => {
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

        const updatedTitle = taskDescriptionInput ? (taskDescriptionInput.value.trim() || 'Untitled Task') : taskData.title;
        taskData.title = updatedTitle;
        taskData.task = updatedTitle;
        if (taskDescriptionInput) {
          taskDescriptionInput.value = updatedTitle;
        }
        taskHistory[lastCompletedTaskId] = taskData;

        chrome.storage.local.set({ taskHistory, [TASK_TITLE_STORAGE_KEY]: updatedTitle }, () => {
          pushTaskToMongo(taskData, mainPushButton);
        });
      });
    });
  }

  if (taskDetailsButton) {
    taskDetailsButton.addEventListener('click', () => {
      if (!lastCompletedTaskId) {
        showToast('Record a task to view details.', 'error');
        return;
      }
      chrome.runtime.sendMessage({ action: 'viewTaskDetails', taskId: lastCompletedTaskId });
    });
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.action === 'refreshSummary') {
    refreshSummaryFromStorage();
  }
});
