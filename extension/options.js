// Adds .env file to local chrome storage
document.getElementById('envFileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    const text = event.target.result;
    const envVars = {};

    // Parse key=value pairs line by line
    text.split('\n').forEach(line => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        let key = match[1];
        let value = match[2] ? match[2].trim() : '';
        // Strip leading/trailing outer quotes
        value = value.replace(/^['"]|['"]$/g, '');
        envVars[key] = value;
      }
    });

    try {
      const spreadsheetId = envVars.SPREADSHEET_ID || '';
      const googleCredentials = JSON.parse(envVars.GOOGLE_CREDENTIALS || '{}');

      chrome.storage.local.set({ spreadsheetId, googleCredentials }, () => {
        document.getElementById('status').innerText = 'Spreadsheet ID and Credentials loaded successfully!';
      });
    } catch (err) {
      document.getElementById('status').innerText = 'Error: GOOGLE_CREDENTIALS inside .env is not valid JSON.';
    }
  };

  reader.readAsText(file);
});

// Clears .env file
document.getElementById('clearBtn').addEventListener('click', () => {
  chrome.storage.local.clear(() => {
    document.getElementById('status').innerText = 'Credentials cleared! Left-click icon to re-test upload flow.';
  });
});