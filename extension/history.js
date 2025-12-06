document.addEventListener('DOMContentLoaded', () => {
  const listEl = document.getElementById('historyList');
  const emptyEl = document.getElementById('historyEmpty');
  const pendingSummaryEl = document.getElementById('pendingSummary');
  const syncAllBtn = document.getElementById('syncAllBtn');

  /**
   * Reconstruct HTML content via background message passing
   * Uses single source of truth in background/html-indexeddb.js
   * @param {Array} events - Array of events
   * @returns {Promise<Array>} - Events with html property restored
   */
  async function reconstructHtmlInEvents(events) {
    if (!Array.isArray(events)) return events;
    
    const needsReconstruction = events.some(e => 
      e.type === 'htmlCapture' && e.documentKey && !e.html
    );
    
    if (!needsReconstruction) {
      console.log('📄 No HTML reconstruction needed');
      return events;
    }
    
    console.log('📄 Requesting HTML reconstruction from background...');
    
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'RECONSTRUCT_HTML_EVENTS',
        events: events
      });
      
      if (response && response.success) {
        const restored = response.events.filter(e => e.type === 'htmlCapture' && e.html).length;
        const total = response.events.filter(e => e.type === 'htmlCapture').length;
        console.log(`📄 Reconstructed ${restored}/${total} HTML documents`);
        return response.events;
      } else {
        console.warn('⚠️ HTML reconstruction failed:', response?.error);
        return events;
      }
    } catch (err) {
      console.error('Error requesting HTML reconstruction:', err);
      return events;
    }
  }

  function sortTasks(taskHistory = {}) {
    const tasks = Object.values(taskHistory || {});
    return tasks.slice().sort((a, b) => {
      const aSynced = a.pushedToMongo ? 1 : 0;
      const bSynced = b.pushedToMongo ? 1 : 0;
      if (aSynced !== bSynced) return aSynced - bSynced;
      const aTime = a.endTime || a.startTime || 0;
      const bTime = b.endTime || b.startTime || 0;
      return bTime - aTime;
    });
  }

  function render(taskHistory) {
    const tasks = sortTasks(taskHistory);
    const pending = tasks.filter((t) => !t.pushedToMongo);
    const pendingCount = pending.length;

    pendingSummaryEl.textContent = pendingCount
      ? `${pendingCount} task${pendingCount === 1 ? '' : 's'} pending sync`
      : 'All tasks synced';
    syncAllBtn.disabled = pendingCount === 0;

    listEl.innerHTML = '';
    if (!tasks.length) {
      emptyEl.textContent = 'No tasks recorded yet.';
      return;
    }
    emptyEl.textContent = '';

    tasks.forEach((task) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'history-task';
      wrapper.dataset.taskId = task.id;

      const duration =
        task.endTime && task.startTime
          ? Math.max(0, Math.floor((task.endTime - task.startTime) / 1000))
          : 0;
      const formattedDuration =
        duration > 0 ? `${Math.floor(duration / 60)}m ${duration % 60}s` : '0s';
      const eventsCount = Array.isArray(task.events) ? task.events.length : 0;
      const startLabel = task.startTime ? new Date(task.startTime).toLocaleString() : '—';

      const header = document.createElement('div');
      header.className = 'history-task-header';
      header.innerHTML = `
        <div>
          <div class="history-task-title">${task.title || 'Untitled task'}</div>
          <div class="history-task-date">${startLabel}</div>
        </div>
        <span class="history-status-pill ${task.pushedToMongo ? 'synced' : 'pending'}">
          ${task.pushedToMongo ? 'Synced to MongoDB' : 'Not yet synced'}
        </span>
      `;

      const body = document.createElement('div');
      body.className = 'history-task-body';
      body.innerHTML = `
        <p><strong>Status:</strong> ${task.status}</p>
        <p><strong>Duration:</strong> ${formattedDuration}</p>
        <p><strong>Events:</strong> ${eventsCount}</p>
      `;

      const actions = document.createElement('div');
      actions.className = 'history-actions';

      const viewBtn = document.createElement('button');
      viewBtn.className = 'btn-view';
      viewBtn.textContent = 'View Details';
      viewBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'viewTaskDetails', taskId: task.id });
      });

      const syncBtn = document.createElement('button');
      syncBtn.className = 'btn-sync';
      syncBtn.textContent = task.pushedToMongo ? 'Synced' : 'Sync to MongoDB';
      syncBtn.disabled = !!task.pushedToMongo;
      if (task.pushedToMongo) syncBtn.classList.add('synced');
      syncBtn.addEventListener('click', () => {
        syncSingleTask(task.id, syncBtn);
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn-delete';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', () => {
        if (!confirm('Delete this task?')) return;
        chrome.storage.local.get(['taskHistory'], (data) => {
          const current = data.taskHistory || {};
          if (current[task.id]) {
            delete current[task.id];
            chrome.storage.local.set({ taskHistory: current }, () => {
              loadAndRender();
            });
          }
        });
      });

      actions.appendChild(viewBtn);
      actions.appendChild(syncBtn);
      actions.appendChild(deleteBtn);

      wrapper.appendChild(header);
      wrapper.appendChild(body);
      wrapper.appendChild(actions);
      listEl.appendChild(wrapper);
    });
  }

  async function syncSingleTask(taskId, button = null) {
    const { taskHistory = {} } = await chrome.storage.local.get(['taskHistory']);
    const task = taskHistory[taskId];
    if (!task || task.pushedToMongo) return;

    // Reconstruct HTML content from IndexedDB before building payload
    let taskToSync = task;
    if (task.events && Array.isArray(task.events)) {
      try {
        const reconstructedEvents = await reconstructHtmlInEvents(task.events);
        taskToSync = { ...task, events: reconstructedEvents };
      } catch (err) {
        console.error('Error reconstructing HTML content:', err);
        // Continue with events as-is
      }
    }

    const payload = buildTaskPayload(taskToSync);
    if (!payload) {
      alert('Unable to build payload for this task.');
      return;
    }
    if (task.video_local_path) payload.video_local_path = task.video_local_path;
    if (task.video_server_path) payload.video_server_path = task.video_server_path;

    const originalLabel = button ? button.textContent : null;
    if (button) {
      button.disabled = true;
      button.textContent = 'Syncing...';
    }
    try {
      const result = await sendTaskPayload(payload);
      if (!result || !result.success) {
        throw new Error('Server rejected the request');
      }

      task.pushedToMongo = true;
      task.pushedAt = Date.now();
      taskHistory[taskId] = task;
      await chrome.storage.local.set({ taskHistory });
      if (button) {
        button.textContent = 'Synced';
        button.classList.add('synced');
      }
      await loadAndRender();
      chrome.runtime.sendMessage({ action: 'refreshSummary' });
    } catch (err) {
      console.error('Sync failed:', err);
      if (button) {
        button.disabled = false;
        button.textContent = originalLabel;
      }
      alert('Sync failed: ' + err.message);
    }
  }

  async function syncAllPending() {
    const { taskHistory = {} } = await chrome.storage.local.get(['taskHistory']);
    const tasks = sortTasks(taskHistory);
    const pending = tasks.filter((t) => !t.pushedToMongo);
    if (!pending.length) return;

    syncAllBtn.disabled = true;
    syncAllBtn.textContent = 'Syncing...';
    for (const task of pending) {
      await syncSingleTask(task.id);
    }
    syncAllBtn.textContent = 'Sync all pending';
    await loadAndRender();
  }

  async function loadAndRender() {
    const { taskHistory = {} } = await chrome.storage.local.get(['taskHistory']);
    render(taskHistory);
  }

  syncAllBtn.addEventListener('click', () => {
    syncAllPending();
  });

  loadAndRender();
});
