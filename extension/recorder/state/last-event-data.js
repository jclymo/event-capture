// Track last event to avoid duplicates

export const lastEventData = {
  type: null,
  target: null,
  value: null,
  timestamp: 0,
  lastInputValue: null
};

export function updateLastEventData(type, target, value, timestamp) {
  lastEventData.type = type;
  lastEventData.target = target;
  lastEventData.value = value;
  lastEventData.timestamp = timestamp;
}

export function setLastInputValue(value) {
  lastEventData.lastInputValue = value;
}

export function getLastEventData() {
  return { ...lastEventData };
}

