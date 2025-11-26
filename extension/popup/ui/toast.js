// Toast notification system

let toastElement = null;
let toastTimeoutId = null;

export function ensureToast() {
  if (!toastElement) {
    toastElement = document.createElement('div');
    toastElement.className = 'toast';
    document.body.appendChild(toastElement);
  }
}

export function showToast(message, variant = 'default') {
  ensureToast();
  toastElement.textContent = message;
  toastElement.className = 'toast';
  if (variant === 'success') {
    toastElement.classList.add('toast--success');
  } else if (variant === 'error') {
    toastElement.classList.add('toast--error');
  }
  toastElement.classList.add('toast--visible');
  if (toastTimeoutId) {
    clearTimeout(toastTimeoutId);
  }
  toastTimeoutId = setTimeout(() => {
    toastElement.classList.remove('toast--visible');
  }, 2200);
}

