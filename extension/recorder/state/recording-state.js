// Core recording state management

export let events = [];
export let isRecording = false;
export let currentTaskId = null;
export let recordingStartAtMs = null;

export function setRecordingState(recording) {
  isRecording = recording;
}

export function setCurrentTaskId(taskId) {
  currentTaskId = taskId;
}

export function setEvents(newEvents) {
  events = newEvents;
}

export function setRecordingStartTime(startTime) {
  recordingStartAtMs = startTime;
}

export function getRecordingState() {
  return {
    isRecording,
    currentTaskId,
    events,
    recordingStartAtMs
  };
}

export function resetRecordingState() {
  isRecording = false;
  currentTaskId = null;
  events = [];
  recordingStartAtMs = null;
}

