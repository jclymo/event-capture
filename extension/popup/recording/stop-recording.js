// Stop recording logic

import { stopTimer } from '../ui/timer.js';
import { setRecordingStatus } from '../ui/status-badge.js';
import { showToast } from '../ui/toast.js';
import { refreshSummaryFromStorage } from '../storage/task-storage.js';
import { setLastCompletedTaskId } from '../state/popup-state.js';

export function setupStopButton() {
  const endButton = document.getElementById('endTask');
  if (!endButton) return;
  
  endButton.addEventListener('click', async () => {
    try {
      // Disable end button, enable start button
      endButton.disabled = true;
      document.getElementById('startTask').disabled = false;
      
      // Clear timer
      stopTimer();
      
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

          setLastCompletedTaskId(taskId);
          const mainPushButton = document.getElementById('pushToMongo');
          const taskDetailsButton = document.getElementById('taskDetailsButton');
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
}

