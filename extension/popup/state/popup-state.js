// Popup state management

export const popupState = {
  lastCompletedTaskId: null,
  sortedTaskList: [],
  unsyncedTasksCount: 0,
  mainPushButton: null,
  taskDetailsButton: null,
  taskDescriptionInput: null
};

export function setLastCompletedTaskId(taskId) {
  popupState.lastCompletedTaskId = taskId;
}

export function getLastCompletedTaskId() {
  return popupState.lastCompletedTaskId;
}

export function setSortedTaskList(list) {
  popupState.sortedTaskList = list;
}

export function getSortedTaskList() {
  return popupState.sortedTaskList;
}

export function setUnsyncedTasksCount(count) {
  popupState.unsyncedTasksCount = count;
}

export function getUnsyncedTasksCount() {
  return popupState.unsyncedTasksCount;
}

export function initializePopupElements() {
  popupState.mainPushButton = document.getElementById('pushToMongo');
  popupState.taskDetailsButton = document.getElementById('taskDetailsButton');
  popupState.taskDescriptionInput = document.getElementById('taskDescription');
  
  if (popupState.mainPushButton) {
    popupState.mainPushButton.disabled = true;
  }
  if (popupState.taskDetailsButton) {
    popupState.taskDetailsButton.disabled = true;
  }
  
  return popupState;
}

export function getPopupElements() {
  return {
    mainPushButton: popupState.mainPushButton,
    taskDetailsButton: popupState.taskDetailsButton,
    taskDescriptionInput: popupState.taskDescriptionInput
  };
}

