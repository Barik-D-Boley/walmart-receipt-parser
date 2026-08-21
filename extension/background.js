chrome.action.onClicked.addListener(async (tab) => {
  // Check if we are on a valid Walmart receipt page
  if (!tab.url || !tab.url.startsWith('https://www.walmart.com/orders/')) {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => alert("Error: This is not a Walmart receipt page.")
    });
    return;
  }

  // Alert the user that the process has started
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => alert("Processing receipt... Please wait.")
  });

  // Inject and run the scraper function
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: scrapeAndSendToServer
  });
});

// This function gets injected and runs inside the actual webpage
async function scrapeAndSendToServer() {
  try {
    const decimalNumber = /[^0-9.]/g;

    // Scrapes individual data from the receipt page
    let receiptDate = document.querySelector('.print-bill-date')?.innerText?.trim().replace(/\s*(purchase|order)/gi, '') || '';
    let transactionCode = document.querySelector('[data-testid="digital-invoice"]')?.innerText?.trim().replace(/TC# /g, '') || '';
    let orderNumber = document.querySelector('[data-testid="order-number"]')?.innerText?.trim() || '';
    let storeLocation = Array.from(document.querySelectorAll('h3')).find(h => h.innerText?.includes('Store location'))?.parentElement?.nextElementSibling?.innerText?.trim() || '';
    let subtotal = parseFloat(document.querySelector('.bill-order-payment-subtotal > span:last-child')?.innerText?.trim().replace(decimalNumber, '') || '0');
    let tax = parseFloat(document.querySelector('.print-fees-item div:last-child span')?.innerText?.trim().replace(decimalNumber, '') || '0');
    let total = parseFloat(document.querySelector('.bill-order-total-payment > span:last-child')?.innerText?.trim().replace(decimalNumber, '') || '0');

    // Scrapes items from the receipt
    let items = [];
    const itemElements = document.querySelectorAll('[data-testid="itemtile-stack"]');

    itemElements.forEach((element) => {
      let name = element.querySelector('[data-testid="productName"]')?.innerText?.trim() || '';
      let price = parseFloat((element.querySelector('[data-testid="line-price"]')?.innerText?.trim() || '0').replace(decimalNumber, ''));
      let quantityText = element.querySelector('.bill-item-quantity')?.innerText?.trim() || '';

      // Checks if the item has a quantity, weight, or neither and updates the text accordingly 
      if (quantityText.includes('Qty')) {
        let quantity = parseFloat(quantityText.replace(decimalNumber, ''));
        items.push({ name, price, quantity });
      } else if (quantityText.includes('Wt')) {
        let weight = quantityText.replace(/Wt /g, '');
        items.push({ name, price, weight });
      } else {
        items.push({ name, price });
      }
    });

// ----------------
// Make transaction code variable so that it works with orders as well
// ----------------
    const receiptData = { receiptDate, transactionCode, storeLocation, subtotal, tax, total, items };

    // Sends receiptData to the server
    const response = await fetch('https://walmart-receipt-extension-1.onrender.com/api/receipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(receiptData)
    });

    // Handles Server Response Alerts
    if (response.ok) {
      const result = await response.json();
      alert(`Success! ${result.message}`);
    } else {
      alert(`Server Error: Received status code ${response.status}`);
    }

  } catch (error) {
    alert("Connection Error: The server didn't respond. It might be waking up from sleep, try again in 30 seconds.");
    console.error("Scraper Error:", error);
  }
}