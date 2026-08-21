chrome.action.onClicked.addListener(async (tab) => {
  // 1. Check if we are on a valid Walmart receipt page
  if (!tab.url || !tab.url.startsWith('https://www.walmart.com/orders/')) {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => alert("Error: This doesn't look like a Walmart receipt page.")
    });
    return;
  }

  // 2. Alert the user that the process has started
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => alert("Processing receipt... Please wait.")
  });

  // 3. Inject and run the scraper function
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: scrapeAndSendToServer
  });
});

// This function gets injected and runs inside the actual webpage
async function scrapeAndSendToServer() {
  try {
    // --- YOUR SCRAPING LOGIC GOES HERE ---
    let receiptDate = document.querySelector('.print-bill-date')?.innerText?.trim().replace(/\s*(purchase|order)/gi, '') || '';
    let transactionCode = document.querySelector('[data-testid="digital-invoice"]')?.innerText?.trim().replace(/TC# /g, '') || '';
    let orderNumber = document.querySelector('[data-testid="order-number"]')?.innerText?.trim() || '';
    
    const storeH3 = Array.from(document.querySelectorAll('h3')).find(h => h.innerText?.includes('Store location'));
    let storeLocation = storeH3?.parentElement?.nextElementSibling?.innerText?.trim() || '';

    // (Add the rest of your subtotal, tax, total, and items scraping logic here)
    let subtotal = parseFloat(document.querySelector('.bill-order-payment-subtotal > span:last-child')?.innerText?.trim().replace(/[^0-9.-]+/g, '') || '0');
    let tax = parseFloat(document.querySelector('.print-fees-item div:last-child span')?.innerText?.trim().replace(/[^0-9.-]+/g, '') || '0');
    let total = parseFloat(document.querySelector('.bill-order-total-payment > span:last-child')?.innerText?.trim().replace(/[^0-9.-]+/g, '') || '0');
    let items = []; // Assuming your items loop is here
    
    const receiptData = { receiptDate, orderNumber, transactionCode, storeLocation, subtotal, tax, total, items };

    // --- SEND TO SERVER ---
    const response = await fetch('https://your-app-name.onrender.com/api/receipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(receiptData)
    });

    // 4. Handle Server Response Alerts
    if (response.ok) {
      const result = await response.json();
      alert(`Success! ${result.message}`);
    } else {
      alert(`Server Error: Received status code ${response.status}`);
    }

  } catch (error) {
    // 5. Handle Server Unreachable / Network Error
    alert("Connection Error: The server isn't responding. Make sure your Node server is running on port 3000.");
    console.error("Scraper Error:", error);
  }
}