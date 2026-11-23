// Tests for extension/order-parser.js
// NOTE: fixtures are SYNTHETIC approximations of Walmart's order JSON, not captured responses.
// Replace/add fixtures with real (anonymized) payloads from the service-worker console when available.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../extension/order-parser.js');

const graphqlOrder = {
  data: {
    order: {
      id: '200012345678901',
      displayId: '2000123-45678901',
      orderDate: '2026-11-20T18:42:00-06:00',
      tcNumber: '1234 5678 9012 3456 7890',
      store: { displayName: 'Walmart Supercenter', address: { addressLineOne: '123 Main St', city: 'Springfield', state: 'IL', postalCode: '62701' } },
      groups: [
        {
          title: 'Picked up Nov 20',
          items: [
            { productInfo: { name: 'Great Value Milk 1 gal' }, quantity: 1, priceInfo: { linePrice: { value: 3.48, displayValue: '$3.48' }, unitPrice: { value: 3.48 } } },
            { productInfo: { name: 'Bananas' }, quantity: 1.31, unitOfMeasure: 'LB', priceInfo: { linePrice: { displayValue: '$0.66' } } },
            { productInfo: { name: 'Bread' }, quantity: 1, priceInfo: { linePrice: { value: 2.0 } } },
            { productInfo: { name: 'Bread' }, quantity: 1, priceInfo: { linePrice: { value: 2.0 } } },
          ],
        },
      ],
      priceDetails: {
        subTotal: { value: 8.14 },
        taxTotal: { value: 0.57 },
        grandTotal: { displayValue: '$8.71' },
      },
    },
    recommendations: [{ name: 'Decoy product', price: 9.99 }],
  },
};

const nextDataOrder = {
  props: { pageProps: { initialData: { data: { order: {
    orderNumber: 987654321012,
    purchaseDate: 'Oct 5, 2026',
    items: [
      { name: 'Apples', weight: { value: 2.5, unit: 'lb' }, linePrice: '$3.10' },
      { name: 'Eggs', qty: 2, linePrice: 5.5 },
    ],
    totals: { subtotal: '$8.60', taxes: [{ amount: 0.3 }, { amount: 0.2 }], total: 9.1 },
    receiptFooter: 'Thank you! TC# 1111 2222 3333 4444 5555',
  } } } } },
  carousel: { items: [{ name: 'Ad item', price: 1 }] },
};

test('parses a GraphQL-style order', () => {
  const r = P.parseOrderPayload(graphqlOrder);
  assert.equal(r.receiptDate, 'Nov 20, 2026');
  assert.equal(r.transactionCode, '1234 5678 9012 3456 7890');
  assert.equal(r.orderNumber, '2000123-45678901');
  assert.equal(r.storeLocation, 'Walmart Supercenter, 123 Main St, Springfield, IL 62701');
  assert.equal(r.subtotal, 8.14);
  assert.equal(r.tax, 0.57);
  assert.equal(r.total, 8.71);
  assert.deepEqual(r.items, [
    { name: 'Great Value Milk 1 gal', price: 3.48, quantity: 1 },
    { name: 'Bananas', price: 0.66, weight: '1.31 lb' },
    { name: 'Bread', price: 2, quantity: 2 },
  ]);
  assert.ok(P.validateReceipt(r).valid);
});

test('parses a __NEXT_DATA__-style order with different key names and ignores decoys', () => {
  const r = P.parseOrderPayload(nextDataOrder);
  assert.equal(r.receiptDate, 'Oct 5, 2026');
  assert.equal(r.orderNumber, '987654321012');
  assert.equal(r.transactionCode, '1111 2222 3333 4444 5555');
  assert.equal(r.subtotal, 8.6);
  assert.equal(r.tax, 0.5);
  assert.equal(r.total, 9.1);
  assert.deepEqual(r.items, [
    { name: 'Apples', price: 3.1, weight: '2.5 lb' },
    { name: 'Eggs', price: 5.5, quantity: 2 },
  ]);
});

test('returns null for payloads without an order', () => {
  assert.equal(P.parseOrderPayload({ data: { user: { name: 'x' } } }), null);
  assert.equal(P.parseOrderPayload(nextDataOrder.carousel), null);
});

test('extractReceiptFromSources prefers the payload matching the page order id', () => {
  const sources = [
    { label: 'older order', data: nextDataOrder },
    { label: 'current order', data: graphqlOrder },
  ];
  const res = P.extractReceiptFromSources(sources, 'https://www.walmart.com/orders/200012345678901');
  assert.equal(res.source, 'current order');
  assert.equal(res.receipt.total, 8.71);
});

test('extractReceiptFromSources refuses ambiguous non-matching payloads', () => {
  const sources = [{ label: 'a', data: nextDataOrder }, { label: 'b', data: graphqlOrder }];
  const res = P.extractReceiptFromSources(sources, 'https://www.walmart.com/orders/999999999999999');
  assert.equal(res.receipt, null);
});

test('mergeWithDom keeps DOM formatting where values agree and fills gaps', () => {
  const api = { ...P.parseOrderPayload(graphqlOrder), storeLocation: '', tax: null };
  const dom = { receiptDate: 'Nov 20, 2026', transactionCode: '1234 5678 9012 3456 7890', storeLocation: 'Springfield Supercenter\n123 Main St', tax: 0.57, items: [] };
  const merged = P.mergeWithDom(api, dom);
  assert.equal(merged.storeLocation, dom.storeLocation);
  assert.equal(merged.tax, 0.57);
  assert.equal(merged.items.length, 3);
  assert.equal(P.mergeWithDom(api, null).tax, 0);
});

test('validateReceipt rejects incomplete data', () => {
  assert.equal(P.validateReceipt(null).valid, false);
  assert.equal(P.validateReceipt({ items: [], total: 5, receiptDate: 'Nov 1, 2026' }).valid, false);
  assert.equal(P.validateReceipt({ items: [{ name: 'a', price: 1 }], total: 0, receiptDate: 'Nov 1, 2026' }).valid, false);
});

test('toNumber and formatDate handle common formats', () => {
  assert.equal(P.toNumber('$1,234.56'), 1234.56);
  assert.equal(P.toNumber('-$2.00'), -2);
  assert.equal(P.toNumber({ displayValue: '$3.10' }), 3.1);
  assert.equal(P.toNumber('Free'), null);
  assert.equal(P.formatDate('2026-01-03T23:30:00Z'), 'Jan 3, 2026');
  assert.equal(P.formatDate('Nov 20, 2026 purchase'), 'Nov 20, 2026');
});
