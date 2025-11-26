// Recording timer management

let timerInterval = null;

export function startTimer(startTime) {
  const timerElement = document.getElementById('timer');
  if (!timerElement) return;
  
  const updateTimer = () => {
    const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    timerElement.textContent = `Time: ${minutes}:${seconds.toString().padStart(2, '0')}`;
  };
  
  // Clear any existing timer
  if (timerInterval) clearInterval(timerInterval);
  
  // Update immediately and then every second
  updateTimer();
  timerInterval = setInterval(updateTimer, 1000);
}

export function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  const timerElement = document.getElementById('timer');
  if (timerElement) {
    timerElement.textContent = '';
  }
}

export function clearTimer() {
  stopTimer();
}

