const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '../.env');

try {
  let content = fs.readFileSync(envPath, 'utf8');
  let isModified = false;

  // Formats GOOGLE_CREDENTIALS
  const credsMatch = content.match(/GOOGLE_CREDENTIALS=['"]?(\{[\s\S]*?\})['"]?/);
  if (credsMatch) {
    const minified = JSON.stringify(JSON.parse(credsMatch[1]));
    content = content.replace(credsMatch[0], `GOOGLE_CREDENTIALS='${minified}'`);
    console.log('.env GOOGLE_CREDENTIALS formatted successfully!');
    isModified = true;
  } else {
    console.log('Could not find GOOGLE_CREDENTIALS in .env');
  }

  // Formats SPREADSHEET_ID
  // Matches the ID and ignores any existing single/double quotes around it
  const sheetMatch = content.match(/SPREADSHEET_ID=['"]?([^'"\n\r]+)['"]?/);
  if (sheetMatch) {
    const sheetId = sheetMatch[1].trim(); 
    content = content.replace(sheetMatch[0], `SPREADSHEET_ID='${sheetId}'`);
    console.log('.env SPREADSHEET_ID formatted successfully!');
    isModified = true;
  } else {
    console.log('Could not find SPREADSHEET_ID in .env');
  }

  // Saves only if changes were made
  if (isModified) {
    fs.writeFileSync(envPath, content);
  }
} catch (err) {
  console.error('Error reading or writing .env:', err.message);
}