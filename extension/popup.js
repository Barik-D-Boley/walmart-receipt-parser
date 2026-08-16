// import { google } from 'googleapis';

// Executes when I click the button on popup.html
const scrapeButton = document.getElementById('scrapeReceipt');

// Injects the scrapeReceipt into the website so it can see the necessary HTML elements
async function injectCode() {
  // Query Chrome for the active tab in the current window
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // 
  if (tab && tab.url) {
    chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: scrapeReceipt,
    args: [tab]
  }, (receiptData) => {
    // toSheets(receiptData)
  });
  } else {
    alert('Could not detect the website.');
  }
}

// Scrapes the date, tc#, store location, name, price, quantity, subtotal, tax, and total
function scrapeReceipt(tab) {
  const decimalNumber = /[^0-9.]/g

  // Checks if the page is a walmart receipt before scraping the page
  if (tab.url.startsWith('https://www.walmart.com/orders/')) {
    // 
    const items = [];
    const itemElements = document.querySelectorAll('[data-testid="itemtile-stack"]');

    // Finds the single receipt information
    var receiptDate = document.querySelector('.print-bill-date').innerText.trim().replace(/ purchase/g, '');
    var transactionCode = document.querySelector('[data-testid="digital-invoice"]').innerText.trim().replace(/TC# /g, '');
    var storeLocation = Array.from(document.querySelectorAll('h3')).find(h => h.innerText.includes('Store location')).parentElement.nextElementSibling.innerText.trim();
    var subtotal = parseFloat(document.querySelector('.bill-order-payment-subtotal > span:last-child').innerText.trim().replace(decimalNumber, ''));
    var tax = parseFloat(document.querySelector('.print-fees-item div:last-child span').innerText.trim().replace(decimalNumber, ''));
    var total = parseFloat(document.querySelector('.bill-order-total-payment > span:last-child').innerText.trim().replace(decimalNumber, ''));

    // Creates an object for each item on the receipt
    itemElements.forEach((element) => {
      // Finds the name, price, and quantity of each item
      var name = element.querySelector('[data-testid="productName"]').innerText.trim();
      var price = parseFloat(element.querySelector('[data-testid="line-price"]').innerText.trim().replace(decimalNumber, ''));
      var quantity = element.querySelector('.bill-item-quantity').innerText.trim();

      // Changes the quantity field based on whether it's a quantity, weight, or neither
      if (quantity.includes('Qty')) {
        quantity = parseFloat(quantity.replace(decimalNumber, ''));
        items.push({ name, price, quantity });
      } else if (quantity.includes('Wt')) {
        var weight = element.querySelector('.bill-item-quantity').innerText.trim().replace(/Wt /g, '');
        items.push({ name, price, weight });
      } else {
        items.push({ name, price });
      }
    });

    // Returns the receipt JSON
    const receiptData = { receiptDate, transactionCode, storeLocation, items, subtotal, tax, total };
    console.log(`Receipt: ${JSON.stringify(receiptData, null, 2)}`);
    return receiptData;
  }
  else {
    alert('This is not a walmart receipt');
  }
}

// Checks that the receipt isn't already in the JSON file before adding the new receipt
async function toSheets(receiptData) {
  const auth = new google.auth.GoogleAuth({
    keyFile: 'credentials.json', 
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  const request = {
    spreadsheetId: '14lgjD_pQlHfYCQjqeQI3E93m_yajqQj7L9PbzYYk6M4',
    requestBody: {
      requests: [{
        addSheet: {
          properties: {
            title: receiptData.receiptDate
          }
        }
      }]
    }
  };

  try {
    const response = await sheets.spreadsheets.batchUpdate(request);
    console.log(`Success! New tab created.\nSheet ID: ${response.data.reply.addSheet.properties.sheetId}`);
    return response.data;
  } catch (error) {
    console.error('Error creating new sheet tab:', error.message);
  }
}

scrapeButton.addEventListener('click', injectCode);