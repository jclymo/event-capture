import { captureState} from '../capture/html-capture.js'

export function attachMainOnlyListeners() {
    console.log('adding special listeners for top level doc')
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'HTML_CAPTURE_FROM_EVENT') {
        captureState(message.eventType); 
        sendResponse({ status: "ACK" });
    }
    return true;
    });
}