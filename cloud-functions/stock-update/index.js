'use strict';

const db = require('./database');
const firestore = require('./firestore');
const shopify = require('./shopify');
const shopifyClient = require('./shopify-client');

// core function
const runStockUpdate = async (messageData) => {
  // get product sku and new qty from msg
  // find corresponding variant_id of the SKU
  // With the variant_id, update the qty on Shopify
  const message = messageData
    ? Buffer.from(messageData, 'base64').toString()
    : '{}';
  console.log('[RAW]:', message);
  const payload = JSON.parse(message);
  await updateStock(payload);
};

async function updateStock(payload) {
  const { sku, qty: rawQty } = payload;
  if (!sku) {
    console.error(new Error('Invalid payload, missing sku'));
    return null;
  }
  const qty = parseInt(rawQty);
  if (isNaN(qty)) {
    console.error(
      new Error('sku:', sku, '; qty:', rawQty, typeof rawQty, '| Invalid qty'),
    );
    return null;
  }
  const docData = await firestore.getFirestoreDoc(sku);
  const { inventoryItemId, id = null } = docData;
  if (id === null) {
    console.error(
      new Error(`sku: ${sku} ; qty: ${qty} | Product Variant not found on Shopify ... skipping`),
    );
    return null;
  }
  const client = await shopifyClient.getClient();
  const inventory = await shopify.queryInventory(client, inventoryItemId);
  const { id: inventoryLevelId, available: shopifyQty } = inventory;
  if (shopifyQty === qty) {
    db.updateProductById('product_variant_uploaded', id, {
      inventory_quantity: shopifyQty,
    });
    console.log(`sku: ${sku} ; qty: ${shopifyQty} | No change to stock ... writing db and skipping`);
    return null;
  }
  console.log(`sku: ${sku} ; qty: ${shopifyQty} -> ${qty}`);
  const updatedValues = await shopify.mutateInventory(client, {
    inventoryLevelId,
    availableDelta: qty - shopifyQty,
  });
  console.log(Object.assign({ sku }, updatedValues));
  const updatedQtyInt = parseInt(updatedValues.available);
  try {
    await db.updateProductById('product_variant_uploaded', sku, {
      inventory_quantity: updatedQtyInt,
    });
  } catch (e) {
    console.warn(
      `${e.code} error in updating product_variant_uploaded, retry once before requeuing message |`,
      e,
    );
    await db.updateProductById('product_variant_uploaded', sku, {
      inventory_quantity: updatedQtyInt,
    });
  }
  if (isNaN(updatedQtyInt) || qty !== updatedQtyInt) {
    throw new Error(
      'sku:',
      sku,
      '; qty:',
      qty,
      '; updatedQty:',
      updatedQtyInt,
      typeof updatedValues.available,
      '| qty mismatch',
    );
  }
}

// entry points

/**
 * Triggered from a message on a Cloud Pub/Sub topic.
 *
 * @param {!Object} event Event payload.
 * @param {!Object} context Metadata for the event.
 */
exports.stockUpdate = async (event) => {
  try {
    const messageData = event.data;
    await runStockUpdate(messageData);
  } catch (e) {
    console.error(e.message);
    throw e;
  }
};

exports.stockUpdateHttp = async (req, res) => {
  try {
    const messageData = req.body.message.data;
    await runStockUpdate(messageData);
  } catch (e) {
    console.error(e.message);
    throw e;
  }
  res.status(200).send();
};

module.exports.updateStock = updateStock;
