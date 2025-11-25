// Task summary display

import { setSummaryBadge } from './status-badge.js';

export function showTaskSummary(taskData, pendingCount = 0) {
  // Create or get the results container
  let resultsDiv = document.getElementById('results');
  if (!resultsDiv) {
    resultsDiv = document.createElement('div');
    resultsDiv.id = 'results';
    document.body.appendChild(resultsDiv);
  }
  
  // Clear previous results
  resultsDiv.innerHTML = '';
  
  const safeTitle = (taskData && typeof taskData.title === 'string' && taskData.title.trim())
    ? taskData.title.trim()
    : 'Untitled task';
  const events = Array.isArray(taskData.events) ? taskData.events : [];
  const totalEvents = events.length;
  const durationSeconds = taskData.endTime && taskData.startTime
    ? Math.max(0, Math.floor((taskData.endTime - taskData.startTime) / 1000))
    : 0;
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;

  const countsByType = events.reduce((acc, ev) => {
    const t = ev && ev.type ? String(ev.type) : 'unknown';
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});
  const clickCount = countsByType.click || 0;
  const keyCount =
    (countsByType.keydown || 0) +
    (countsByType.keyup || 0) +
    (countsByType.keypress || 0);
  const inputCount = countsByType.input || 0;

  const startTime = taskData.startTime ? new Date(taskData.startTime) : null;
  const endTime = taskData.endTime ? new Date(taskData.endTime) : null;
  const formatClock = (d) =>
    d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';

  // Create summary header
  const header = document.createElement('h2');
  header.textContent = 'Task Summary';
  resultsDiv.appendChild(header);

  const summaryContainer = document.createElement('div');
  summaryContainer.className = 'summary-rows';

  const rows = [
    ['Task', safeTitle],
    ['Duration', `${minutes}m ${seconds.toString().padStart(2, '0')}s`],
    [
      'Events',
      `${totalEvents} total  •  ${clickCount} clicks  •  ${keyCount} keys  •  ${inputCount} inputs`
    ],
    [
      'Time window',
      `${formatClock(startTime)} → ${formatClock(endTime)}`
    ]
  ];

  rows.forEach(([label, value]) => {
    const row = document.createElement('div');
    row.className = 'summary-row';

    const labelSpan = document.createElement('span');
    labelSpan.className = 'summary-label';
    labelSpan.textContent = label;

    const valueSpan = document.createElement('span');
    valueSpan.className = 'summary-value';
    valueSpan.textContent = value;

    row.appendChild(labelSpan);
    row.appendChild(valueSpan);
    summaryContainer.appendChild(row);
  });

  resultsDiv.appendChild(summaryContainer);
  const summaryNote = document.createElement('div');
  summaryNote.className = 'summary-note';
  summaryNote.textContent = pendingCount > 0
    ? `${pendingCount} task${pendingCount === 1 ? '' : 's'} waiting to sync`
    : 'All recorded tasks synced';
  resultsDiv.appendChild(summaryNote);
  const alreadyPushed = !!taskData.pushedToMongo;
  if (alreadyPushed) {
    setSummaryBadge(`Synced · ${totalEvents} events`, '#16a34a');
  } else {
    setSummaryBadge(`Ready to sync · ${totalEvents} events`, '#22c55e');
  }

  const mainPushButton = document.getElementById('pushToMongo');
  const taskDetailsButton = document.getElementById('taskDetailsButton');
  
  if (mainPushButton) {
    const canPush = totalEvents > 0 && !alreadyPushed;
    mainPushButton.disabled = !canPush;
    mainPushButton.textContent = alreadyPushed ? 'Synced to MongoDB' : 'Sync to MongoDB';
  }
  if (taskDetailsButton) {
    taskDetailsButton.disabled = totalEvents === 0;
  }
}

export function showPlaceholder() {
  const resultsDiv = document.getElementById('results');
  if (resultsDiv) {
    resultsDiv.innerHTML = `<p class="placeholder-text">Finish a recording to populate this summary area.</p>`;
  }
  setSummaryBadge('No tasks yet', '#94a3b8');
  
  const mainPushButton = document.getElementById('pushToMongo');
  const taskDetailsButton = document.getElementById('taskDetailsButton');
  if (mainPushButton) {
    mainPushButton.disabled = true;
    mainPushButton.textContent = 'Sync to MongoDB';
  }
  if (taskDetailsButton) {
    taskDetailsButton.disabled = true;
  }
}

