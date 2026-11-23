// Shared JSON parser (WalmartOrderParser) used to validate and merge receipt data
importScripts('order-parser.js');

// Toggle between production and local development
const developerMode = false;
const API_BASE_URL = (developerMode) ? 'http://localhost:3000' : 'https://walmart-receipt-parser.vercel.app';

// Checks local storage and dynamically toggles popup behavior
async function updatePopupState() {
  const { googleCredentials, spreadsheetId } = await chrome.storage.local.get(['googleCredentials', 'spreadsheetId']);

  if (!googleCredentials || !spreadsheetId) {
    // Missing credentials: enable popup UI on left-click
    await chrome.action.setPopup({ popup: 'options.html' });
  } else {
    // Credentials present: disable popup so left-click fires chrome.action.onClicked
    await chrome.action.setPopup({ popup: '' });
  }
}

// Run state check on install, browser startup, and when storage updates
chrome.runtime.onInstalled.addListener(updatePopupState);
chrome.runtime.onStartup.addListener(updatePopupState);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') updatePopupState();
});

// Run once when background service worker wakes up
updatePopupState();

chrome.action.onClicked.addListener(async (tab) => {
  // Pulls saved .env credentials from local Chrome storage
  const { googleCredentials, spreadsheetId } = await chrome.storage.local.get(['googleCredentials', 'spreadsheetId']);

  // Alerts the user if credentials have not been uploaded yet
  if (!googleCredentials || !spreadsheetId) {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => alert("Missing credentials! Please right-click the extension icon, select Options, and upload your .env file.")
    });
    return;
  }

  const receiptData = await getReceiptData(tab.id);

  if (!receiptData) {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => alert("Could not read the receipt data from this page. Make sure a Walmart receipt is open, reload the page, and try again.")
    });
    return;
  }

  // Performs the fetch from background.js
  if (receiptData) {
    // Injects waiting alert
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => alert("Processing receipt... Please wait. The server might take a moment to wake up.")
    });
    
    // Starts the fetch
    fetch(`${API_BASE_URL}/api/receipts`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-spreadsheet-id': spreadsheetId,
        'x-google-credentials': encodeURIComponent(typeof googleCredentials === 'string' ? googleCredentials : JSON.stringify(googleCredentials))
      },
      body: JSON.stringify(receiptData)
    })
    .then(async (res) => {
      const data = await res.json();

      if (res.ok) {
        // Displays server message (e.g., "Transaction already exists. Skipped creation.")
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (msg) => alert(msg),
          args: [data.message || 'Success! Receipt synced to your spreadsheet.']
        });
      } else {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (msg) => alert(msg),
          args: [`Server Error: ${data.error || `Received status code ${res.status}`}`]
        });
      }
    })
    .catch(err => {
      // Injects a connection error alert into the webpage
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (msg) => alert(msg),
        args: [`Connection Error: ${err.message}. Check the extension console for more details.`]
      });
      console.error('Fetch error details:', err);
    });
  }
});

// Asks the content script (bridge.js) to build the receipt from Walmart's own JSON data
async function extractFromApi(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'WRP_EXTRACT_FROM_API' });
  } catch (err) {
    // Content scripts only exist in tabs loaded after the extension was installed/reloaded
    console.warn('API capture unavailable on this tab (reload the page to enable it):', err.message);
    return null;
  }
}

// Logs the raw captured payloads so the parser can be updated if Walmart changes its JSON
async function logApiPayloadsForDebugging(tabId) {
  try {
    const dump = await chrome.tabs.sendMessage(tabId, { type: 'WRP_DUMP_API_PAYLOADS' });
    console.log('[Receipt Parser] Raw Walmart payloads for debugging:', dump);
  } catch (_) {}
}

// Primary: structured JSON (API interception / __NEXT_DATA__). Fallback: DOM scraping.
async function getReceiptData(tabId) {
  const [apiResult, domResults] = await Promise.all([
    extractFromApi(tabId),
    chrome.scripting.executeScript({ target: { tabId }, func: scrapeReceiptData }).catch((err) => {
      console.warn('DOM scraper failed to run:', err.message);
      return null;
    })
  ]);
  const domReceipt = domResults?.[0]?.result || null;

  if (apiResult?.receipt) {
    const merged = WalmartOrderParser.mergeWithDom(apiResult.receipt, domReceipt);
    const check = WalmartOrderParser.validateReceipt(merged);
    if (check.valid) {
      console.log(`[Receipt Parser] Using API data from ${apiResult.source}`, { warnings: check.warnings, attempts: apiResult.attempts });
      return merged;
    }
  }

  console.warn('[Receipt Parser] API data unavailable or invalid, falling back to DOM scraping.', apiResult?.attempts || apiResult);
  await logApiPayloadsForDebugging(tabId);

  const domCheck = WalmartOrderParser.validateReceipt(domReceipt);
  if (domCheck.valid) {
    console.log('[Receipt Parser] Using DOM-scraped data', { warnings: domCheck.warnings });
    return domReceipt;
  }

  console.error('[Receipt Parser] Both API and DOM extraction failed.', { domErrors: domCheck.errors, domReceipt });
  return null;
}

// This function gets injected and runs inside the actual webpage
async function scrapeReceiptData() {
  try {
    // Common regex
    const decimalNumber = /[^0-9.]/g;

    // Scrapes individual data from the receipt page
    let receiptDate = document.querySelector('.print-bill-date')?.innerText?.trim().replace(/\s*(purchase|order)/gi, '') || '';
    let transactionCode = document.querySelector('[data-testid="digital-invoice"]')?.innerText?.trim().replace(/TC# /g, '') || '';
    let orderNumber = document.querySelector('[data-testid="order-number"]')?.innerText?.trim().replace(/Order# /g, '') || '';
    let storeLocation = Array.from(document.querySelectorAll('h3')).find(h => h.innerText?.includes('Store location'))?.parentElement?.nextElementSibling?.innerText?.trim() || '';

    const findPrice = (keyword, exclude) => {
      const row = Array.from(document.querySelectorAll('.justify-between')).find(el => {
        const text = el.textContent || '';
        return text.includes(keyword) && (!exclude || !text.includes(exclude)) && text.includes('$');
      });
      return row ? parseFloat((row.textContent.match(/\$([0-9,.]+)/) || [0, '0'])[1]) : 0;
    };

    let subtotal = findPrice('Subtotal');
    let tax = findPrice('Taxes');
    let total = findPrice('Total', 'Subtotal');

    // Scrapes items from the receipt
    const items = [];
    const itemElements = document.querySelectorAll('[data-testid="itemtile-stack"]');

    itemElements.forEach((element) => {
      let name = element.querySelector('[data-testid="productName"]')?.innerText?.trim() || '';
      let price = parseFloat((element.querySelector('[data-testid="line-price"]')?.innerText?.trim() || '0').replace(decimalNumber, ''));
      let quantityText = element.querySelector('.bill-item-quantity')?.innerText?.trim() || '';

      // Determines the base quantity for the current scraped item
      let currentQty = 1; 
      let currentWeight = null;

      if (quantityText.includes('Qty')) {
        currentQty = parseFloat(quantityText.replace(decimalNumber, ''));
      } else if (quantityText.includes('Wt')) {
        currentWeight = quantityText.replace(/Wt /g, '');
      }

      // Checks if this exact item is already in our array
      let existingItem = items.find(item => item.name === name && item.price === price && !currentWeight);

      // Combines or adds new
      if (existingItem) {
        // If it exists, just add the current quantity to the existing total
        existingItem.quantity += currentQty;
      } else {
        // If it's new, push it to the array
        let newItem = { name, price };
        if (currentWeight) {
          newItem.weight = currentWeight;
        } else {
          newItem.quantity = currentQty;
        }
        items.push(newItem);
      }
    });

    return { receiptDate, transactionCode, orderNumber, storeLocation, subtotal, tax, total, items };
  } catch (error) {
    // The background worker decides whether to alert, since API data may still be available
    console.error("Scraper Error:", error);
    return null;
  }
}