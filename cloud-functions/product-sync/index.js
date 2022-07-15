('use strict');
const env = process.env;
const db = require('./database');
const shopify = require('./shopify');
const { requestPriceEngine, requestNexus } = require('./nexus.js');
const { publishMessage } = require('./pubsub.js');
const firestore = require('./firestore');
const payloadHandler = require('./payloadHandler');

const getExistingProduct = async (modelNumber) => {
  let product;
  product = await firestore.getProductDoc(modelNumber);
  if (product) {
    console.log('Product Existed in Firestore.');
    return product;
  } else {
    product = await db.getExistingProduct(modelNumber);
    if (product) {
      console.log('Product Existed in DB.');
      return product;
    } else {
      return null;
    }
  }
};

const publishPriceStockUpdate = async (modelNumber) => {
  // get calculated price/qty from Nexus
  const res = await requestPriceEngine(
    `modelNo/${encodeURIComponent(modelNumber)}`,
  );
  if (res === null) {
    console.log(
      new Error(
        `[${modelNumber}][CREATE] failed to get calculated price from Nexus`,
      ),
    );
  } else {
    // publish price/qty for updating to Shopify
    const topicName = env.TOPIC_PRODUCT_CREATED;
    const { data } = res;
    for (const variant of data) {
      const { sku, price = 0, qty = 0, source } = variant || {};
      if (price > 0 && qty > 0) {
        const messageData = { sku, price, qty, source };
        publishMessage(messageData, topicName);
      }
    }
  }
};
const publishImageUpdate = async (modelNumber) => {
  // get images from Nexus
  const res = await requestNexus(
    `v1/product/${encodeURIComponent(modelNumber)}/imageUrls`,
  );
  if (res === null) {
    console.log(
      new Error(
        `[${modelNumber}][CREATE] failed when fetching image urls from Nexus`,
      ),
    );
  } else {
    if (res.data == undefined) {
      console.log(
        new Error(
          `[${modelNumber}][CREATE] failed when fetching image urls from Nexus, no image urls.`,
        ),
      );
    } else {
      // publish image for updating to Shopify
      const topicName = env.TOPIC_IMAGE_UPDATE;
      const imageUrls = res.data;
      const messageData = { modelNumber, imageUrls };
      publishMessage(messageData, topicName);
    }
  }
};

// core function
const runProductUpdate = async (messageData) => {
  try {
    const message = messageData
      ? Buffer.from(messageData, 'base64').toString()
      : '{}';
    console.log('[RAW Message]:', message);
    const payload = JSON.parse(message);
    console.log('[RAW Message]:', payload);
    if (!payload.modelNumber) {
      console.info(111);
      return;
    }
    payloadHandler.initData(payload);
    console.log('[Init Payload]:', JSON.stringify(payload));
    // Create Or Edit
    // Firestore -> DB -> Create
    const product = await getExistingProduct(payload.modelNumber);
    console.log('product: ', JSON.stringify(product));
    // Check product exist
    if (product) {
      let id = product.id;
      if (payload['delete']) {
        // Delete Forever
        console.log('[Delete ProductVariant]');
        await db.deleteProductVariant(payload.modelNumber);
        console.log('[Delete Product]');
        await db.deleteProduct(payload.modelNumber);
        console.log('[Shopify]Deleting:', id);
        // Delete on Shopify -> Use Id
        const deleteSuccess = await shopify.deleteProduct(id);
        if (deleteSuccess) {
          // Delete in DB (Product_uploaded and Product_variant_uploaded) -> Use Id
          await db.deleteUploadedProductAndVariants(id);
          // Delete in Firestore (Product and Variants) -> Use modelNumber
          await firestore.deleteProductAndVariants(payload.modelNumber);
        }
      } else {
        // If existed, then edit product
        // DB Edit/Update Product and Variant
        console.log('Updating:', id);
        const dbProductObj = await payloadHandler.getDbUpdateProductObj(
          payload,
        );
        console.log('[UpdateDBPayload]', JSON.stringify(dbProductObj));
        const dbProductId = await db.createOrUpdateProduct(dbProductObj);
        console.log('dbProductId', JSON.stringify(dbProductId));

        // Variants Update
        if (payload['variants']) {
          // Resync
          let dbVariantPosition = 1;
          for (const variant of payload.variants) {
            const variantObject = payloadHandler.getDbVariantObject(
              dbProductId,
              payload.modelNumber,
              variant,
              dbVariantPosition,
              payload.gender,
            );
            await db.createOrUpdateProductVariants(variantObject);
            dbVariantPosition++;
          }
        }

        const shopifyPayload = await payloadHandler.getShopifyPayload(payload);
        console.log('[UpdateShopifyPayload]', shopifyPayload);
        const updateResponse = await shopify.updateProduct(id, shopifyPayload);
        console.log(
          '[UpdateResponse]Response:',
          JSON.stringify(updateResponse),
        );
        await db.updateProduct_uploaded(id, shopifyPayload);
        const variants =
          updateResponse['body']['data']['productUpdate']['product'][
            'variants'
          ];
        if (variants) {
          // Re-sync
          console.log('[Resync]Variants');
          // Need to get variants by REST client
          const product = await shopify.getProductAndProductVariant(id);
          console.log('[Resync]product_variant_uploaded');
          await db.updateProduct_variant_uploaded(product['variants']);
        }
      }
    } else if (!payload['delete']) {
      // To Prevent product re-creation that cause by retry
      // Product not exist, Create Product.
      // DB Create Product
      const dbProductObj = await payloadHandler.getDbCreateProductObj(payload);
      const dbProductId = await db.createOrUpdateProduct(dbProductObj);
      console.log('dbProductId', JSON.stringify(dbProductId));

      // DB Create Variant
      let dbVariantPosition = 1;
      for (const variant of payload.variants) {
        const variantObject = payloadHandler.getDbVariantObject(
          dbProductId,
          payload.modelNumber,
          variant,
          dbVariantPosition,
          payload.gender,
        );
        await db.createOrUpdateProductVariants(variantObject);
        dbVariantPosition++;
      }
      // Map payload as Shopify payload
      const shopifyPayload = await payloadHandler.getShopifyPayload(payload);
      console.log('shopifyPayload', JSON.stringify(shopifyPayload));
      let { id, metafields } = await shopify.createProduct(shopifyPayload);
      console.log('[API]Return ID:', id);
      if (id) {
        const product = await shopify.getProductAndProductVariant(id);
        const dbTasks = [];
        dbTasks.push(
          db.createProduct_uploaded(shopifyPayload, product, metafields),
        );
        dbTasks.push(db.createProduct_variant_uploaded(product['variants']));
        await Promise.all(dbTasks);
      }
    }
    if (payload['variants'] && payload['variants'].length) {
      // resync price/stock if payload contains variants
      // TODO : only resync for variants that are newly created on Shopify
      publishPriceStockUpdate(payload.modelNumber);
      publishImageUpdate(payload.modelNumber);
    }
  } catch (e) {
    console.error(e);
    throw e;
  }
};

// entry points

/**
 * Triggered from a message on a Cloud Pub/Sub topic.
 *
 * @param {!Object} event Event payload.
 * @param {!Object} context Metadata for the event.
 */
exports.productUpdate = async (event, context) => {
  const messageData = event.data;
  console.info('messageData');
  console.info(messageData);
  await runProductUpdate(messageData);
};

exports.productUpdateHttp = async (req, res) => {
  const messageData = req.body.message.data;
  await runProductUpdate(messageData);
  res.status(200).send();
};
exports.productUpdateTest = async (messageData) => {
  await runProductUpdate(messageData);
};
exports.publishImageUpdate = publishImageUpdate;
