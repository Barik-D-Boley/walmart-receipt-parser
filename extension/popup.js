// Executes when I click the button on popup.html
const scrapeButton = document.getElementById("scrapeReceipt");

async function injectCode() {
  // Query Chrome for the active tab in the current window
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // 
  if (tab && tab.url) {
    chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: scrapeReceipt,
    args: [tab]
  }, (results) => {
    // This prints the returned data to your popup or VS Code console
    // alert("Data from page:", results[0].result);
  });
  } else {
    alert("Could not detect the website.");
  }
}

function scrapeReceipt(tab) {
  // Checks if the page is a walmart receipt before scraping the page
  if (tab.url.startsWith("https://www.walmart.com/orders/")) {
    
    // Scrape the tc#, date, location, name, price, quantity, subtotal, total, tax
    const receipt = [];
    const items = [];

    const transactionCode = document.querySelector('[data-testid="digital-invoice"]').innerText.trim();
    const receiptDate = document.querySelector('section[data-dca-type="module"] h2').innerText.trim();
    // const storeLocation = document.querySelector('section[data-dca-type="module"] h2').innerText.trim();
    const subtotal = document.querySelector('.bill-order-payment-subtotal > span:last-child').innerText.trim();
    const tax = document.querySelector('.print-fees-item div:last-child span').innerText.trim();
    const total = document.querySelector('.bill-order-total-payment > span:last-child').innerText.trim();

    const elements = document.querySelectorAll('[data-testid="itemtile-stack"]');

    elements.forEach((element) => {
      const name = element.querySelector('[data-testid="productName"]').innerText.trim();
      var price = element.querySelector('[data-testid="line-price"]').innerText.trim();
      var quantity = element.querySelector('.bill-item-quantity').innerText.trim();

      price = parseFloat(price.replace(/[^0-9.]/g, ""));

      if (quantity.includes("Qty")) {
        quantity = parseFloat(quantity.replace(/[^0-9.]/g, ""));
        items.push({ name, price, quantity });
      } else if (quantity.includes("Wt")) {
        var weight = element.querySelector('.bill-item-quantity').innerText.trim();
        weight = weight.replace(/Wt /g, "");
        items.push({ name, price, weight });
      } else {
        items.push({ name, price });
      }
    });

    receipt.push({ transactionCode, receiptDate, items, subtotal, tax, total })
    console.log(`Receipt: ${JSON.stringify(receipt, null, 2)}`);
  }
  else {
    alert("This is not a walmart receipt");
  }
}

scrapeButton.addEventListener("click", injectCode);