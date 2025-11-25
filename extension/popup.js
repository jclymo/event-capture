// Popup UI orchestrator - modular architecture
// 
// This is the main entry point that coordinates all popup functionality:
// - ui: Toast notifications, status badges, timer, summary display
// - state: Popup state management and recording status
// - storage: Task history, sorting, and persistence
// - recording: Start/stop recording lifecycle
// - sync: MongoDB push operations
// - input: Task description handling

(function() {
  console.log('🎯 Task Recorder Popup initializing...');

  // Import and initialize when DOM is ready
  document.addEventListener('DOMContentLoaded', async function() {
    console.log("Popup opened");
    
    // Import all modules
    const [
      { ensureToast, showToast },
      { setRecordingStatus, setSummaryBadge },
      { startTimer },
      { initializePopupElements, getLastCompletedTaskId },
      { refreshSummaryFromStorage, checkStorage },
      { initializeTaskDescriptionInput },
      { setupStartButton },
      { setupStopButton },
      { setupPushButton }
    ] = await Promise.all([
      import('./popup/ui/toast.js'),
      import('./popup/ui/status-badge.js'),
      import('./popup/ui/timer.js'),
      import('./popup/state/popup-state.js'),
      import('./popup/storage/task-storage.js'),
      import('./popup/input/task-description.js'),
      import('./popup/recording/start-recording.js'),
      import('./popup/recording/stop-recording.js'),
      import('./popup/sync/mongo-sync.js')
    ]);

    // Initialize toast
    ensureToast();
    checkStorage();
    
    // Initialize popup elements
    initializePopupElements();
    
    // Initialize task description input
    initializeTaskDescriptionInput();
    
    // Check if currently recording
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
    
    // Setup button handlers
    setupStartButton();
    setupStopButton();
    setupPushButton(getLastCompletedTaskId);
    
    // Setup history button
    const historyButton = document.getElementById('historyButton');
    if (historyButton) {
      historyButton.addEventListener('click', () => {
        const url = chrome.runtime.getURL('history.html');
        chrome.tabs.create({ url });
      });
    }
    
    // Setup task details button
    const taskDetailsButton = document.getElementById('taskDetailsButton');
    if (taskDetailsButton) {
      taskDetailsButton.addEventListener('click', () => {
        const lastTaskId = getLastCompletedTaskId();
        if (!lastTaskId) {
          showToast('Record a task to view details.', 'error');
          return;
        }
        chrome.runtime.sendMessage({ action: 'viewTaskDetails', taskId: lastTaskId });
      });
    }
    
    // Initialize summary
    setSummaryBadge('No tasks yet', '#94a3b8');
    refreshSummaryFromStorage();
    
    console.log('✅ Popup initialized');
  });

  // Listen for refresh messages
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.action === 'refreshSummary') {
      import('./popup/storage/task-storage.js').then(({ refreshSummaryFromStorage }) => {
        refreshSummaryFromStorage();
      });
    }
  });

  console.log('✅ Popup orchestrator ready');
})();
