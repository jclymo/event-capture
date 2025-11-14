/**
 * Amazon Event Capture Smoke Test
 *
 * Launches Chrome with the extension, starts a recording on amazon.com,
 * performs a product search, clicks the first result, and verifies that
 * events are persisted in chrome.storage.
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const EXTENSION_PATH = path.join(__dirname, 'extension');
const AMAZON_URL = 'https://www.amazon.com/';

let activeTaskId = null;
let cachedServiceWorkerTarget = null;

async function getServiceWorker(browser) {
  if (cachedServiceWorkerTarget) {
    const worker = await cachedServiceWorkerTarget.worker();
    if (worker) {
      return { target: cachedServiceWorkerTarget, worker };
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
  } catch (err) {
    console.warn('   Could not load captured events:', err.message);
    return [];
  }
}

async function startRecording(browser, page) {
  const { worker } = await getServiceWorker(browser);
  const currentUrl = page.url();

  const result = await worker.evaluate(async (targetUrl) => {
    const tabs = await new Promise(resolve => chrome.tabs.query({}, resolve));
    const tab = tabs.find(t => t.url && t.url.includes('amazon.com'));
    if (!tab) {
      throw new Error('Amazon tab not found');
    }

    const taskId = `amazon-${Date.now()}`;
    const startAtMs = Date.now();

    const storage = await new Promise(resolve => chrome.storage.local.get(['taskHistory'], resolve));
    const taskHistory = (storage.taskHistory || {});
    taskHistory[taskId] = {
      id: taskId,
      title: 'Amazon Event Capture',
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
      taskId,
      tabId: tab.id,
      url: tab.url,
      ackStatus: ack.resp.status
    };
  }, currentUrl);

  activeTaskId = result.taskId;
  console.log(`   Recording started for task ${result.taskId} on tab ${result.tabId}`);
}

async function stopRecording(browser) {
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
}

async function runAmazonTest() {
  const testLog = [];
  const logTest = (name, passed, details = '') => {
    testLog.push({ name, passed, details });
    const status = passed ? '✅' : '❌';
    console.log(`${status} ${name}${details ? ` — ${details}` : ''}`);
  };

  let browser;
  let page;

  try {
    browser = await puppeteer.launch({
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ],
      defaultViewport: { width: 1400, height: 900 }
    });

    const pages = await browser.pages();
    page = pages[0];

    console.log('\n🌐 Navigating to Amazon...');
    await page.goto(AMAZON_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    const cookieButton = await page.$('#sp-cc-accept');
    if (cookieButton) {
      await cookieButton.click();
      await page.waitForTimeout(500);
    }
    logTest('Amazon home loaded', true, AMAZON_URL);

    await startRecording(browser, page);

    console.log('   Performing search for "wireless mouse"...');
    await page.waitForSelector('#twotabsearchtextbox', { timeout: 15000 });
    await page.click('#twotabsearchtextbox', { delay: 50 });
    await page.type('#twotabsearchtextbox', 'wireless mouse', { delay: 80 });
    await page.keyboard.press('Enter');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });
    console.log(`   Search results URL: ${page.url()}`);
    await page.screenshot({ path: 'test-screenshots/amazon-search.png', fullPage: true }).catch(() => {});
    logTest('Search executed', true, 'Query: wireless mouse');

    console.log('   Clicking within search results grid...');
    await page.mouse.move(400, 600);
    await page.mouse.click(400, 600);
    await page.waitForTimeout(1000);
    logTest('Click issued on results grid', true);

    await page.waitForTimeout(2000);

    const events = await getCapturedEvents(browser, activeTaskId);
    console.log(`   Captured ${events.length} total event(s)`);
    const clickEvents = events.filter(e => e.type === 'click');
    const inputEvents = events.filter(e => e.type === 'input');

    logTest('Click events captured', clickEvents.length > 0, `Count: ${clickEvents.length}`);
    logTest('Input events captured', inputEvents.length > 0, `Count: ${inputEvents.length}`);

    if (events.length > 0) {
      console.log('   Sample event:', JSON.stringify(events[events.length - 1], null, 2).substring(0, 400) + '...');
    }

    await stopRecording(browser);

    fs.writeFileSync('test-results-amazon.json', JSON.stringify({
      timestamp: new Date().toISOString(),
      steps: testLog,
      totals: {
        events: events.length,
        clickEvents: clickEvents.length,
        inputEvents: inputEvents.length
      },
      sampleEvent: events[events.length - 1] || null
    }, null, 2));
    console.log('\n💾 Amazon results saved to test-results-amazon.json');

  } catch (error) {
    console.error('❌ Amazon test failed:', error);
    if (browser) {
      const events = await getCapturedEvents(browser, activeTaskId);
      fs.writeFileSync('test-results-amazon.json', JSON.stringify({
        timestamp: new Date().toISOString(),
        error: error.message,
        eventsCaptured: events.length
      }, null, 2));
    }
    process.exitCode = 1;
  } finally {
    if (browser) {
      console.log('\n🔚 Closing browser...');
      await browser.close();
    }
  }
}

runAmazonTest().catch(err => {
  console.error('Fatal Amazon test error:', err);
  process.exit(1);
});
