// Shared configuration for background service worker modules

// API base (fallback safe if config.js is not available in SW)
export const API_BASE = (typeof API_ENDPOINT !== 'undefined' && API_ENDPOINT)
  ? API_ENDPOINT.replace('/api/events','')
  : 'http://localhost:3000';

export const API_KEY_HEADER = (typeof API_KEY !== 'undefined' && API_KEY) 
  ? { 'x-api-key': API_KEY } 
  : {};

