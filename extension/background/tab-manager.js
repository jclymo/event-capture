// Tab lifecycle management module
// Handles recorder injection and tab monitoring

// Helper function to check if a URL is injectable
function isInjectableUrl(url) {
  if (!url) return false;
  
  const protectedPrefixes = [
    'chrome://',
    'chrome-extension://',
    'about:',
    'edge://',
    'view-source:',
    'data:',
    'javascript:'
  ];
  
  // Check if URL starts with any protected prefix
  return !protectedPrefixes.some(prefix => url.startsWith(prefix));
}

export async function injectRecorderIntoTab(tabId, reason = '') {
  if (typeof tabId !== 'number') {
    return;
  }

  try {
    // Get tab info to check URL before injection
    const tab = await chrome.tabs.get(tabId);
    
    // Check if URL is injectable
    if (!isInjectableUrl(tab.url)) {
      console.warn(`⚠️ Cannot inject recorder into protected URL: ${tab.url}`);
      return;
    }
    
    // Check if it's the Chrome Web Store
    if (tab.url.includes('chrome.google.com/webstore')) {
      console.warn(`⚠️ Cannot inject recorder into Chrome Web Store`);
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['recorder.js']
    });
    if (reason) {
      console.log(`✅ Recorder injected into tab ${tabId} (${reason})`);
    } else {
      console.log(`✅ Recorder injected into tab ${tabId}`);
    }
  } catch (err) {
    console.error(`❌ Recorder injection failed${reason ? ` (${reason})` : ''}:`, err);
  }
}

export function rehydrateRecordingTab(reason = '') {
  chrome.storage.local.get(['isRecording', 'recordingTabId'], (data) => {
    if (!data?.isRecording || typeof data.recordingTabId !== 'number') {
      return;
    }
    injectRecorderIntoTab(data.recordingTabId, reason);
  });
}

// Setup all tab-related listeners
export function setupTabListeners() {
  // Listen for tab updates (including URL changes)
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') {
      // Check if we're recording and this is the recording tab
      chrome.storage.local.get(['isRecording', 'recordingTabId', 'currentTaskId', 'taskHistory', 'videoStartedAtMs'], (data) => {
        if (data.isRecording && data.recordingTabId === tabId && data.currentTaskId) {
          console.log("🔄 Navigation detected in recording tab:", tab.url);
          
          // Check if URL is injectable before attempting
          if (!isInjectableUrl(tab.url)) {
            console.warn(`⚠️ Recording paused - navigated to protected page: ${tab.url}`);
            console.warn(`💡 Navigate to a regular web page to continue recording`);
            return;
          }
          
          // Inject recorder script into the new page
          injectRecorderIntoTab(tabId, 'tab updated');
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
      }
    });
  });

  // Listen for storage changes to trigger rehydration
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') {
      return;
    }

    let triggerReason = null;

    if (changes.isRecording && changes.isRecording.newValue === true) {
      triggerReason = 'recording toggled on';
    } else if (changes.recordingTabId && typeof changes.recordingTabId.newValue === 'number') {
      triggerReason = 'recording tab updated';
    }

    if (triggerReason) {
      rehydrateRecordingTab(triggerReason);
    }
  });

  console.log('✅ Tab lifecycle listeners initialized');
}

