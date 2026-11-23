// Runs in the page's MAIN world at document_start (see manifest.json).
// Wraps fetch and XMLHttpRequest so that JSON responses from Walmart's own
// data endpoints (GraphQL / "orchestra") are copied and forwarded to the
// extension's isolated-world bridge (bridge.js) via window.postMessage.
// It never changes, delays, or re-issues the page's requests.
(() => {
  if (window.__wrpInterceptorInstalled) return;
  window.__wrpInterceptorInstalled = true;

  const MESSAGE_TAG = 'walmart-receipt-parser:api-response';
  const URL_PATTERN = /\/orchestra\/|graphql/i;

  const forward = (url, body) => {
    try {
      window.postMessage({ source: MESSAGE_TAG, url: String(url), body }, window.location.origin);
    } catch (_) {
      // Unclonable body: ignore, the DOM fallback still works
    }
  };

  const urlOf = (input) => {
    if (typeof input === 'string') return input;
    if (input && typeof input.url === 'string') return input.url; // Request object
    return String(input); // URL object
  };

  // --- fetch ---
  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = function (...args) {
      const promise = originalFetch.apply(this, args);
      try {
        const url = urlOf(args[0]);
        if (URL_PATTERN.test(url)) {
          promise
            .then((res) => {
              const type = res.headers.get('content-type') || '';
              if (!type.includes('json')) return null;
              return res.clone().text();
            })
            .then((text) => { if (text) forward(url, text); })
            .catch(() => {});
        }
      } catch (_) {
        // Never let capture logic break the page
      }
      return promise;
    };
  }

  // --- XMLHttpRequest ---
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__wrpUrl = url;
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    try {
      const url = this.__wrpUrl ? String(this.__wrpUrl) : '';
      if (URL_PATTERN.test(url)) {
        this.addEventListener('load', () => {
          try {
            if (this.responseType === '' || this.responseType === 'text') {
              forward(url, this.responseText);
            } else if (this.responseType === 'json') {
              forward(url, this.response);
            }
          } catch (_) {}
        });
      }
    } catch (_) {}
    return originalSend.apply(this, args);
  };
})();
