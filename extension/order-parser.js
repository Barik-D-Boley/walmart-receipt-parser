// Converts Walmart order JSON (captured GraphQL responses or __NEXT_DATA__) into the
// receipt shape the server expects:
//   { receiptDate, transactionCode, orderNumber, storeLocation, subtotal, tax, total,
//     items: [{ name, price, quantity } | { name, price, weight }] }
//
// Walmart's JSON is undocumented, so nothing here relies on exact paths. The parser
// searches the tree by *meaning*: it finds arrays of objects that look like line items
// (a name plus a price) and nearby keys that look like totals. Key-name lists below are
// the single place to adjust if Walmart renames fields.
//
// Loaded as a content script (bridge.js), via importScripts in background.js,
// and via require() in tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WalmartOrderParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Candidate key names, most specific first. Matching is case-insensitive.
  const KEYS = {
    itemName: ['productName', 'name', 'displayName', 'title'],
    itemContainers: ['productInfo', 'product', 'item', 'itemInfo', 'productDetails'],
    linePrice: ['linePrice', 'lineTotal', 'itemTotal', 'totalPrice', 'finalPrice', 'price', 'itemPrice', 'unitPrice'],
    priceContainers: ['priceInfo', 'priceDetails', 'pricing', 'prices', 'price'],
    quantity: ['quantity', 'qty', 'orderedQuantity', 'fulfilledQuantity'],
    weight: ['weight', 'measuredWeight', 'actualWeight', 'itemWeight', 'netWeight'],
    unit: ['unitOfMeasure', 'uom', 'measurementUnit', 'quantityUnit', 'unit'],
    quantityLabel: ['quantityLabel', 'quantityString', 'quantityText', 'displayQuantity'],
    subtotal: ['subTotal', 'subtotal', 'itemsSubTotal', 'itemSubtotal', 'subTotalAmount', 'merchandiseTotal'],
    tax: ['taxTotal', 'totalTax', 'tax', 'taxes', 'salesTax', 'taxAmount'],
    total: ['grandTotal', 'orderTotal', 'total', 'totalAmount', 'amountPaid', 'totalPrice'],
    transactionCode: ['tcNumber', 'tcNum', 'tc', 'transactionCode', 'transactionNumber'],
    orderNumber: ['displayId', 'orderNumber', 'orderNo', 'orderId', 'purchaseOrderId'],
    date: ['orderDate', 'purchaseDate', 'transactionDate', 'orderPlacedDate', 'placedDate', 'orderPlacedTime', 'createdDate', 'date'],
    store: ['storeAddress', 'store', 'storeInfo', 'fulfillmentStore', 'pickupStore', 'storeDetails'],
  };

  // Subtrees that commonly contain product-like objects that are NOT on the receipt
  const SKIP_KEY = /recommend|carousel|sponsor|similar|related|upsell|cross.?sell|banner|tracking|analytics|^ads?$/i;
  const MAX_DEPTH = 40;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // ---------- small helpers ----------

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  function getCI(obj, key) {
    if (!isObj(obj)) return undefined;
    if (key in obj) return obj[key];
    const lower = key.toLowerCase();
    const match = Object.keys(obj).find((k) => k.toLowerCase() === lower);
    return match === undefined ? undefined : obj[match];
  }

  function firstString(obj, keys) {
    for (const key of keys) {
      const v = getCI(obj, key);
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (typeof v === 'number') return String(v);
    }
    return '';
  }

  // Turns 12.34, "12.34", "$1,234.56", "-$2.00", { value: 12.34 }, { displayValue: "$12.34" } into a number
  function toNumber(v, depth = 0) {
    if (v === null || v === undefined || typeof v === 'boolean') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string') {
      const m = v.replace(/,/g, '').match(/(-)?\s*\$?\s*(\d+(?:\.\d+)?)/);
      if (!m) return null;
      return parseFloat(m[2]) * (m[1] ? -1 : 1);
    }
    if (Array.isArray(v)) {
      // e.g. a list of individual taxes
      const nums = v.map((x) => toNumber(x, depth + 1)).filter((n) => n !== null);
      return nums.length ? round2(nums.reduce((a, b) => a + b, 0)) : null;
    }
    if (isObj(v) && depth < 3) {
      for (const key of ['value', 'amount', 'price', 'displayValue', 'displayAmount', 'formattedValue', 'text']) {
        const n = toNumber(getCI(v, key), depth + 1);
        if (n !== null) return n;
      }
    }
    return null;
  }

  const round2 = (n) => Math.round(n * 100) / 100;

  // Looks for `keys` (in priority order) in obj and its nested objects (not arrays), nearest first
  function findNested(obj, keys, convert, maxDepth = 4) {
    for (const key of keys) {
      let level = [obj];
      for (let d = 0; d <= maxDepth && level.length; d++) {
        const next = [];
        for (const node of level) {
          const raw = getCI(node, key);
          if (raw !== undefined) {
            const value = convert(raw);
            if (value !== null && value !== '') return value;
          }
          for (const [k, v] of Object.entries(node)) {
            if (isObj(v) && !SKIP_KEY.test(k)) next.push(v);
          }
        }
        level = next;
      }
    }
    return null;
  }

  // Calls visit(node, depth) for every plain object in the tree
  function walkObjects(node, visit, depth = 0) {
    if (depth > MAX_DEPTH || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const el of node) walkObjects(el, visit, depth + 1);
      return;
    }
    visit(node, depth);
    for (const [k, v] of Object.entries(node)) {
      if (!SKIP_KEY.test(k)) walkObjects(v, visit, depth + 1);
    }
  }

  // ---------- line items ----------

  function itemName(obj) {
    let name = firstString(obj, KEYS.itemName);
    if (!name) {
      for (const c of KEYS.itemContainers) {
        const inner = getCI(obj, c);
        if (isObj(inner)) {
          name = firstString(inner, KEYS.itemName);
          if (name) break;
        }
      }
    }
    return name;
  }

  function itemPrice(obj) {
    // Key priority is outermost so e.g. priceInfo.linePrice beats a top-level unitPrice
    for (const key of KEYS.linePrice) {
      const direct = toNumber(getCI(obj, key));
      if (direct !== null) return direct;
      for (const c of KEYS.priceContainers) {
        const inner = getCI(obj, c);
        if (isObj(inner)) {
          const n = toNumber(getCI(inner, key));
          if (n !== null) return n;
        }
      }
    }
    return null;
  }

  const isItemLike = (obj) => Boolean(itemName(obj)) && itemPrice(obj) !== null;

  // Line items are objects inside arrays that look like items and don't themselves
  // contain more items (so an order "group" holding an items array isn't counted).
  function collectItems(node, inArray = false, depth = 0) {
    if (depth > MAX_DEPTH || node === null || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap((el) => collectItems(el, true, depth + 1));

    const found = [];
    for (const [k, v] of Object.entries(node)) {
      if (SKIP_KEY.test(k) || v === null || typeof v !== 'object') continue;
      found.push(...collectItems(v, false, depth + 1));
    }
    if (found.length === 0 && inArray && isItemLike(node)) return [node];
    return found;
  }

  function normalizeItem(raw) {
    const name = itemName(raw);
    const price = round2(itemPrice(raw));

    const search = (keys) => {
      for (const key of keys) {
        const direct = getCI(raw, key);
        if (direct !== undefined && direct !== null) return direct;
      }
      for (const c of KEYS.itemContainers.concat(['quantityInfo', 'measurement'])) {
        const inner = getCI(raw, c);
        if (isObj(inner)) {
          for (const key of keys) {
            const v = getCI(inner, key);
            if (v !== undefined && v !== null) return v;
          }
        }
      }
      return undefined;
    };

    let quantity = toNumber(search(KEYS.quantity));
    const unitRaw = search(KEYS.unit);
    const unit = typeof unitRaw === 'string' ? unitRaw.trim() : '';
    let weight = null;

    const weightRaw = search(KEYS.weight);
    if (typeof weightRaw === 'string' && weightRaw.trim()) {
      weight = weightRaw.trim().replace(/^Wt\.?\s*/i, '');
    } else if (weightRaw !== undefined) {
      const n = toNumber(weightRaw);
      if (n !== null && n > 0) {
        const wUnit = (isObj(weightRaw) && firstString(weightRaw, KEYS.unit)) || unit || 'lb';
        weight = `${n} ${wUnit.toLowerCase()}`;
      }
    }

    // Weighted produce sometimes comes through as a fractional quantity with a weight unit
    if (!weight && quantity !== null && /^(lb|lbs|pound|pounds|kg|oz|g)$/i.test(unit) && !Number.isInteger(quantity)) {
      weight = `${quantity} ${unit.toLowerCase()}`;
    }

    // Or as a display label like "Wt 1.23 lb" / "Qty 2"
    const label = firstString(raw, KEYS.quantityLabel);
    if (!weight && /\bWt\b/i.test(label)) weight = label.replace(/^.*?\bWt\.?\s*/i, '').trim();
    if (quantity === null && /\bQty\b/i.test(label)) quantity = toNumber(label);

    if (weight) return { name, price, weight };
    return { name, price, quantity: quantity !== null && quantity > 0 ? quantity : 1 };
  }

  // Same merging behavior as the DOM scraper: repeat lines of an identical item become one row
  function combineItems(items) {
    const combined = [];
    for (const item of items) {
      const existing = !item.weight && combined.find((c) => !c.weight && c.name === item.name && c.price === item.price);
      if (existing) existing.quantity += item.quantity;
      else combined.push({ ...item });
    }
    return combined;
  }

  // ---------- order-level fields ----------

  function formatDate(v) {
    if (v === null || v === undefined || v === '') return '';
    const fmt = (y, m, d) => `${MONTHS[m]} ${d}, ${y}`;

    if (typeof v === 'number') {
      const d = new Date(v < 1e12 ? v * 1000 : v);
      return isNaN(d) ? '' : fmt(d.getFullYear(), d.getMonth(), d.getDate());
    }
    const s = String(v).trim().replace(/\s*(purchase|order)\s*$/i, '');
    if (/^\d{10,13}$/.test(s)) return formatDate(Number(s));

    // Use the calendar date as written; don't shift it through a timezone conversion
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return fmt(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

    const d = new Date(s);
    return isNaN(d) ? '' : fmt(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function cleanTransactionCode(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).replace(/^\s*TC#?\s*:?\s*/i, '').trim();
    return /\d{6,}/.test(s.replace(/\D/g, '')) ? s : null;
  }

  function findTransactionCodeInText(root) {
    let code = '';
    walkObjects(root, (obj) => {
      if (code) return;
      for (const v of Object.values(obj)) {
        if (typeof v === 'string') {
          const m = v.match(/TC#\s*:?\s*(\d[\d\s-]{8,}\d)/i);
          if (m) { code = m[1].trim(); return; }
        }
      }
    });
    return code;
  }

  function formatStore(v) {
    if (typeof v === 'string') return v.trim() || null;
    if (!isObj(v)) return null;

    const address = isObj(getCI(v, 'address')) ? getCI(v, 'address') : v;
    const name = firstString(v, ['displayName', 'storeName', 'name']);
    const line1 = firstString(address, ['addressLineOne', 'addressLine1', 'line1', 'street', 'streetAddress']);
    const city = firstString(address, ['city']);
    const state = firstString(address, ['state', 'stateOrProvinceCode', 'stateCode', 'region']);
    const zip = firstString(address, ['postalCode', 'zip', 'zipCode']);

    const cityLine = [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const parts = [name, line1, cityLine].filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  }

  // ---------- order detection ----------

  // The "order" node is the deepest object that has a total nearby and line items below it
  function findOrderNode(root) {
    const candidates = [];
    walkObjects(root, (obj, depth) => {
      if (findNested(obj, KEYS.total, toNumber, 2) !== null && findNested(obj, KEYS.subtotal, toNumber, 2) !== null) {
        candidates.push({ obj, depth });
      }
    });
    candidates.sort((a, b) => b.depth - a.depth);

    for (const { obj } of candidates) {
      const items = collectItems(obj);
      if (items.length) return { node: obj, rawItems: items };
    }
    return null;
  }

  function parseOrderPayload(payload) {
    const found = findOrderNode(payload);
    if (!found) return null;
    const { node, rawItems } = found;

    const total = findNested(node, KEYS.total, toNumber);
    const subtotal = findNested(node, KEYS.subtotal, toNumber);
    const tax = findNested(node, KEYS.tax, toNumber);

    const transactionCode =
      findNested(node, KEYS.transactionCode, cleanTransactionCode) ||
      findTransactionCodeInText(node) ||
      findNested(payload, KEYS.transactionCode, cleanTransactionCode) ||
      '';

    const orderNumber = findNested(node, KEYS.orderNumber, (v) => (v === null || v === undefined || isObj(v) ? null : String(v))) || '';
    const receiptDate = findNested(node, KEYS.date, (v) => formatDate(v) || null) || '';
    const storeLocation = findNested(node, KEYS.store, formatStore) || findNested(payload, KEYS.store, formatStore, 8) || '';

    return {
      receiptDate,
      transactionCode,
      orderNumber,
      storeLocation,
      subtotal: subtotal === null ? null : round2(subtotal),
      tax: tax === null ? null : round2(tax),
      total: total === null ? null : round2(total),
      items: combineItems(rawItems.map(normalizeItem)),
    };
  }

  // ---------- validation & source selection ----------

  function validateReceipt(r) {
    const errors = [];
    const warnings = [];
    if (!r || typeof r !== 'object') return { valid: false, errors: ['no data'], warnings };

    if (!Array.isArray(r.items) || r.items.length === 0) errors.push('no items');
    else if (r.items.some((i) => !i.name || typeof i.price !== 'number' || isNaN(i.price))) errors.push('item missing name or price');
    if (typeof r.total !== 'number' || !(r.total > 0)) errors.push('missing total');
    if (!r.receiptDate || isNaN(new Date(r.receiptDate).getTime())) errors.push('missing or unparseable date');

    if (!r.transactionCode) warnings.push('no transaction code (duplicate detection relies on it)');
    if (typeof r.subtotal === 'number' && typeof r.tax === 'number' && typeof r.total === 'number') {
      if (Math.abs(r.subtotal + r.tax - r.total) > 0.02) warnings.push(`subtotal + tax (${round2(r.subtotal + r.tax)}) != total (${r.total})`);
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  function orderIdFromUrl(url) {
    try {
      const u = new URL(url);
      const m = (u.pathname + u.search).match(/\d{10,}/);
      return m ? m[0] : null;
    } catch (_) {
      return null;
    }
  }

  // sources: [{ label, data }], newest/most-preferred first
  function extractReceiptFromSources(sources, pageUrl) {
    const orderId = pageUrl ? orderIdFromUrl(pageUrl) : null;
    const attempts = [];
    const valid = [];

    for (const source of sources) {
      let receipt = null;
      try {
        receipt = parseOrderPayload(source.data);
      } catch (err) {
        attempts.push({ source: source.label, ok: false, reason: `parser error: ${err.message}` });
        continue;
      }
      if (!receipt) {
        attempts.push({ source: source.label, ok: false, reason: 'no order data found' });
        continue;
      }
      const check = validateReceipt(receipt);
      if (!check.valid) {
        attempts.push({ source: source.label, ok: false, reason: check.errors.join(', ') });
        continue;
      }

      const matchesPage = !orderId || JSON.stringify(source.data).includes(orderId);
      attempts.push({ source: source.label, ok: true, matchesPage });
      if (matchesPage) {
        return { receipt, source: source.label, warnings: check.warnings, attempts };
      }
      valid.push({ receipt, source: source.label, warnings: check.warnings });
    }

    // Page's order id not found in any payload: only trust the data if every valid source agrees
    // (otherwise it may be a different order the user viewed earlier in this tab)
    const fingerprint = (r) => `${r.transactionCode}|${r.orderNumber}|${r.total}`;
    if (valid.length && valid.every((v) => fingerprint(v.receipt) === fingerprint(valid[0].receipt))) {
      return { ...valid[0], attempts };
    }
    return { receipt: null, attempts };
  }

  // Fills gaps in the API result with DOM-scraped values, and keeps the DOM's text formatting
  // where both agree so sheet tab names and TC# duplicate checks stay consistent with past runs.
  function mergeWithDom(apiReceipt, domReceipt) {
    const merged = { ...apiReceipt };
    const dom = domReceipt || {};
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    if (dom.receiptDate && formatDate(dom.receiptDate) === merged.receiptDate) merged.receiptDate = dom.receiptDate;
    if (!merged.receiptDate) merged.receiptDate = dom.receiptDate || '';

    for (const key of ['transactionCode', 'orderNumber']) {
      if (!merged[key] || (dom[key] && norm(dom[key]) === norm(merged[key]))) merged[key] = dom[key] || merged[key] || '';
    }

    // Address formatting differs between sources; prefer the on-page text when available
    if (dom.storeLocation) merged.storeLocation = dom.storeLocation;

    for (const key of ['subtotal', 'tax', 'total']) {
      if (merged[key] === null || merged[key] === undefined) merged[key] = typeof dom[key] === 'number' ? dom[key] : 0;
    }
    return merged;
  }

  return {
    KEYS,
    toNumber,
    formatDate,
    parseOrderPayload,
    validateReceipt,
    extractReceiptFromSources,
    mergeWithDom,
    orderIdFromUrl,
  };
});
