const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const path = require('path');

const app = express();
const port = 3000;

// Middleware to parse JSON bodies and allow cross-origin requests
app.use(express.json());
app.use(cors());

// The endpoint your Chrome extension will hit
app.post('/api/receipts', async (req, res) => {
  const receiptData = req.body;
  console.log(`Received data for transaction: ${receiptData.transactionCode}`);

  try {
    // 1. Authenticate with Google
    const auth = new google.auth.GoogleAuth({
      keyFile: path.join(__dirname, 'credentials.json'), 
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // 2. Set up the request to create a new tab named after the date
    const response = await sheets.spreadsheets.get({
      spreadsheetId: '14lgjD_pQlHfYCQjqeQI3E93m_yajqQj7L9PbzYYk6M4',
      fields: 'sheets.properties.title'
    });

    const newSheetName = receiptData.receiptDate;
    const existingSheetNames = response.data.sheets.map(sheet => sheet.properties.title);

    console.log(`Provided responses: ${existingSheetNames}`)

    if (existingSheetNames.includes(newSheetName)) {
      console.log(`Sheet "${newSheetName}" already exists! Skipping creation.`);
      
      res.status(200).json({ 
        message: `Sheet "${newSheetName}" already exists. Skipped creation.` 
      });
    } else {
      // 1. Generate a random unique integer ID for the new sheet tab
      const newSheetId = Math.floor(Math.random() * 1000000000);

      // Helper function to safely format values
      const toCellValue = (val, isNumber = false) => {
        if (val === undefined || val === null || val === '') return { stringValue: '' };
        if (isNumber && !isNaN(Number(val))) {
          return { numberValue: Number(val) };
        }
        return { stringValue: String(val) };
      };

      // 2. Prepare our data lists
      const summaryData = [
        { label: 'Date', value: toCellValue(receiptData.receiptDate) },
        { label: 'Transaction Code', value: toCellValue(receiptData.transactionCode) },
        { label: 'Location', value: toCellValue(receiptData.storeLocation) },
        { label: 'Subtotal', value: toCellValue(receiptData.subtotal, true) },
        { label: 'Tax', value: toCellValue(receiptData.tax, true) },
        { label: 'Total', value: toCellValue(receiptData.total, true) }
      ];

      // Default to an empty array if no items are passed
      const items = receiptData.items || []; 

      // Calculate the total number of rows we need. 
      // It's either the length of our summary data (6) OR the number of items + 1 (for the header row), whichever is larger.
      const totalRowCount = Math.max(summaryData.length, items.length + 1);

      // 3. Build the rows dynamically
      const dynamicRows = [];

      for (let i = 0; i < totalRowCount; i++) {
        const rowValues = [];

        // --- Columns A & B: Summary Data ---
        if (i < summaryData.length) {
          rowValues.push({
            userEnteredValue: { stringValue: summaryData[i].label },
            userEnteredFormat: { textFormat: { bold: true } }
          }); // Col A
          rowValues.push({ userEnteredValue: summaryData[i].value }); // Col B
        } else {
          rowValues.push({}); // Col A empty
          rowValues.push({}); // Col B empty
        }

        // --- Column C: Spacer ---
        rowValues.push({}); // Col C is always empty

        // --- Columns D, E, F, G: Item Data ---
        if (i === 0) {
          // Row 0 gets the Headers
          rowValues.push({ userEnteredValue: { stringValue: 'Name' }, userEnteredFormat: { textFormat: { bold: true } } });
          rowValues.push({ userEnteredValue: { stringValue: 'Price' }, userEnteredFormat: { textFormat: { bold: true } } });
          rowValues.push({ userEnteredValue: { stringValue: 'Quantity' }, userEnteredFormat: { textFormat: { bold: true } } });
          rowValues.push({ userEnteredValue: { stringValue: 'Weight' }, userEnteredFormat: { textFormat: { bold: true } } });
        } else {
          // Offset by 1 since items start on row index 1
          const itemIndex = i - 1; 
          
          if (itemIndex < items.length) {
            const item = items[itemIndex];
            // Note: Change 'item.name' to match whatever your actual object keys are (e.g., item.description)
            rowValues.push({ userEnteredValue: toCellValue(item.name) }); // Col D
            rowValues.push({ userEnteredValue: { numberValue: item.price }, userEnteredFormat: { numberFormat: { 
              type: 'CURRENCY', 
              pattern: '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)' }
            }});
            rowValues.push({ userEnteredValue: toCellValue(item.quantity, true) }); // Col F
            rowValues.push({ userEnteredValue: toCellValue(item.weight) }); // Col G
          } else {
            rowValues.push({}, {}, {}, {}); // Empty D, E, F, G if we are out of items
          }
        }

        dynamicRows.push({ values: rowValues });
      }

      // 4. Assemble the final write request
      const writeRequest = {
        spreadsheetId: '14lgjD_pQlHfYCQjqeQI3E93m_yajqQj7L9PbzYYk6M4',
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: String(receiptData.receiptDate),
                  sheetId: newSheetId
                }
              }
            },
            {
              updateCells: {
                range: {
                  sheetId: newSheetId,
                  startRowIndex: 0,
                  endRowIndex: dynamicRows.length, // Automatically size the range based on our loop
                  startColumnIndex: 0,
                  endColumnIndex: 7 // Columns A through G
                },
                rows: dynamicRows, // Plug in our generated rows here
                fields: 'userEnteredValue,userEnteredFormat.textFormat.bold,userEnteredFormat.numberFormat'
              }
            }
          ]
        }
      };

      // 5. Execute the Google Sheets API call
      await sheets.spreadsheets.batchUpdate(writeRequest);

      console.log(`Success! New tab created. Sheet ID: ${newSheetId}`);

      res.status(200).json({ 
        message: 'Successfully created Google Sheet tab!',
        sheetId: newSheetId
      });
    }
  } catch (error) {
    console.error('Error creating new sheet tab:', error.message);
    // Send the error back to the extension so you can see it in the browser console
    res.status(500).json({ error: error.message });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server is up and listening at http://localhost:${port}`);
});