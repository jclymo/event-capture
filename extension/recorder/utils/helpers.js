// General utility functions

// Debouncing utility
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Enhanced hash function for better uniqueness
export function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
  }
  // Convert to base36 and take first 6 characters
  return (hash >>> 0).toString(36).substring(0, 6);
}

// Format timestamps in a consistent way
export function formatTimestamp(timestamp) {
  return new Date(timestamp).toISOString();
}

