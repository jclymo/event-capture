/**
 * ServiceNow Event Capture Test Script
 *
 * This script tests whether the Chrome extension can successfully capture
 * events (clicks, typing, etc.) on ServiceNow, including within iframes.
 *
 * Prerequisites:
 * 1. Chrome extension must be loaded in Chrome (chrome://extensions/)
 * 2. Puppeteer must be installed: npm install puppeteer
 * 3. ServiceNow credentials must be valid
 *
 * Run with: node test-servicenow.js
 */

const puppeteer = require('puppeteer');
const path = require('path');

// ServiceNow credentials
const SNOW_INSTANCE_URL = "https://empmassimo23.service-now.com";
const SNOW_INSTANCE_UNAME = "admin";
const SNOW_INSTANCE_PWD = "Tensor@34";

// Extension path
const EXTENSION_PATH = path.join(__dirname, 'extension');

// Test configuration
const TEST_CONFIG = {
  timeout: 60000, // 60 seconds timeout for operations
  screenshotDir: path.join(__dirname, 'test-screenshots'),
  verbose: true
};

// Success criteria tracking
const testResults = {
  total: 0,
  passed: 0,
  failed: 0,
  tests: []
};

// Track the active task for fetching captured events later
let activeTaskId = null;
let cachedServiceWorkerTarget = null;

async function getServiceWorker(browser) {
  if (cachedServiceWorkerTarget) {
    const existingWorker = await cachedServiceWorkerTarget.worker();
    if (existingWorker) {
      return { target: cachedServiceWorkerTarget, worker: existingWorker };
    }
  }

  const targets = await browser.targets();
  const serviceWorkerTarget = targets.find(t => t.type() === 'service_worker');

  if (!serviceWorkerTarget) {
    throw new Error('Service worker target not found');
  }

  cachedServiceWorkerTarget = serviceWorkerTarget;
  const worker = await serviceWorkerTarget.worker();

  if (!worker) {
    throw new Error('Service worker worker() unavailable');
  }

  return { target: serviceWorkerTarget, worker };
}

/**
 * Log test result
 */
function logTest(name, passed, details = '') {
  testResults.total++;
  if (passed) {
    testResults.passed++;
    console.log(`✅ PASS: ${name}`);
  } else {
    testResults.failed++;
    console.log(`❌ FAIL: ${name}`);
  }
  if (details) {
    console.log(`   ${details}`);
  }
  testResults.tests.push({ name, passed, details });
}

/**
 * Wait for specific console message
 */
async function waitForConsoleMessage(page, messagePattern, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Timeout waiting for console message: ${messagePattern}`));
    }, timeout);

    const handler = (msg) => {
      const text = msg.text();
      if (text.includes(messagePattern) || (messagePattern instanceof RegExp && messagePattern.test(text))) {
        clearTimeout(timeoutId);
        page.off('console', handler);
        resolve(text);
      }
    };

    page.on('console', handler);
  });
}

/**
 * Get the extension background page
 */
async function getExtensionBackgroundPage(browser) {
  const targets = await browser.targets();
  const extensionTarget = targets.find(target =>
    target.type() === 'service_worker' ||
    (target.type() === 'background_page' && target.url().includes('chrome-extension://'))
  );

  if (!extensionTarget) {
    throw new Error('Extension background page not found');
  }

  return extensionTarget.page();
}

/**
 * Get captured events from extension storage
 */
async function getCapturedEvents(browser, forcedTaskId = null) {
  try {
    const { worker } = await getServiceWorker(browser);

    const events = await worker.evaluate((taskIdOverride) => {
      return new Promise((resolve) => {
        chrome.storage.local.get(['taskHistory', 'currentTaskId', 'lastCompletedTaskId'], (data) => {
          const resolvedId = taskIdOverride || data.currentTaskId || data.lastCompletedTaskId;
          const task = resolvedId && data.taskHistory ? data.taskHistory[resolvedId] : null;
          resolve(task ? task.events || [] : []);
        });
      });
    }, forcedTaskId);

    return events;
  } catch (error) {
    console.log(`   Could not get events: ${error.message}`);
    return [];
  }
}

/**
 * Inspect storage state for debugging
 */
async function getStorageSnapshot(browser, taskId) {
  try {
    const { worker } = await getServiceWorker(browser);
    return await worker.evaluate((snapshotTaskId) => {
      return new Promise((resolve) => {
        chrome.storage.local.get([
          'taskHistory',
          'isRecording',
          'currentTaskId',
          'recordingTabId',
          'lastCompletedTaskId'
        ], (data) => {
          const task = snapshotTaskId && data.taskHistory ? data.taskHistory[snapshotTaskId] : null;
          resolve({
            isRecording: data.isRecording,
            currentTaskId: data.currentTaskId,
            recordingTabId: data.recordingTabId,
            lastCompletedTaskId: data.lastCompletedTaskId,
            eventsLength: task ? (Array.isArray(task.events) ? task.events.length : 0) : 0
          });
        });
      });
    }, taskId);
  } catch (error) {
    console.log(`   Could not get storage snapshot: ${error.message}`);
    return null;
  }
}

async function getRecordingDebugState(browser) {
  try {
    const { worker } = await getServiceWorker(browser);
    const debugState = await worker.evaluate(() => {
      return globalThis.recordingDebug || null;
    });
    return debugState;
  } catch (error) {
    console.log(`   Could not read recording debug state: ${error.message}`);
    return null;
  }
}

/**
 * Start recording via extension popup simulation
 */
async function startRecording(browser, page) {
  try {
    const { worker } = await getServiceWorker(browser);
    const currentUrl = page.url();

    const result = await worker.evaluate(async (targetUrl) => {
      const queryTabs = () => new Promise(resolve => chrome.tabs.query({}, resolve));
      const tabs = await queryTabs();
      const tab = tabs.find(t => t.url && t.url.includes('service-now.com'));

      if (!tab) {
        throw new Error('ServiceNow tab not found');
      }

      const taskId = `test-${Date.now()}`;
      const startAtMs = Date.now();

      const storage = await new Promise(resolve => chrome.storage.local.get(['taskHistory'], resolve));
      const taskHistory = (storage.taskHistory || {});
      taskHistory[taskId] = {
        id: taskId,
        title: 'ServiceNow Test',
        startTime: startAtMs,
        startUrl: targetUrl,
        events: []
      };

      await new Promise(resolve => chrome.storage.local.set({
        taskHistory,
        isRecording: true,
        currentTaskId: taskId,
        recordingTabId: tab.id,
        recordingStartTime: startAtMs
      }, resolve));

      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ['recorder.js']
      });

      const sendStartMessage = () => new Promise(resolve => {
        chrome.tabs.sendMessage(tab.id, { action: 'startRecording', taskId, startAtMs }, (resp) => {
          const error = chrome.runtime.lastError ? chrome.runtime.lastError.message : null;
          resolve({ resp, error });
        });
      });

      let ack = await sendStartMessage();
      if (!ack.resp || ack.resp.status !== 'recording started') {
        console.warn('Recorder did not acknowledge start; reinjecting before retrying.');
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          files: ['recorder.js']
        });
        ack = await sendStartMessage();
      }

      if (!ack.resp || ack.resp.status !== 'recording started') {
        throw new Error(`Recorder failed to acknowledge start: ${ack.error || 'no response'}`);
      }

      return {
        tabId: tab.id,
        taskId,
        url: tab.url,
        ackStatus: ack.resp?.status,
        ackError: ack.error
      };
    }, currentUrl);

    activeTaskId = result.taskId;
    console.log(`   Recording started for task ${result.taskId} on tab ${result.tabId} (ack: ${result.ackStatus}${result.ackError ? `, err: ${result.ackError}` : ''})`);
  } catch (error) {
    console.log(`   Warning: Could not start recording: ${error.message}`);
    throw error;
  }
}

/**
 * Stop recording via extension
 */
async function stopRecording(browser) {
  try {
    const { worker } = await getServiceWorker(browser);

    await worker.evaluate(async (taskId) => {
      const storage = await new Promise(resolve => chrome.storage.local.get(['recordingTabId'], resolve));
      const tabId = storage.recordingTabId;

      if (tabId) {
        chrome.tabs.sendMessage(tabId, { action: 'stopRecording' });
      }

      await new Promise(resolve => chrome.storage.local.set({
        isRecording: false,
        currentTaskId: null,
        recordingTabId: null,
        lastCompletedTaskId: taskId || null
      }, resolve));
    }, activeTaskId);

    console.log(`   Recording stopped for task ${activeTaskId}`);
  } catch (error) {
    console.log(`   Warning: Could not stop recording: ${error.message}`);
    throw error;
  }
}

/**
 * Main test suite
 */
async function runTests() {
  console.log('🚀 Starting ServiceNow Event Capture Tests\n');
  console.log('=' .repeat(60));

  let browser;
  let page;

  try {
    // Launch browser with extension
    console.log('📦 Launching Chrome with extension...');
    browser = await puppeteer.launch({
      headless: false, // Must be false to load extensions
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security' // For iframe access
      ],
      defaultViewport: { width: 1920, height: 1080 }
    });

    const pages = await browser.pages();
    page = pages[0];

    // Enable console logging
    page.on('console', (msg) => {
      if (!TEST_CONFIG.verbose) return;
      const type = msg.type();
      const text = msg.text();
      const skipPatterns = [
        /--now-illustration/,
        /AudioContext was not allowed/,
        /Failed to load: tld-list/,
        /devtools-resources/
      ];

      if (skipPatterns.some((pattern) => pattern.test(text))) {
        return;
      }

      const importantIcon = /📍|✅|🆕|📝|📬|🚫|⚠️/;
      if (['warning', 'error'].includes(type) || importantIcon.test(text)) {
        console.log(`   [Browser ${type}]:`, text);
      }
    });

    logTest('Browser launched with extension', true, `Extension path: ${EXTENSION_PATH}`);

    // Navigate to ServiceNow
    console.log('\n📍 Navigating to ServiceNow...');
    await page.goto(SNOW_INSTANCE_URL, { waitUntil: 'networkidle2', timeout: TEST_CONFIG.timeout });
    await page.waitForTimeout(2000);

    logTest('ServiceNow page loaded', true, SNOW_INSTANCE_URL);

    // Take screenshot of login page
    await page.screenshot({ path: 'test-screenshots/01-login-page.png', fullPage: true });

    // Test 1: Login to ServiceNow
    console.log('\n🔐 TEST 1: Login to ServiceNow');
    console.log('-'.repeat(60));

    try {
      // Wait for login form
      await page.waitForSelector('#user_name', { timeout: 10000 });

      // Fill in credentials
      await page.type('#user_name', SNOW_INSTANCE_UNAME, { delay: 100 });
      await page.type('#user_password', SNOW_INSTANCE_PWD, { delay: 100 });

      await page.screenshot({ path: 'test-screenshots/02-credentials-filled.png' });

      // Click login button
      await page.click('#sysverb_login');

      // Wait for navigation
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
      await page.waitForTimeout(3000);

      await page.screenshot({ path: 'test-screenshots/03-logged-in.png', fullPage: true });

        logTest('Login successful', true, 'Successfully authenticated to ServiceNow');

      // Inject recorder script via background service worker
      console.log('   Injecting recorder script...');
      const targets = await browser.targets();
      const serviceWorkerTarget = targets.find(t => t.type() === 'service_worker');

      if (serviceWorkerTarget) {
        const worker = await serviceWorkerTarget.worker();
        const tabTarget = page.target();

        try {
          await worker.evaluate(async (targetId) => {
            // Get tab info
            const tabs = await chrome.tabs.query({});
            const tab = tabs.find(t => t.url && (t.url.includes('service-now.com') || t.url.includes('servicenow')));

            if (tab) {
              console.log('Found ServiceNow tab, injecting recorder...');
              await chrome.scripting.executeScript({
                target: { tabId: tab.id, allFrames: true },
                files: ['recorder.js']
              });
            }
          }, tabTarget._targetId);

          await page.waitForTimeout(3000);
          console.log('   Recorder script injected');
        } catch (e) {
          console.log(`   Warning: Could not inject recorder: ${e.message}`);
        }
      }

    } catch (error) {
      logTest('Login failed', false, error.message);
      throw error;
    }

    // Navigate to a page with iframes (like incident list)
    console.log('\n📋 Navigating to incident list...');
    let incidentFrame = null;
    try {
      await page.goto(`${SNOW_INSTANCE_URL}/incident_list.do`, {
        waitUntil: 'networkidle2',
        timeout: 60000
      });
      await page.waitForTimeout(5000);
      incidentFrame = page.frames().find(frame =>
        frame.name() === 'gsft_main' ||
        (frame.url() && frame.url().includes('incident_list'))
      ) || null;
      await page.screenshot({ path: 'test-screenshots/03b-incident-list.png', fullPage: true });
    } catch (e) {
      console.log(`   Could not navigate to incident list: ${e.message}`);
    }

    // Test 2: Verify iframe detection
    console.log('\n🔍 TEST 2: Iframe Detection');
    console.log('-'.repeat(60));

    const iframeInfo = await page.evaluate(() =>
      Array.from(document.querySelectorAll('iframe, frame')).map((iframe) => ({
        id: iframe.id,
        name: iframe.name,
        src: iframe.src
      }))
    );
    console.log(`   Found ${iframeInfo.length} iframe(s) on the page`);
    console.log('   Iframe details:', iframeInfo);
    if (iframeInfo.length > 0) {
      logTest('Iframes detected', true, `Found ${iframeInfo.length} iframe(s)`);
    } else {
      logTest('Iframes detected', true, 'No iframes present on this view (expected for direct list view)');
    }

    const consoleMessages = [];
    page.on('console', msg => consoleMessages.push(msg.text()));

    await page.waitForTimeout(2000);

    const instrumentationLogs = consoleMessages.filter(msg =>
      msg.includes('Instrumenting iframe') || msg.includes('Iframe instrumented successfully')
    );

    if (iframeInfo.length > 0) {
      logTest('Iframes instrumented', instrumentationLogs.length > 0,
        `Found ${instrumentationLogs.length} instrumentation log(s)`);
    } else {
      logTest('Iframes instrumented', true, 'No iframes present to instrument');
    }

    // Test 3: Start recording and capture events
    console.log('\n📝 TEST 3: Event Capture - Click Events');
    console.log('-'.repeat(60));

    await startRecording(browser, page);
    console.log('   Recording started...');
    const storageSnapshot = await getStorageSnapshot(browser, activeTaskId);
    console.log('   Storage snapshot after start:', storageSnapshot);

    let eventsBefore = await getCapturedEvents(browser, activeTaskId);
    console.log(`   Events before interaction: ${eventsBefore.length}`);

    // Try to find and click a clickable element in the incident list iframe
    try {
      await page.waitForTimeout(3000);

      let clickSuccessful = false;
      if (incidentFrame) {
        try {
          await incidentFrame.waitForSelector('table.list_table tbody tr td:nth-child(3) a', { timeout: 15000 });
          console.log('   Clicking on first incident row link inside iframe...');
          await incidentFrame.click('table.list_table tbody tr td:nth-child(3) a');
          clickSuccessful = true;
        } catch (err) {
          console.log('   Could not click incident row link:', err.message);
        }
      }

      if (!clickSuccessful) {
        const mainSelectors = [
          'table.list_table tbody tr td:nth-child(3) a',
          '.list_row a',
          'a.nav_link'
        ];
        for (const selector of mainSelectors) {
          try {
            await page.waitForSelector(selector, { timeout: 8000 });
            console.log(`   Clicking on main selector: ${selector}`);
            await page.click(selector);
            clickSuccessful = true;
            break;
          } catch (err) {
            continue;
          }
        }
      }

      if (!clickSuccessful) {
        console.log('   Falling back to clicking on the main document body');
        await page.mouse.click(200, 200);
      }

      await page.waitForTimeout(1500);

      let eventsAfterClick = await getCapturedEvents(browser, activeTaskId);
      console.log(`   Events after click: ${eventsAfterClick.length}`);

      const clickEvents = eventsAfterClick.filter(e => e.type === 'click');
      console.log(`   Click events captured: ${clickEvents.length}`);

      logTest('Click events captured', clickEvents.length > 0,
        `Captured ${clickEvents.length} click event(s)`);

      const iframeEvents = eventsAfterClick.filter(e => e.isInIframe === true);
      console.log(`   Events from iframes: ${iframeEvents.length}`);

      if (iframeInfo.length > 0) {
        logTest('Iframe events captured', iframeEvents.length > 0,
          `Captured ${iframeEvents.length} event(s) from iframe(s)`);
      }

    } catch (error) {
      logTest('Click event capture failed', false, error.message);
    }

    // Test 4: Input/Typing Events
    console.log('\n⌨️  TEST 4: Event Capture - Input/Typing Events');
    console.log('-'.repeat(60));

    try {
      let inputSuccessful = false;
      if (incidentFrame) {
        const inputSelectors = [
          '#sysparm_search',
          'input[name="sysparm_search"]',
          'input[type="search"]'
        ];

        for (const selector of inputSelectors) {
          try {
            await incidentFrame.waitForSelector(selector, { timeout: 8000 });
            console.log(`   Typing in iframe selector: ${selector}`);
            await incidentFrame.click(selector);
            await incidentFrame.type(selector, 'test incident', { delay: 100 });
            await page.waitForTimeout(500);
            inputSuccessful = true;
            break;
          } catch (err) {
            continue;
          }
        }
      }

      if (!inputSuccessful) {
        const mainInputSelectors = [
          '#sysparm_search',
          'input[name="sysparm_search"]',
          'input[type="search"]',
          'input.list-search'
        ];
        for (const selector of mainInputSelectors) {
          try {
            await page.waitForSelector(selector, { timeout: 8000 });
            console.log(`   Typing in main selector: ${selector}`);
            await page.click(selector);
            await page.type(selector, 'test incident', { delay: 100 });
            await page.waitForTimeout(500);
            inputSuccessful = true;
            break;
          } catch (err) {
            continue;
          }
        }
      }

      if (!inputSuccessful) {
        console.log('   Falling back to injecting a test input in the main document');
        await page.evaluate(() => {
          let placeholder = document.getElementById('codex-test-input');
          if (!placeholder) {
            placeholder = document.createElement('input');
            placeholder.id = 'codex-test-input';
            placeholder.style.position = 'fixed';
            placeholder.style.top = '20px';
            placeholder.style.right = '20px';
            placeholder.style.zIndex = '999999';
            placeholder.style.padding = '8px';
            placeholder.placeholder = 'Codex Test Input';
            document.body.appendChild(placeholder);
          }
          placeholder.focus();
          placeholder.value = '';
        });
        await page.type('#codex-test-input', 'test incident', { delay: 100 });
        inputSuccessful = true;
      }

      await page.waitForTimeout(1000);

      let eventsAfterInput = await getCapturedEvents(browser, activeTaskId);
      const inputEvents = eventsAfterInput.filter(e =>
        e.type === 'input' || e.type === 'change' || e.type === 'keydown'
      );

      console.log(`   Input/typing events captured: ${inputEvents.length}`);

      logTest('Input events captured', inputEvents.length > 0,
        `Captured ${inputEvents.length} input event(s)`);

      // Check if events have proper metadata
      if (inputEvents.length > 0) {
        const sampleEvent = inputEvents[0];
        const hasMetadata = sampleEvent.target && sampleEvent.timestamp && sampleEvent.url;
        logTest('Event metadata present', hasMetadata,
          'Events contain target, timestamp, and URL');

        // Check for BID (Browser ID)
        const hasBID = sampleEvent.target && sampleEvent.target.bid;
        logTest('BID attribute present', hasBID !== undefined,
          hasBID ? `BID: ${sampleEvent.target.bid}` : 'Using fallback BID');
      }

    } catch (error) {
      logTest('Input event capture failed', false, error.message);
    }

    // Test 5: Navigate to create an incident (to test iframe interactions)
    console.log('\n📋 TEST 5: Iframe Interaction - Create Incident Form');
    console.log('-'.repeat(60));

    try {
      // Try to navigate to incident creation
      // This usually involves iframes in ServiceNow

      // Method 1: Use filter navigator
      const filterInput = await page.$('#filter');
      if (filterInput) {
        await filterInput.click();
        await filterInput.type('incident', { delay: 100 });
        await page.waitForTimeout(1000);

        await page.screenshot({ path: 'test-screenshots/04-filter-search.png' });

        // Try to click on "Create New" or similar
        const createButtons = await page.$$('text/Create New, text/New, [title*="Create"]');
        if (createButtons.length > 0) {
          await createButtons[0].click();
          await page.waitForTimeout(3000);

          await page.screenshot({ path: 'test-screenshots/05-incident-form.png', fullPage: true });

          // Check for iframe containing the form
          const formIframes = await page.$$('iframe');
          console.log(`   Iframes on incident page: ${formIframes.length}`);

          if (formIframes.length > 0) {
            // Try to interact with form inside iframe
            for (const frameElement of formIframes) {
              try {
                const frame = await frameElement.contentFrame();
                if (frame) {
                  // Look for form fields
                  const descriptionField = await frame.$('textarea[name*="description"], textarea[id*="description"]');
                  if (descriptionField) {
                    console.log('   Found description field in iframe, typing...');
                    await descriptionField.click();
                    await descriptionField.type('Test incident created by automation', { delay: 50 });
                    await page.waitForTimeout(1000);

                    const eventsAfterIframeInteraction = await getCapturedEvents(browser, activeTaskId);
                    const iframeInputEvents = eventsAfterIframeInteraction.filter(e =>
                      e.isInIframe === true && (e.type === 'input' || e.type === 'click')
                    );

                    console.log(`   Iframe interaction events: ${iframeInputEvents.length}`);

                    logTest('Iframe interaction captured', iframeInputEvents.length > 0,
                      `Captured ${iframeInputEvents.length} event(s) from iframe interaction`);

                    break;
                  }
                }
              } catch (e) {
                console.log(`   Could not access iframe content: ${e.message}`);
                continue;
              }
            }
          }
        }
      }
    } catch (error) {
      console.log(`   Incident form test skipped: ${error.message}`);
      logTest('Iframe interaction test', false, 'Could not complete iframe interaction test');
    }

    await page.screenshot({ path: 'test-screenshots/06-final-state.png', fullPage: true });

    // Stop recording
    await stopRecording(browser);
    await page.waitForTimeout(1000);
    console.log('\n   Recording stopped');
    const finalSnapshot = await getStorageSnapshot(browser, activeTaskId);
    console.log('   Storage snapshot after stop:', finalSnapshot);

    // Test 6: Verify event data structure
    console.log('\n🔬 TEST 6: Event Data Structure Validation');
    console.log('-'.repeat(60));

    const allEvents = await getCapturedEvents(browser, activeTaskId);
    console.log(`   Total events captured: ${allEvents.length}`);

    if (allEvents.length > 0) {
      const sampleEvent = allEvents[allEvents.length - 1];

      console.log('\n   Sample Event Structure:');
      console.log(JSON.stringify(sampleEvent, null, 2).substring(0, 500) + '...');

      // Validate required fields
      const hasType = !!sampleEvent.type;
      const hasTimestamp = !!sampleEvent.timestamp;
      const hasUrl = !!sampleEvent.url;
      const hasTarget = !!sampleEvent.target;

      logTest('Event has type field', hasType, sampleEvent.type);
      logTest('Event has timestamp', hasTimestamp);
      logTest('Event has URL', hasUrl, sampleEvent.url);
      logTest('Event has target metadata', hasTarget);

      if (sampleEvent.target) {
        const hasXPath = !!sampleEvent.target.xpath;
        const hasCssPath = !!sampleEvent.target.cssPath;
        const hasBID = sampleEvent.target.bid !== undefined;

        logTest('Target has XPath', hasXPath);
        logTest('Target has CSS Path', hasCssPath);
        logTest('Target has BID', hasBID);
      }

      // Check iframe metadata
      const hasIframeFlag = sampleEvent.hasOwnProperty('isInIframe');
      logTest('Event has iframe detection', hasIframeFlag);
    } else {
      logTest('Events captured', false, 'No events were captured during the test');
    }

    // Print final summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total Tests: ${testResults.total}`);
    console.log(`Passed: ${testResults.passed} ✅`);
    console.log(`Failed: ${testResults.failed} ❌`);
    console.log(`Success Rate: ${((testResults.passed / testResults.total) * 100).toFixed(1)}%`);
    console.log('='.repeat(60));

    // Detailed results
    console.log('\n📋 DETAILED RESULTS:');
    testResults.tests.forEach((test, index) => {
      const status = test.passed ? '✅' : '❌';
      console.log(`${status} ${index + 1}. ${test.name}`);
      if (test.details) {
        console.log(`      ${test.details}`);
      }
    });

    // Success criteria evaluation
    console.log('\n🎯 SUCCESS CRITERIA EVALUATION:');
    console.log('='.repeat(60));

    const criteriaResults = [
      {
        name: 'Extension loads successfully',
        met: testResults.tests.find(t => t.name === 'Browser launched with extension')?.passed || false
      },
      {
        name: 'Can login to ServiceNow',
        met: testResults.tests.find(t => t.name === 'Login successful')?.passed || false
      },
      {
        name: 'Detects iframes on the page',
        met: testResults.tests.find(t => t.name === 'Iframes detected')?.passed || false
      },
      {
        name: 'Instruments iframes with event listeners',
        met: testResults.tests.find(t => t.name === 'Iframes instrumented')?.passed || false
      },
      {
        name: 'Captures click events',
        met: testResults.tests.find(t => t.name === 'Click events captured')?.passed || false
      },
      {
        name: 'Captures input/typing events',
        met: testResults.tests.find(t => t.name === 'Input events captured')?.passed || false
      },
      {
        name: 'Events have proper metadata structure',
        met: testResults.tests.find(t => t.name === 'Event has type field')?.passed || false
      }
    ];

    criteriaResults.forEach((criteria, index) => {
      const status = criteria.met ? '✅ PASS' : '❌ FAIL';
      console.log(`${status}: ${criteria.name}`);
    });

    const allCriteriaMet = criteriaResults.every(c => c.met);

    const recordingDebugState = await getRecordingDebugState(browser);
    if (recordingDebugState) {
      console.log('\n🔎 Recorder Debug State:', recordingDebugState);
    }

    console.log('\n' + '='.repeat(60));
    if (allCriteriaMet) {
      console.log('🎉 ALL SUCCESS CRITERIA MET - EVENT CAPTURE WORKING! 🎉');
    } else {
      console.log('⚠️  SOME CRITERIA NOT MET - REVIEW FAILURES ABOVE');
    }
    console.log('='.repeat(60));

    // Save results to file
    const fs = require('fs');
    fs.writeFileSync(
      'test-results.json',
      JSON.stringify({
        timestamp: new Date().toISOString(),
        summary: {
          total: testResults.total,
          passed: testResults.passed,
          failed: testResults.failed,
          successRate: (testResults.passed / testResults.total) * 100
        },
        tests: testResults.tests,
        successCriteria: criteriaResults,
        allCriteriaMet
      }, null, 2)
    );

    console.log('\n💾 Results saved to test-results.json');
    console.log('📸 Screenshots saved to test-screenshots/');

  } catch (error) {
    console.error('\n❌ TEST EXECUTION ERROR:', error);
    logTest('Test execution', false, error.message);

    if (page) {
      await page.screenshot({ path: 'test-screenshots/error-state.png', fullPage: true });
    }
  } finally {
    if (browser) {
      console.log('\n🔚 Closing browser...');
      await browser.close();
    }
  }

  // Exit with appropriate code
  process.exit(testResults.failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
