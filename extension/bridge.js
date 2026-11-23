// Runs in the extension's isolated world on walmart.com pages, after order-parser.js.
// Collects the JSON responses forwarded by interceptor.js and, when the
// background worker asks, turns them into receipt data with WalmartOrderParser.
(() => {
  const MESSAGE_TAG = 'walmart-receipt-parser:api-response';
  const MAX_CAPTURED = 25;
  const captured = [];

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== MESSAGE_TAG) return;

    let data = event.data.body;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch (_) { return; }
    }
    if (!data || typeof data !== 'object') return;

    captured.push({ url: event.data.url, capturedAt: Date.now(), data });
    if (captured.length > MAX_CAPTURED) captured.shift();
  });

  // Data Next.js embeds in server-rendered pages (used when the order page is loaded directly)
  const readNextData = () => {
    const el = document.getElementById('__NEXT_DATA__');
    if (!el) return null;
    try { return JSON.parse(el.textContent); } catch (_) { return null; }
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'WRP_EXTRACT_FROM_API') {
      // Newest network responses first, then the server-rendered page data
      const sources = captured.slice().reverse().map((c) => ({ label: c.url, data: c.data }));
      const nextData = readNextData();
      if (nextData) sources.push({ label: '__NEXT_DATA__', data: nextData });

      try {
        sendResponse(WalmartOrderParser.extractReceiptFromSources(sources, location.href));
      } catch (err) {
        sendResponse({ receipt: null, attempts: [], error: err.message });
      }
      return;
    }

    if (message?.type === 'WRP_DUMP_API_PAYLOADS') {
      // Raw payloads for debugging when Walmart changes its data format
      sendResponse({ pageUrl: location.href, captured, nextData: readNextData() });
    }
  });
})();
