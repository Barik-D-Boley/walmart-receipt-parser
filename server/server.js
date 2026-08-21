const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
const port = process.env.PORT || 3000;

// Middleware to parse JSON bodies and allow cross-origin requests
app.use(express.json());
app.use(cors());

// Server endpoint
app.post('/api/receipts', async (req, res) => {
  const receiptData = req.body;
  console.log(`Received data for transaction: ${receiptData.transactionCode}`);

  try {
    // Authenticates with Google
    const sheets = google.sheets({ version: 'v4', auth });
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    const auth = new google.auth.GoogleAuth({
      credentials, 
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });  

    const newSheetName = String(receiptData.receiptDate).trim();

    // Fetch existing sheets with their IDs
    const response = await sheets.spreadsheets.get({
      spreadsheetId: '14lgjD_pQlHfYCQjqeQI3E93m_yajqQj7L9PbzYYk6M4',
      fields: 'sheets.properties(sheetId,title)'
    });
    const existingSheets = response.data.sheets.map(sheet => sheet.properties.title);
    const existingSheetObj = response.data.sheets.find(sheet => sheet.properties.title === newSheetName);

    let targetSheetId;
    let targetIndex;
    let startRowIndex = 0;
    let isNewSheet = false;

    if (existingSheetObj) {
      // Checks for duplicate transaction code and calculates the start row
      targetSheetId = existingSheetObj.properties.sheetId;

      // Reads existing cell values on this tab
      const sheetData = await sheets.spreadsheets.values.get({
        spreadsheetId: '14lgjD_pQlHfYCQjqeQI3E93m_yajqQj7L9PbzYYk6M4',
        range: `'${newSheetName}'!A:G`,
      });
      const existingRows = sheetData.data.values || [];

      // Checks if the TC# already exists in the sheet
      const tcExists = existingRows.some(row => row.some(cell => String(cell).includes(receiptData.transactionCode)));
      if (tcExists) {
        console.log(`Transaction ${receiptData.transactionCode} already exists on sheet "${newSheetName}".`);
        return res.status(200).json({ 
          message: `Transaction ${receiptData.transactionCode} already exists on sheet "${newSheetName}". Skipped creation.` 
        });
      }

      // Sets start row index to append data below existing rows (leaving a 1-row gap)
      startRowIndex = existingRows.length > 0 ? existingRows.length + 1 : 0;

    } else {
      // --- SHEET DOES NOT EXIST: Create new sheet tab in chronological order ---
      isNewSheet = true;
      targetSheetId = Math.floor(Math.random() * 1000000000);

      const newDateVal = new Date(newSheetName).getTime();
      targetIndex = existingSheets.length;

      for (let i = 0; i < existingSheets.length; i++) {
        const sheetTitle = existingSheets[i];
        if (sheetTitle.toLowerCase() === 'master') continue;

        const sheetDateVal = new Date(sheetTitle).getTime();
        if (!isNaN(sheetDateVal) && newDateVal > sheetDateVal) {
          targetIndex = i;
          break;
        }
      }
    }

    // Helper function to safely format values
    const toCellValue = (val, isNumber = false) => {
      if (val === undefined || val === null || val === '') return { stringValue: '' };
      if (isNumber && !isNaN(Number(val))) {
        return { numberValue: Number(val) };
      }
      return { stringValue: String(val) };
    };

    // Define accounting format
    const accountingFormat = {
      type: 'CURRENCY',
      pattern: '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)'
    };

    // Generate dynamic rows
    const summaryData = [
      { label: 'Date', value: toCellValue(receiptData.receiptDate) },
      { label: 'Transaction Code', value: toCellValue(receiptData.transactionCode) },
      { label: 'Location', value: toCellValue(receiptData.storeLocation), isClip: true },
      { label: 'Subtotal', value: toCellValue(receiptData.subtotal, true), isCurrency: true },
      { label: 'Tax', value: toCellValue(receiptData.tax, true), isCurrency: true },
      { label: 'Total', value: toCellValue(receiptData.total, true), isCurrency: true }
    ];

    const items = receiptData.items || []; 
    const totalRowCount = Math.max(summaryData.length, items.length + 1);
    const dynamicRows = [];

    for (let i = 0; i < totalRowCount; i++) {
      const rowValues = [];

      // --- Columns A & B: Summary Data ---
      if (i < summaryData.length) {
        rowValues.push({
          userEnteredValue: { stringValue: summaryData[i].label },
          userEnteredFormat: { textFormat: { bold: true } }
        }); 

        const colBCell = { userEnteredValue: summaryData[i].value };

        // Set formatting properties if currency or clipped
        if (summaryData[i].isCurrency || summaryData[i].isClip) {
          colBCell.userEnteredFormat = {};
          if (summaryData[i].isCurrency) {
            colBCell.userEnteredFormat.numberFormat = accountingFormat;
          }
          if (summaryData[i].isClip) {
            colBCell.userEnteredFormat.wrapStrategy = 'CLIP';
          }
        }

        rowValues.push(colBCell);
      } else {
        rowValues.push({}, {});
      }

      // --- Column C: Spacer (This keeps C empty!) ---
      rowValues.push({});

      // --- Columns D, E, F, G: Item Data ---
      if (i === 0) {
        rowValues.push({ userEnteredValue: { stringValue: 'Name' }, userEnteredFormat: { textFormat: { bold: true } } });
        rowValues.push({ userEnteredValue: { stringValue: 'Price' }, userEnteredFormat: { textFormat: { bold: true } } });
        rowValues.push({ userEnteredValue: { stringValue: 'Quantity' }, userEnteredFormat: { textFormat: { bold: true } } });
        rowValues.push({ userEnteredValue: { stringValue: 'Weight' }, userEnteredFormat: { textFormat: { bold: true } } });
      } else {
        const itemIndex = i - 1; 
        if (itemIndex < items.length) {
          const item = items[itemIndex];
          rowValues.push({ userEnteredValue: toCellValue(item.name) });
          rowValues.push({ 
            userEnteredValue: { numberValue: item.price }, 
            userEnteredFormat: { numberFormat: accountingFormat }
          }); 
          rowValues.push({ userEnteredValue: toCellValue(item.quantity, true) });
          rowValues.push({ userEnteredValue: toCellValue(item.weight) });
        } else {
          rowValues.push({}, {}, {}, {});
        }
      }

      dynamicRows.push({ values: rowValues });
    }

    // Assemble batch requests conditionally
    const apiRequests = [];

    if (isNewSheet) {
      apiRequests.push({
        addSheet: {
          properties: {
            title: newSheetName,
            sheetId: targetSheetId,
            index: targetIndex
          }
        }
      });
    }

    apiRequests.push({
      updateCells: {
        range: {
          sheetId: targetSheetId,
          startRowIndex: startRowIndex,
          endRowIndex: startRowIndex + dynamicRows.length,
          startColumnIndex: 0,
          endColumnIndex: 7
        },
        rows: dynamicRows,
        fields: 'userEnteredValue,userEnteredFormat.textFormat.bold,userEnteredFormat.numberFormat,userEnteredFormat.wrapStrategy'
      }
    });

    // Execute the request
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: '14lgjD_pQlHfYCQjqeQI3E93m_yajqQj7L9PbzYYk6M4',
      requestBody: { requests: apiRequests }
    });

    console.log(`Success! Data appended to tab "${newSheetName}" starting at row ${startRowIndex + 1}.`);

    res.status(200).json({ 
      message: `Successfully processed transaction for "${newSheetName}"!`,
      sheetId: targetSheetId
    });
    
  } catch (error) {
    console.error('Error processing receipt:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server is up and listening on port ${port}`);
});