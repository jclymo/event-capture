// Task description input handling

const TASK_TITLE_STORAGE_KEY = 'taskTitleDraft';

export function initializeTaskDescriptionInput() {
  const taskDescriptionInput = document.getElementById('taskDescription');
  if (!taskDescriptionInput) return;
  
  // Load saved title
  chrome.storage.local.get([TASK_TITLE_STORAGE_KEY], (data) => {
    const storedTitle = data[TASK_TITLE_STORAGE_KEY];
    if (typeof storedTitle === 'string') {
      taskDescriptionInput.value = storedTitle;
    }
  });

  // Save on input
  taskDescriptionInput.addEventListener('input', () => {
    chrome.storage.local.set({ [TASK_TITLE_STORAGE_KEY]: taskDescriptionInput.value });
  });
}

export function getTaskTitle() {
  const taskDescriptionInput = document.getElementById('taskDescription');
  if (!taskDescriptionInput) return 'Untitled Task';
  return taskDescriptionInput.value.trim() || 'Untitled Task';
}

export function setTaskTitle(title) {
  const taskDescriptionInput = document.getElementById('taskDescription');
  if (taskDescriptionInput) {
    taskDescriptionInput.value = title;
    chrome.storage.local.set({ [TASK_TITLE_STORAGE_KEY]: title });
  }
}

export { TASK_TITLE_STORAGE_KEY };

