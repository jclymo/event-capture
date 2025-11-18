// BrowserGym script injection handler
// Injects browsergym-inject.js into tabs for DOM element marking

export function handleBrowserGymInjection(message, sender, sendResponse) {
  const tabId = sender.tab?.id;
  if (!tabId) {
    sendResponse?.({ success: false, error: 'Tab context is missing' });
    return true;
  }

  const target = sender.frameId != null
    ? { tabId, frameIds: [sender.frameId] }
    : { tabId, allFrames: true };

  chrome.scripting.executeScript({
    target,
    files: ['browsergym-inject.js']
  }).then((results) => {
    console.log('BrowserGym injected frames:', results?.map(r => r.frameId));
    sendResponse?.({ success: true, frames: results?.map(r => r.frameId) });
  }).catch(err => {
    console.error('BrowserGym scripting injection failed:', err);
    sendResponse?.({ success: false, error: err.message || String(err) });
  });
  return true;
}

