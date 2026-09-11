# Walmart Receipt Parser & Automator

![Chrome Extension](https://img.shields.io/badge/Chrome_Extension-MV3-blue?logo=googlechrome)
![Node.js](https://img.shields.io/badge/Node.js-18+-green?logo=nodedotjs)
![Express](https://img.shields.io/badge/Express-4.x-lightgrey?logo=express)
![Google Sheets API](https://img.shields.io/badge/Google_Sheets_API-v4-34A853?logo=googlesheets)

A full-stack automation tool designed to extract receipt details directly from Walmart order pages and sync them into organized, custom-formatted Google Spreadsheet tabs. 

Built with a **Chrome Extension (Manifest V3)** frontend and an **Express.js / Google Sheets API** backend, this project eliminates manual data entry by extracting itemized pricing, order totals, taxes, and metadata with a single click.

---

## Visual Overview

*(Replace these image paths with your actual screenshots/GIFs once added to your repository)*

| Chrome Extension Action | Automated Google Sheet Output |
| :---: | :---: |
| ![Extension Demo](docs/extension-demo.gif) | ![Spreadsheet Output](docs/sheets-output.png) |
| *1-Click DOM Parsing on Walmart.com* | *Dynamic tab creation & Accounting formatting* |

---

## System Architecture

```
┌─────────────────────────────────┐
│     1. Chrome Extension         │
│  (User clicks toolbar icon)     │
└────────────────┬────────────────┘
                 │
                 │ Injects scraper script via chrome.scripting
                 ▼
┌─────────────────────────────────┐
│     2. Walmart Order Page       │
│  (DOM Scraper extracts data)    │
└────────────────┬────────────────┘
                 │
                 │ Sends JSON payload (POST request)
                 ▼
┌─────────────────────────────────┐
│     3. Express API Server       │
│   (Node.js / Render backend)    │
└────────────────┬────────────────┘
                 │
                 │ Authenticates & sends batchUpdate
                 ▼
┌─────────────────────────────────┐
│     4. Google Sheets API        │
│   (Appends formatted data)      │
└─────────────────────────────────┘

```

---

## Key Features

* **Automated DOM Extraction**: Scrapes transaction codes (TC#), order dates, store locations, item names, individual prices, quantities, and weights directly from Walmart order pages.
* **Smart Tab Management**: Automatically creates new spreadsheet tabs named by purchase date and inserts them in chronological order.
* **Duplicate Prevention**: Reads existing sheet records before writing to ensure identical transaction codes (TC#) are not duplicated.
* **Native Cell Formatting**: Uses Google Sheets `batchUpdate` to set dynamic accounting currency formats (`$#,##0.00`), bold headers, text clipping, and auto-spaced item columns.
* **Cold-Start Resiliency**: Frontend alerts warn users if the backend (e.g., hosted on Render free tier) is waking up, allowing graceful retries.

---

## Tech Stack

| Domain | Technology | Description |
| :--- | :--- | :--- |
| **Frontend** | JavaScript (ES6+), Chrome Extension APIs | Manifest V3 script injection & tab inspection |
| **Backend** | Node.js, Express.js | REST API handling POST payloads & Google Auth |
| **Integrations** | Googleapis (`v4`) | Service Account authentication & raw sheet batch updates |
| **Hosting** | Render / Localhost | Deployment environment for backend API |

---

## Project Structure

```
walmart-receipt-parser/
├── extension/
│   ├── icons/             # Extension toolbar icon (180x180 PNG)
│   │   └── icon.png
│   ├── background.js      # MV3 Service worker & DOM scraping logic
│   └── manifest.json      # Extension permissions & host access
├── server/
│   ├── credentials.json   # Google Service Account keys (Local dev)
│   └── server.js          # Express API & Google Sheets batch update logic
├── .gitignore             # Ignore node_modules & sensitive JSON keys
├── package.json           # Server dependencies
└── README.md
```

---

## Getting Started

Select the setup path that fits your goal:

### Option A: Chrome Extension (Plug & Play)

*Best for immediately testing the parser using the live, Render-hosted API backend.*

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/your-username/walmart-receipt-parser.git](https://github.com/your-username/walmart-receipt-parser.git)
   ```
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Toggle **Developer mode** on (top right corner).
4. Click **Load unpacked** and select the `extension/` directory.

---

### Option B: Full-Stack Setup (Developer / Local Server)

*Best for testing backend changes, modifying Google Sheets logic, or running a local server instance.*

#### Prerequisites
* **Node.js** (v18.0.0 or higher)
* **Google Cloud Console Account** with the **Google Sheets API** enabled and a Service Account key generated.
* **Google Spreadsheet** shared with your Service Account's email address (with *Editor* permissions).

#### Local Setup Steps

1. **Clone the repository & install dependencies:**
   ```bash
   git clone [https://github.com/your-username/walmart-receipt-parser.git](https://github.com/your-username/walmart-receipt-parser.git)
   cd walmart-receipt-parser
   npm install
   ```

2. **Configure Environment Variables:**
   Create a `.env` file in the root directory (never commit this file to Git):
   ```env
   PORT=3000
   GOOGLE_CREDENTIALS={"type":"service_account","project_id":"your_project_id",...}
   ```

3. **Start the local server:**
   ```bash
   node server/server.js
   ```

4. **Point Extension to Local Server:**
   * Open `extension/background.js` and change the API endpoint URL to `http://localhost:3000/api/receipts`.
   * Open `chrome://extensions/`, enable **Developer mode**, click **Load unpacked**, and select the `extension/` directory.


---

## Usage Instructions

1. Log into your Walmart account and open any digital receipt page under your order history (`https://www.walmart.com/orders/...`).
2. Click the **Walmart Receipt Parser** extension icon in your Chrome toolbar (The extension will alert you that processing has started).
3. Once complete, a confirmation prompt will display and your Google Spreadsheet will update automatically.

---

## Security & Privacy

* **Zero Hardcoded Credentials**: Service Account private keys are managed via environment variables (`GOOGLE_CREDENTIALS`) rather than committed JSON files.
* **Ignored Secrets**: `.gitignore` explicitly prevents sensitive credentials (`credentials.json`, `.env`) from being uploaded to GitHub.
* **Minimal Permissions**: The Chrome extension restricts host execution exclusively to `walmart.com/orders/*` pages.

---

**Author:** Barik Boley — B.S. Mechanical Engineering  
**Contact:** barik.boley@gmail.com | [linkedin.com/in/barik-boley](https://www.linkedin.com/in/barik-boley/)

---

## Additions

.env cleanup
node scripts/format-env.js

Toggle devMode in background.js

Known limitations:
Breaks whenever Walmart updates their code

V2 will have API interception