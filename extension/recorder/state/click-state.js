// Click behavior tracking

export const clickState = {
  lastClickTime: 0,
  lastMouseUpTime: 0,
  lastClickTarget: null,
  lastClickButton: null,
  lastClickCoords: null,
  clickCount: 0
};

export function updateClickState(time, target, button, coords, isClickEvent = true) {
  if (isClickEvent) {
    clickState.lastClickTime = time;
  } else {
    clickState.lastMouseUpTime = time;
  }
  clickState.lastClickTarget = target;
  clickState.lastClickButton = button;
  clickState.lastClickCoords = coords;
  clickState.clickCount++;
}

export function resetClickCount() {
  clickState.clickCount = 0;
}

export function getClickState() {
  return { ...clickState };
}

