// Settings page logic for event configuration

// Preset configurations
const PRESETS = {
  minimal: {
    domEvents: [
      { name: 'click', enabled: true, handler: 'recordEvent' }
    ]
  },
  standard: {
    domEvents: [
      { name: 'click', enabled: true, handler: 'recordEvent' },
      { name: 'input', enabled: true, handler: 'debouncedRecordInput' },
      { name: 'change', enabled: true, handler: 'debouncedRecordInput' },
      { name: 'submit', enabled: true, handler: 'recordEvent' }
    ]
  },
  verbose: {
    domEvents: [
      { name: 'click', enabled: true, handler: 'recordEvent' },
      { name: 'mousedown', enabled: true, handler: 'recordEvent' },
      { name: 'mouseup', enabled: true, handler: 'recordEvent' },
      { name: 'mouseover', enabled: true, handler: 'recordEvent' },
      { name: 'mouseout', enabled: true, handler: 'recordEvent' },
      { name: 'keydown', enabled: true, handler: 'recordEvent' },
      { name: 'keyup', enabled: true, handler: 'recordEvent' },
      { name: 'keypress', enabled: true, handler: 'recordEvent' },
      { name: 'input', enabled: true, handler: 'debouncedRecordInput' },
      { name: 'change', enabled: true, handler: 'debouncedRecordInput' },
      { name: 'focus', enabled: true, handler: 'recordEvent' },
      { name: 'blur', enabled: true, handler: 'recordEvent' },
      { name: 'submit', enabled: true, handler: 'recordEvent' },
      { name: 'scroll', enabled: true, handler: 'debouncedRecordScroll' },
      { name: 'touchstart', enabled: true, handler: 'recordEvent' },
      { name: 'touchend', enabled: true, handler: 'recordEvent' },
      { name: 'touchmove', enabled: true, handler: 'recordEvent' }
    ]
  }
};

// Load configuration from storage or defaults
async function loadConfiguration() {
  try {
    // Try loading from chrome.storage.sync first (user preferences)
    const { eventConfig } = await chrome.storage.sync.get('eventConfig');
    
    if (eventConfig && eventConfig.domEvents) {
      return eventConfig;
    }
    
    // Fallback: load from event-config.json
    const configUrl = chrome.runtime.getURL('event-config.json');
    const response = await fetch(configUrl);
    if (response.ok) {
      return await response.json();
    }
    
    // Last fallback: standard preset
    return PRESETS.standard;
  } catch (error) {
    console.error('Error loading configuration:', error);
    return PRESETS.standard;
  }
}

// Save configuration to chrome.storage.sync
async function saveConfiguration(config) {
  try {
    await chrome.storage.sync.set({ eventConfig: config });
    
    // Notify all tabs to reload configuration
    const tabs = await chrome.tabs.query({});
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { 
        action: 'reloadEventConfig',
        config: config
      }).catch(() => {
        // Ignore errors for tabs that don't have content script
      });
    });
    
    return true;
  } catch (error) {
    console.error('Error saving configuration:', error);
    return false;
  }
}

// Populate UI with current configuration
async function populateUI() {
  const config = await loadConfiguration();
  
  // Create a map for quick lookup
  const eventMap = new Map(
    config.domEvents.map(evt => [evt.name, evt])
  );
  
  // Update all checkboxes
  const checkboxes = document.querySelectorAll('input[type="checkbox"][data-event]');
  checkboxes.forEach(checkbox => {
    const eventName = checkbox.dataset.event;
    const event = eventMap.get(eventName);
    checkbox.checked = event ? event.enabled !== false : false;
  });
  
  showStatus('Configuration loaded', 'success');
}

// Collect configuration from UI
function collectConfiguration() {
  const checkboxes = document.querySelectorAll('input[type="checkbox"][data-event]');
  const domEvents = Array.from(checkboxes).map(checkbox => ({
    name: checkbox.dataset.event,
    enabled: checkbox.checked,
    handler: checkbox.dataset.handler || 'recordEvent'
  }));
  
  return { domEvents };
}

// Apply a preset
function applyPreset(presetName) {
  const preset = PRESETS[presetName];
  if (!preset) return;
  
  // Create a set of enabled events
  const enabledEvents = new Set(preset.domEvents.map(evt => evt.name));
  
  // Update all checkboxes
  const checkboxes = document.querySelectorAll('input[type="checkbox"][data-event]');
  checkboxes.forEach(checkbox => {
    checkbox.checked = enabledEvents.has(checkbox.dataset.event);
  });
  
  showStatus(`Applied ${presetName} preset`, 'success');
}

// Reset to defaults (from event-config.json)
async function resetToDefaults() {
  try {
    // Load from event-config.json
    const configUrl = chrome.runtime.getURL('event-config.json');
    const response = await fetch(configUrl);
    const defaultConfig = await response.json();
    
    // Clear stored config
    await chrome.storage.sync.remove('eventConfig');
    
    // Repopulate UI
    await populateUI();
    
    showStatus('Reset to default configuration', 'success');
  } catch (error) {
    console.error('Error resetting:', error);
    showStatus('Error resetting configuration', 'error');
  }
}

// Export configuration
function exportConfiguration() {
  const config = collectConfiguration();
  const dataStr = JSON.stringify(config, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = 'event-config.json';
  link.click();
  
  URL.revokeObjectURL(url);
  showStatus('Configuration exported', 'success');
}

// Import configuration
function importConfiguration(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const config = JSON.parse(e.target.result);
      
      if (!config.domEvents || !Array.isArray(config.domEvents)) {
        throw new Error('Invalid configuration format');
      }
      
      // Save the imported config
      await saveConfiguration(config);
      
      // Repopulate UI
      await populateUI();
      
      showStatus('Configuration imported successfully', 'success');
    } catch (error) {
      console.error('Error importing:', error);
      showStatus('Error importing configuration: ' + error.message, 'error');
    }
  };
  reader.readAsText(file);
}

// Show status message
function showStatus(message, type = 'info') {
  const statusEl = document.getElementById('statusMessage');
  statusEl.textContent = message;
  statusEl.className = type;
  
  // Auto-hide after 3 seconds
  setTimeout(() => {
    statusEl.textContent = '';
    statusEl.className = '';
  }, 3000);
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
  // Load initial configuration
  populateUI();
  
  // Save button
  document.getElementById('saveBtn').addEventListener('click', async () => {
    const config = collectConfiguration();
    const success = await saveConfiguration(config);
    
    if (success) {
      showStatus('✅ Configuration saved successfully!', 'success');
    } else {
      showStatus('❌ Error saving configuration', 'error');
    }
  });
  
  // Reset button
  document.getElementById('resetBtn').addEventListener('click', async () => {
    if (confirm('Reset to default configuration? This will discard your changes.')) {
      await resetToDefaults();
    }
  });
  
  // Export button
  document.getElementById('exportBtn').addEventListener('click', () => {
    exportConfiguration();
  });
  
  // Import button
  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });
  
  // Import file input
  document.getElementById('importFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      importConfiguration(file);
    }
    e.target.value = ''; // Reset input
  });
  
  // Preset buttons
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.preset;
      applyPreset(preset);
    });
  });
  
  // Close button
  document.getElementById('closeBtn').addEventListener('click', () => {
    window.close();
  });
  
  // Track changes
  document.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
    checkbox.addEventListener('change', () => {
      showStatus('Configuration changed (not saved)', 'info');
    });
  });
});






