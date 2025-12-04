import { triggerCaptureAfterEvent} from '../capture/html-capture.js'

export function attachMainOnlyListeners() {
    console.log('adding special listeners')
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'HTML_CAPTURE_FROM_EVENT') {
        const isTopFrame = (window.top === window.self);
        const context = isTopFrame ? 'TOP-LEVEL DOCUMENT' : 'IFRAME (Nested Frame)';
        console.log(`HTML capture from event [${context}]`)
        triggerCaptureAfterEvent(message.eventType); 
        sendResponse({ status: "ACK" });
    }
    return true;
    });
}