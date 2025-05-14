// Track navigation events
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    // Check if we're recording
    chrome.storage.local.get(['isRecording', 'recordingTabId'], (data) => {
      if (data.isRecording && data.recordingTabId === tabId) {
        console.log("Navigation detected in recording tab:", tab.url);
        
        // Inject recorder script into the new page
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['recorder.js']
        }).catch(err => console.error("Script injection error:", err));
      }
    });
  }
});

// Listen for task history actions
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "viewTaskDetails") {
    chrome.storage.local.get(['taskHistory'], (data) => {
      const taskHistory = data.taskHistory || {};
      const task = taskHistory[message.taskId];
      
      if (task) {
        // Open a new window with task details
        const detailWindow = window.open('', 'Task Details', 'width=800,height=600');
        const formattedEvents = JSON.stringify(task.events, null, 2);
        
        detailWindow.document.write(`
          <html>
            <head>
              <title>Task Details</title>
              <style>
                body { font-family: monospace; white-space: pre; padding: 20px; }
              </style>
            </head>
            <body>
              <h1>Task Details: ${task.title}</h1>
              <pre>${formattedEvents.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
            </body>
          </html>
        `);
      }
    });
  } else if (message.action === "exportTask") {
    chrome.storage.local.get(['taskHistory'], (data) => {
      const taskHistory = data.taskHistory || {};
      const task = taskHistory[message.taskId];
      
      if (task) {
        // Create a download link for the task data
        const taskData = JSON.stringify(task, null, 2);
        const blob = new Blob([taskData], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        
        chrome.downloads.download({
          url: url,
          filename: `task_${message.taskId}.json`,
          saveAs: true
        });
      }
    });
  } else if (message.action === "deleteTask") {
    chrome.storage.local.get(['taskHistory'], (data) => {
      const taskHistory = data.taskHistory || {};
      
      if (taskHistory[message.taskId]) {
        delete taskHistory[message.taskId];
        
        chrome.storage.local.set({ taskHistory: taskHistory }, function() {
          console.log("Task deleted:", message.taskId);
        });
      }
    });
  }
  
  return true; // Required for async sendResponse
});

// Listen for tab updates (including URL changes)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    // Check if we're recording and this is the recording tab
    chrome.storage.local.get(['isRecording', 'recordingTabId', 'currentTaskId', 'taskHistory'], (data) => {
      if (data.isRecording && data.recordingTabId === tabId && data.currentTaskId) {
        console.log("Navigation detected in recording tab:", tab.url);
        
        // Create navigation event
        const navigationEvent = {
          type: 'navigation',
          toUrl: tab.url,
          timestamp: Date.now(),
          title: tab.title || '',
          fromUserInput: changeInfo.url ? true : false // Best guess if it was from URL bar
        };
        
        // Save to task history
        if (data.taskHistory && data.currentTaskId) {
          const taskHistory = data.taskHistory;
          const taskId = data.currentTaskId;
          
          if (taskHistory[taskId]) {
            const events = taskHistory[taskId].events || [];
            events.push(navigationEvent);
            taskHistory[taskId].events = events;
            
            chrome.storage.local.set({ taskHistory: taskHistory });
          }
        }
        
        // Inject recorder script into the new page
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['recorder.js']
        }).catch(err => console.error("Script injection error:", err));
      }
    });
  }
});

// Listen for tab creation (new tab)
chrome.tabs.onCreated.addListener((tab) => {
  chrome.storage.local.get(['isRecording', 'currentTaskId', 'taskHistory'], (data) => {
    if (data.isRecording && data.currentTaskId) {
      // Update the recording tab ID to the new tab
      chrome.storage.local.set({ recordingTabId: tab.id });
      
      // Record tab creation event
      const tabEvent = {
        type: 'newTab',
        timestamp: Date.now(),
        tabId: tab.id
      };
      
      // Save to task history
      if (data.taskHistory && data.currentTaskId) {
        const taskHistory = data.taskHistory;
        const taskId = data.currentTaskId;
        
        if (taskHistory[taskId]) {
          const events = taskHistory[taskId].events || [];
          events.push(tabEvent);
          taskHistory[taskId].events = events;
          
          chrome.storage.local.set({ taskHistory: taskHistory });
        }
      }
    }
  });
});
