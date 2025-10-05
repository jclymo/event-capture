let mediaRecorder = null;
let chunks = [];
// global stream reference for screenshots
let captureStream = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Message received in screencapture:", message);
  switch (message.action) {
    case 'startScreenCapture':
      // kick off recording right away
      startRecording(message.body.currentTab.id, message.taskId);
      sendResponse({ status: "recording started" });
      return false;  // synchronous response

    case 'stopRecording':
      // stop the recorder immediately
      mediaRecorder && mediaRecorder.stop();
      sendResponse({ status: "recording stopped" });
      return false;  // synchronous response

    case 'takeScreenshot':
      if (!captureStream) {
        // no stream → error back synchronously
        sendResponse({ status: "error", error: "No active stream" });
        return false;
      }
      // async response: keep channel open
      take_screenshot()
        .then(base64Image => {
          sendResponse({ status: "screenshot taken", base64Image });
        })
        .catch(err => {
          sendResponse({ status: "error", error: err.message });
        });
      return true;   // indicates we’ll call sendResponse asynchronously

    case 'screenshotFromChunksAtOffset':
      if (!chunks || chunks.length === 0) {
        sendResponse({ status: "error", error: "No chunks yet" });
        return false;
      }
      // async response: keep channel open
      screenshotFromChunksAtOffset(null, message.offsetSeconds || 1)
        .then(base64Image => {
          sendResponse({ status: "screenshot taken", base64Image });
        })
        .catch(err => {
          sendResponse({ status: "error", error: err.message });
        });
      return true;   // indicates we’ll call sendResponse asynchronously

    default:
      // unrecognized action → no response
      return false;
  }
});






/**
 * Kick off your desktop-capture recording.
 * Also triggers a screenshot at the very start.
 */
function startRecording(currentTabId, taskId) {
  chrome.desktopCapture.chooseDesktopMedia(
    ['screen', 'window'],
    async (streamId) => {
      if (!streamId) return;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: streamId,
            }
          }
        });

        // store globally for screenshots
        captureStream = stream;

        // take a screenshot as soon as we have the stream
        // await take_screenshot('start.png');
        console.log('start.png');
        mediaRecorder = new MediaRecorder(stream);
        chunks = [];
        mediaRecorder.ondataavailable = 
            (e) =>{ chunks.push(e.data);}

        mediaRecorder.onstop = async () => {
          // screenshot at the end If need be
        //   await take_screenshot('end.png');
          console.log('end.png');
          // // assemble and download the video
          const blobFile = new Blob(chunks, { type: 'video/webm' });
          const url = URL.createObjectURL(blobFile);
          stream.getTracks().forEach(t => t.stop());

        //   const downloadLink = document.createElement('a');
        //   downloadLink.href = url;
        //   downloadLink.download = 'demo.webm';
        //   downloadLink.click();
          window.close();
        };

        mediaRecorder.start();

      } catch (err) {
        console.error('getUserMedia failed:', err);
      } finally {
        // refocus the original tab
        await chrome.tabs.update(currentTabId, { active: true });
      }
    }
  );
}


/**
 * Captures one frame from captureStream and
 * downloads it as a PNG with the given filename.
 */
// async function take_screenshot(filename = 'screenshot.png') {
//     if (!captureStream) {
//       console.warn('No active stream to screenshot');
      
//       return;
//     }
  
//     // create an offscreen video element
//     const video = document.createElement('video');
//     video.srcObject = captureStream;
//     video.muted = true;            // avoid audible feedback
//     video.style.display = 'none';  // keep it hidden
  
//     // wait for enough data to be ready
//     await new Promise((res, rej) => {
//       video.onloadedmetadata = res;
//       video.onerror = rej;
//     });
  
//     // play just enough to render a frame
//     await video.play();
  
//     // draw onto canvas
//     const canvas = document.createElement('canvas');
//     canvas.width  = video.videoWidth;
//     canvas.height = video.videoHeight;
//     canvas.getContext('2d').drawImage(video, 0, 0);
  
//     // turn into a Blob
//     const blob = await new Promise(resolve =>
//       canvas.toBlob(resolve, 'image/png')
//     );
  
//     // download
//     const url = URL.createObjectURL(blob);
  
//     // const a = document.createElement('a');
//     // a.href = url;
//     // a.download = filename;
//     // a.click();
//     // URL.revokeObjectURL(url);
  
//     // cleanup
//     video.pause();
//     video.srcObject = null;
//     return url;
//   }
async function take_screenshot() {
    if (!captureStream) {
      console.warn('No active stream to screenshot');
      return null;
    }
  
    // 1) Set up a hidden <video> element
    const video = document.createElement('video');
    video.playsInline = true;
    video.muted       = true;
    video.srcObject   = captureStream;
    video.style.display = 'none';
    document.body.appendChild(video);
  
    // 2) Wait for metadata so we know the dimensions
    await new Promise((resolve, reject) => {
      video.addEventListener('loadedmetadata', resolve, { once: true });
      video.addEventListener('error', reject, { once: true });
    });
    video.width  = video.videoWidth;
    video.height = video.videoHeight;
  
    // 3) Play and wait for the first full frame
    await video.play();
    await new Promise(resolve => {
      // requestVideoFrameCallback fires when a complete frame is ready
      video.requestVideoFrameCallback(() => resolve());
    });
  
    // 4) Draw onto a canvas of the same size
    const canvas = document.createElement('canvas');
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  
    // 5) Extract PNG data URL
    const dataUrl = canvas.toDataURL('image/png');
  
    // 6) Cleanup
    video.pause();
    video.srcObject = null;
    document.body.removeChild(video);
  
    return dataUrl;
  }
  
  
  
  
  async function screenshotFromChunksAtOffset(filename = 'before_current.png', offsetSeconds = 1) {
    if (!chunks || chunks.length === 0) {
      console.warn('No video chunks available yet');
      return;
    }
  
    // 1) Build a Blob of all recorded chunks so far
    const blob = new Blob(chunks, { type: 'video/webm' });
    const url  = URL.createObjectURL(blob);
  
  
    // 2) Load into a hidden video element
    const video = document.createElement('video');
    video.src       = url;
    video.muted     = true;
    video.style.display = 'none';
    document.body.appendChild(video);
  
    // 3) Wait for metadata so we know duration
    await new Promise((res, rej) => {
      video.onloadedmetadata = res;
      video.onerror          = rej;
    });
  
    // 4) Compute the target time: duration − offsetSeconds
    const targetTime = Math.max(0, video.duration - offsetSeconds);
  
    // 5) Seek to that time (only if it's > 0)
    if (targetTime > 0) {
      await new Promise(res => {
        video.currentTime = targetTime;
        video.onseeked    = res;
      });
    }
  
    // 6) Draw that frame onto a canvas
    const canvas = document.createElement('canvas');
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx     = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
  
    // 7) Convert to PNG and download
  
    const dataUrl = canvas.toDataURL('image/png'); 
    // → "data:image/png;base64,iVBORw0K…"
    
    
    // 2) To show it in an <img>:
    // const img = document.createElement('img');
    // img.src = dataUrl;
    // document.body.appendChild(img);
    
    // 3) To trigger a download:
    // const link = document.createElement('a');
    // link.href = dataUrl;
    // link.download = 'screenshot.png';
    // link.click();
    // 8) Cleanup
    // URL.revokeObjectURL(url);
    document.body.removeChild(video);
    return dataUrl;
  }
