'use strict';

const db = require('./database');
const firestore = require('./firestore');
const shopify = require('./shopify');
const shopifyClient = require('./shopify-client');

// core functions
const runPriceUpdate = async (messageData) => {
  // get product sku and new price from msg
  // find corresponding variant_id of the SKU
  // With the variant_id, update the price on Shopify
  const message = messageData
    ? Buffer.from(messageData, 'base64').toString()
    : '{}';
  console.log('[RAW]:', message);
  const payload = JSON.parse(message);
  payload['sku'] = payload['sku']?.toUpperCase();
  await updatePrice(payload);
}

async function updatePrice(payload) {
  const needSyncResult = await checkNeedSync(payload);
  if (!needSyncResult) {
    return null;
  }
  const { id, discount, dcodeDiscount } = needSyncResult;
  const { sku, price, source = 'kc' } = payload;
  let compareAtPrice = 0;
  let variantPrice = price;
  if (discount > 0) {
    // set marked up price as "original price"
    compareAtPrice = getOriginalPrice(price, discount);
  } else if (dcodeDiscount > 0) {
    // set marked up price as "listing price", discount will be handled by coupon code
    variantPrice = getOriginalPrice(price, dcodeDiscount);
  }
  const shopifyPayload = {
    id,
    price: variantPrice,
    compareAtPrice,
    metafields: { source: { value: source } },
  };
  const client = await shopifyClient.getClient();
  let success = await syncPrice(
    client,
    sku,
    JSON.parse(JSON.stringify(shopifyPayload)),
  );
  if (!success) {
    console.log(`sku: ${sku} | failed to write to shopify correctly, retry without metafield id`);
    success = await syncPrice(
      client,
      sku,
      JSON.parse(JSON.stringify(shopifyPayload)),
      true,
    );
  }
  if (!success) {
    throw new Error('price mismatch');
  }
};

/**
 * calculate price before discount
 */
const getOriginalPrice = (price, discount) => {
  return Math.ceil(price / (1 - discount / 100));
};

/**
 * if sync required, returns Shopify Product Variant ID from DB
 * else, returns false
 */
const checkNeedSync = async (payload) => {
  const { sku, price, source, forced = false } = payload;
  if (!sku) {
    console.error(new Error(payload, '| Invalid payload, missing sku'));
    return false;
  }
  if (isNaN(parseFloat(price))) {
    console.log(`sku: ${sku} ; price: ${price} ; source: ${source} | invalid price value ... skipping`);
    return false;
  }
  if (parseFloat(price) <= 0) {
    console.log(`sku: ${sku} ; price: ${price} ; source: ${source} | ignore price <= 0 ... skipping`);
    return false;
  }
  let variant = await firestore.getFirestoreDoc(sku);
  let discount = 0;
  let dcodeDiscount = 0;
  try {
    const dbVariant = await db.getProductVariantIdAndPrice(sku);
    if (dbVariant) {
      ({ discount, dcode_discount: dcodeDiscount } = dbVariant);
      if (!(variant?.id)) {
        // fallback to db in case Firestore has not yet been updated
        variant = dbVariant;
      }
    }
  } catch (e) {
    console.log('sku:', sku, '| failed to read db record -', e);
  }
  if (!(variant?.id)) {
    console.log(`sku: ${sku} ; price: ${price} ; source: ${source} | Product Variant not found on Shopify ... skipping`);
    return false;
  }
  const { price: oldPrice = null } = variant;
  if (oldPrice === null) {
    console.log(`sku: ${sku} ; price: ${price} ; source: ${source} | using Firestore data layer, force update to Shopify`);
  } else if (forced) {
    console.log(`sku: ${sku} ; price: ${oldPrice} -> ${price} ; source: ${source} | force update to Shopify`);
  } else if (parseFloat(oldPrice) === price) {
    console.log(`sku: ${sku} ; price: ${price} ; source: ${source} | No change to price ... skipping`);
    return false;
  } else {
    console.log(`sku: ${sku} ; price: ${oldPrice} -> ${price} ; source: ${source}`);
  }
  return { id: variant.id, discount, dcodeDiscount };
};

/**
 * writes: price to Shopify / DB , IDs to Firestore
 */
const syncPrice = async (shopifyClient, sku, payload, skipMetafieldId) => {
  if (!shopifyClient) {
    throw new Error('Missing shopifyClient');
  }
  if (!skipMetafieldId) {
    const docData = await firestore.getFirestoreDoc(sku);
    payload.metafields.source.id = docData.sourceMetafieldId;
  }
  const updatedValues = await shopify.mutate(
    shopifyClient,
    payload,
    'ProductVariant',
    'update',
  );
  console.log(Object.assign({ sku }, updatedValues));
  const { metafields } = updatedValues;
  const docUpdateValues = metafields.reduce(
    (doc, { id, key }) => Object.assign(doc, { [`${key}MetafieldId`]: id }),
    updatedValues.id ? { id: updatedValues.id } : {},
  );
  firestore.setFirestoreDoc(sku, docUpdateValues);
  const priceFloat = parseFloat(payload.price);
  const updatedPriceFloat = parseFloat(updatedValues.price);
  if (
    !isNaN(priceFloat) &&
    !isNaN(updatedPriceFloat) &&
    priceFloat === updatedPriceFloat
  ) {
    const { id } = updatedValues;
    updatedValues['compare_at_price'] = updatedValues.compareAtPrice;
    delete updatedValues.compareAtPrice;
    delete updatedValues.id;
    delete updatedValues.metafields;
    try {
      await db.updateProductById('product_variant_uploaded', id, updatedValues);
    } catch (e) {
      console.warn(
        `${e.code} error in updating product_variant_uploaded, retry once before requeuing message |`,
        e,
      );
      await db.updateProductById('product_variant_uploaded', id, updatedValues);
    }
    return true;
  }
  console.log(`sku: ${sku} ; price: ${priceFloat} ; updatedPrice: ${updatedPriceFloat} | failed to update shopify, need to retry`);
  return false;
}

// entry point

/**
 * Triggered from a message on a Cloud Pub/Sub topic.
 *
 * @param {!Object} event Event payload.
 * @param {!Object} context Metadata for the event.
 */
exports.priceUpdate = async (event) => {
  try {
    const messageData = event.data;
    await runPriceUpdate(messageData);
  } catch (e) {
    console.error(e.message);
    throw e;
  }
};

exports.priceUpdateHttp = async (req, res) => {
  try {
    const messageData = req.body.message.data;
    await runPriceUpdate(messageData);
  } catch (e) {
    console.error(e.message);
    throw e;
  }
  res.status(200).send();
};

exports.updatePrice = updatePrice;
