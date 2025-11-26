// Status and summary badge management

export function setRecordingStatus(text, variant = 'idle') {
  const statusBadge = document.getElementById('recordingStatus');
  if (!statusBadge) return;
  
  statusBadge.textContent = text;
  statusBadge.classList.remove('status-pill--idle', 'status-pill--recording', 'status-pill--finished');
  let background = '#0284c7';
  if (variant === 'recording') {
    statusBadge.classList.add('status-pill--recording');
    background = '#b91c1c';
  } else if (variant === 'finished') {
    statusBadge.classList.add('status-pill--finished');
    background = '#16a34a';
  } else {
    statusBadge.classList.add('status-pill--idle');
    background = '#0284c7';
  }
  statusBadge.style.backgroundColor = background;
}

export function setSummaryBadge(text, background = '#22c55e') {
  const summaryBadge = document.getElementById('summaryBadge');
  if (!summaryBadge) return;
  summaryBadge.textContent = text;
  summaryBadge.style.backgroundColor = background;
}

