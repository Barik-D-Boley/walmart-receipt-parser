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

  // Executes scraper and gets returned data
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: scrapeReceiptData 
  });

  const receiptData = results[0]?.result;

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
        args: ["Connection Error: The server didn't respond. It might be waking up from sleep, try again in 30 seconds."]
      });
      console.error('Server error:', err);
    });
  }
});

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
    alert("Scraper Error: Could not read the receipt data from this page.");
    console.error("Scraper Error:", error);
  }
}