# ServiceNow Event Capture Testing Guide

## Overview

This test suite validates that the Chrome extension can successfully capture user events (clicks, typing, form interactions) on ServiceNow, including events that occur within iframes.

## Prerequisites

1. **Node.js installed** (v14 or higher)
2. **Chrome browser** installed
3. **Chrome extension** loaded:
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" (top right toggle)
   - Click "Load unpacked"
   - Select the `/Users/siddharthsuresh/Downloads/event-capture/extension` folder
4. **Valid ServiceNow credentials** (already configured in test script)

## Installation

```bash
# Navigate to the project directory
cd /Users/siddharthsuresh/Downloads/event-capture

# Install dependencies
npm install
```

## Running the Tests

### Basic Test Run
```bash
npm test
```

### Verbose Mode (shows all browser console logs)
```bash
npm run test:verbose
```

### Manual Test Run
```bash
node test-servicenow.js
```

## What the Tests Validate

The automated test suite validates the following success criteria:

### ✅ Success Criteria

| # | Criteria | Description | Critical? |
|---|----------|-------------|-----------|
| 1 | **Extension Loads** | Chrome extension loads successfully without errors | ✅ Yes |
| 2 | **ServiceNow Login** | Can authenticate to ServiceNow instance | ✅ Yes |
| 3 | **Iframe Detection** | Detects iframes present on ServiceNow pages | ✅ Yes |
| 4 | **Iframe Instrumentation** | Successfully attaches event listeners to iframes | ✅ Yes |
| 5 | **Click Event Capture** | Captures user click events from main page and iframes | ✅ Yes |
| 6 | **Input Event Capture** | Captures typing/input events from text fields | ✅ Yes |
| 7 | **Event Metadata** | Events contain proper metadata (type, timestamp, URL, target) | ✅ Yes |
| 8 | **BID Attribution** | Elements have Browser IDs (BID) for identification | ⚠️ Optional |
| 9 | **Iframe Flag** | Events from iframes are properly flagged with `isInIframe: true` | ✅ Yes |
| 10 | **XPath/CSS Selectors** | Event targets include XPath and CSS selectors | ✅ Yes |

### Test Execution Flow

```
1. Launch Chrome with Extension Loaded
   ↓
2. Navigate to ServiceNow Login Page
   ↓
3. Enter Credentials & Login
   ↓
4. Detect Iframes on Dashboard
   ↓
5. Start Event Recording
   ↓
6. Perform Click Interactions
   ↓
7. Perform Typing Interactions
   ↓
8. Navigate to Incident Form (iframe test)
   ↓
9. Interact with Form Fields in Iframe
   ↓
10. Stop Recording & Validate Events
   ↓
11. Generate Test Report
```

## Test Outputs

### 1. Console Output
The test displays detailed progress and results in the console:
- ✅ Green checkmarks for passing tests
- ❌ Red X marks for failing tests
- Detailed event counts and metadata
- Summary statistics

### 2. Screenshots
Screenshots are saved to `test-screenshots/` directory:
- `01-login-page.png` - ServiceNow login page
- `02-credentials-filled.png` - Login form with credentials
- `03-logged-in.png` - Dashboard after successful login
- `04-filter-search.png` - Filter/search interaction
- `05-incident-form.png` - Incident creation form
- `06-final-state.png` - Final page state
- `error-state.png` - Screenshot if test fails

### 3. JSON Results
Test results are saved to `test-results.json`:
```json
{
  "timestamp": "2025-01-12T...",
  "summary": {
    "total": 15,
    "passed": 14,
    "failed": 1,
    "successRate": 93.3
  },
  "tests": [ /* detailed test results */ ],
  "successCriteria": [ /* criteria evaluation */ ],
  "allCriteriaMet": true
}
```

## Understanding Test Results

### ✅ ALL TESTS PASSING

If you see:
```
🎉 ALL SUCCESS CRITERIA MET - EVENT CAPTURE WORKING! 🎉
Success Rate: 100%
```

**This means:**
- ✅ Extension is correctly capturing events on ServiceNow
- ✅ Iframe support is working
- ✅ Both click and input events are captured
- ✅ Event metadata is complete and correct
- 🚀 **Ready for production use**

### ⚠️ PARTIAL FAILURES

Common failure scenarios and solutions:

#### Scenario 1: "Iframes detected" passes but "Iframes instrumented" fails
**Cause:** CSP (Content Security Policy) blocking script injection
**Solution:** Check browser console for CSP errors; fallback BIDs will be used

#### Scenario 2: "Click events captured" fails
**Cause:** Element selectors may have changed in ServiceNow UI
**Solution:** Events might still be captured but not at the expected location

#### Scenario 3: "Iframe interaction captured" fails
**Cause:** Cross-origin iframe restrictions
**Solution:** This is expected for some iframes; same-origin iframes should work

### ❌ MAJOR FAILURES

If multiple tests fail:
1. **Check extension is loaded:** Visit `chrome://extensions/` and verify extension is enabled
2. **Check ServiceNow credentials:** Ensure username/password are correct
3. **Check network connectivity:** Ensure you can access ServiceNow URL
4. **Review error logs:** Check `test-screenshots/error-state.png` and console output

## Manual Testing Steps

If you prefer to test manually:

### Step 1: Load Extension
1. Open Chrome
2. Go to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select `/Users/siddharthsuresh/Downloads/event-capture/extension`

### Step 2: Navigate to ServiceNow
1. Open new tab: `https://empmassimo23.service-now.com`
2. Login with credentials

### Step 3: Open Extension
1. Click extension icon in Chrome toolbar
2. Click "Start Recording"

### Step 4: Perform Actions
1. Click on navigation items
2. Type in search boxes
3. Open an incident form
4. Fill in form fields
5. Click buttons

### Step 5: Check Console
1. Press F12 to open Developer Tools
2. Go to Console tab
3. Look for these messages:
   - `📍 Instrumenting iframe: ...`
   - `✅ Iframe instrumented successfully`
   - `📝 Recording event: click`
   - `📝 Recording event: input`
   - `Found X iframes to instrument`

### Step 6: Stop Recording
1. Click extension icon
2. Click "Stop Recording"
3. Check captured events in extension storage

### Step 7: Verify Events
1. In console, run:
```javascript
chrome.storage.local.get(['taskHistory', 'currentTaskId'], (data) => {
  const task = data.taskHistory[data.currentTaskId];
  console.log('Total events:', task.events.length);
  console.log('Click events:', task.events.filter(e => e.type === 'click').length);
  console.log('Input events:', task.events.filter(e => e.type === 'input').length);
  console.log('Iframe events:', task.events.filter(e => e.isInIframe).length);
  console.log('Sample event:', task.events[0]);
});
```

## Expected Event Structure

A properly captured event should look like this:

```json
{
  "type": "click",
  "timestamp": 1704123456789,
  "url": "https://empmassimo23.service-now.com/nav_to.do?uri=%2Fincident.do",
  "isInIframe": true,
  "iframeUrl": "https://empmassimo23.service-now.com/incident.do",
  "topUrl": "https://empmassimo23.service-now.com/nav_to.do",
  "target": {
    "tag": "BUTTON",
    "id": "submit_button",
    "class": "btn btn-primary",
    "text": "Submit",
    "xpath": "//*[@id=\"submit_button\"]",
    "cssPath": "div#form > button#submit_button",
    "bid": "button-submit_button",
    "isInteractive": true,
    "boundingBox": { "x": 100, "y": 200, "width": 80, "height": 30 },
    "attributes": { /* all element attributes */ }
  },
  "button": 0,
  "clientX": 150,
  "clientY": 220
}
```

## Troubleshooting

### Issue: No events captured
**Check:**
1. Extension is loaded and enabled
2. Recording was started before interactions
3. Browser console for errors
4. Extension storage is not corrupted

**Fix:**
```bash
# Reload extension
chrome://extensions/ → Click reload icon

# Clear storage
chrome.storage.local.clear()
```

### Issue: Iframe events not captured
**Check:**
1. Console for "Instrumenting iframe" messages
2. Iframes are same-origin (not cross-origin)
3. CSP is not blocking script injection

**Fix:**
- Cross-origin iframes cannot be instrumented due to browser security
- Fallback BIDs will be used for elements

### Issue: Tests timeout
**Fix:**
```javascript
// Increase timeout in test-servicenow.js
const TEST_CONFIG = {
  timeout: 120000, // Increase to 2 minutes
  // ...
};
```

## Success Indicators

### 🟢 Everything Working Perfectly

```
✅ Browser launched with extension
✅ ServiceNow page loaded
✅ Login successful
✅ Iframes detected (Found 5 iframe(s))
✅ Iframes instrumented
✅ Click events captured (Captured 12 click event(s))
✅ Input events captured (Captured 8 input event(s))
✅ Iframe events captured (Captured 5 event(s) from iframe(s))
✅ Event metadata present
✅ BID attribute present
✅ Event has iframe detection

Success Rate: 100%
🎉 ALL SUCCESS CRITERIA MET - EVENT CAPTURE WORKING! 🎉
```

## Next Steps After Successful Tests

1. **Deploy to production** - Extension is ready for real-world use
2. **Configure backend** - Ensure events are sent to your training data pipeline
3. **Monitor performance** - Watch for any performance impact on ServiceNow
4. **Expand coverage** - Test on other ServiceNow modules (Change, Problem, etc.)
5. **Train models** - Use captured data for ML training

## Support

If tests fail consistently:
1. Check Chrome version (should be latest)
2. Verify ServiceNow instance is accessible
3. Review extension console logs
4. Check `test-results.json` for specific failure details
5. Review screenshots in `test-screenshots/` directory

---

**Last Updated:** 2025-01-12
**Test Script Version:** 1.0.0
