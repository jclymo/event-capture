// Start recording logic

import { startTimer } from '../ui/timer.js';
import { setRecordingStatus } from '../ui/status-badge.js';
import { showToast } from '../ui/toast.js';
import { getTaskTitle, setTaskTitle } from '../input/task-description.js';
import { setLastCompletedTaskId } from '../state/popup-state.js';

export function setupStartButton() {
  const startButton = document.getElementById('startTask');
  if (!startButton) return;
  
  startButton.addEventListener('click', async () => {
    try {
      // Disable start button, enable end button
      startButton.disabled = true;
      document.getElementById('endTask').disabled = false;
      const mainPushButton = document.getElementById('pushToMongo');
      if (mainPushButton) {
        mainPushButton.disabled = true;
      }
      setLastCompletedTaskId(null);

      // Get active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // Check if we can inject scripts into this tab
      if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('brave://')) {
        console.error("Cannot inject scripts into browser pages. Please navigate to a website first.");
        alert("Cannot record on browser pages. Please navigate to a website first.");
        startButton.disabled = false;
        document.getElementById('endTask').disabled = true;
        setRecordingStatus('Idle', 'idle');
        return;
      }
      
      // Generate a unique task ID
      const taskId = 'task_' + Date.now();
      const startTime = Date.now();
      const taskTitle = getTaskTitle();
      setTaskTitle(taskTitle);
      
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
        startButton.disabled = false;
        document.getElementById('endTask').disabled = true;
        const { stopTimer } = await import('../ui/timer.js');
        stopTimer();
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
}

