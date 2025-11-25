const ignore = new Set([
  // Mouse movement
  "mousemove",
  "mouseout",
  "mouseover",
  "deviceorientationabsolute",
  "devicemotion",
  // Pointer noise
  "pointermove",
  "pointerrawupdate",
  "pointerover",
  "pointerout",
  "pointerenter",
  "pointerleave",
  "transitioncancel",
  "wheel",
  "mousewheel",

  // CSS transitions
  "transitionend",
  "transitionstart",
  "transitionrun"
]);

for (let key in window) {
  if (key.startsWith("on")) {
    const eventName = key.slice(2);

    if (ignore.has(eventName)) continue; // skip noisy events

    window.addEventListener(eventName, e => {
      console.log(`EVENT: ${eventName}`, e);
    });
  }
}