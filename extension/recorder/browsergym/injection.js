// BrowserGym script injection

export async function injectBrowserGymScript() {
  return new Promise((resolve) => {
    if (window.browserGymInitialized) {
      console.log('✅ BrowserGym already initialized');
      resolve(true);
      return;
    }

    let timeoutId = null;
    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      document.removeEventListener('browsergym-injection-complete', completionHandler);
    };

    const completionHandler = (event) => {
      cleanup();
      console.log('✅ BrowserGym injection complete:', event.detail);
      resolve(event.detail?.success === true);
    };

    const signalTimeout = () => {
      cleanup();
      console.warn('⏱️ BrowserGym injection timeout');
      resolve(false);
    };

    document.addEventListener('browsergym-injection-complete', completionHandler, { once: true });
    timeoutId = setTimeout(signalTimeout, 10000); // Increased to 10s for complex pages like Amazon

    // Direct DOM injection (same method as iframe injection)
    console.log('💉 Injecting BrowserGym script directly into main document');
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('browsergym-inject.js');
      script.onload = () => {
        console.log('📜 BrowserGym script loaded in main document');
      };
      script.onerror = () => {
        cleanup();
        console.error('❌ Failed to inject BrowserGym script');
        resolve(false);
      };
      (document.head || document.documentElement)?.appendChild(script);
    } catch (err) {
      cleanup();
      console.error('❌ BrowserGym injection error:', err);
      resolve(false);
    }
  });
}

