// Task history storage management

import { sortTasksBySync } from './task-sorting.js';
import { showTaskSummary, showPlaceholder } from '../ui/summary-display.js';
import { setLastCompletedTaskId, setSortedTaskList, setUnsyncedTasksCount } from '../state/popup-state.js';

export function refreshSummaryFromStorage() {
  chrome.storage.local.get(['taskHistory'], (data) => {
    const taskHistory = data.taskHistory || {};
    const sortedTaskList = sortTasksBySync(taskHistory);
    setSortedTaskList(sortedTaskList);
    
    const pending = sortedTaskList.filter((t) => !t.pushedToMongo);
    const unsyncedCount = pending.length;
    setUnsyncedTasksCount(unsyncedCount);
    
    const summaryTask = pending[0] || sortedTaskList[0];
    if (summaryTask) {
      setLastCompletedTaskId(summaryTask.id);
      showTaskSummary(summaryTask, unsyncedCount);
    } else {
      showPlaceholder();
    }
  });
}

export function checkStorage() {
  chrome.storage.local.get(null, function(data) {
    console.log("All storage data:", data);
  });
}

