const db = require('./database');

// initData
const initData = (payload) => {
  // init data
  payload['title'] = [
    payload.name,
    payload.series,
    payload.modelNumber.toUpperCase(),
  ]
    .filter(Boolean)
    .join(' ');
  if (payload['title']) {
    payload['title'] = payload['title']
      .replace('Nike Air Jordan', 'Air Jordan')
      .replace('Nike Air Max', 'Air Max')
      .replace('Nike Air Force', 'Air Force');
  }

  // Metafields handling
  if (payload['metafields']) {
    // Remove metafield which is empty And
    // Convert object to list of object {[key]: value}
    payload['metafields'] = Object.entries(payload['metafields'])
      .filter((metafield) => metafield[1])
      .map((metafield) => {
        return { [metafield[0]]: String(metafield[1]) };
      });
  } else {
    payload['metafields'] = [];
  }
  // Auto insert name and series in metafields
  payload['metafields'].push({ name: payload['name'] });
  payload['metafields'].push({ series: payload['series'] });
};

exports.initData = initData;

const getDbCreateProductObj = async (payload) => {
  const productObj = {
    sku: payload.modelNumber,
    title: payload.title,
    body_html: payload.body_html,
    option1_values: payload.gender,
    status: 'active',
    tags: await db.getTagsFromMappingByTitle(payload.title),
  };
  payload['metafields'].forEach((metafields) => {
    const key = Object.keys(metafields)[0];
    // Add metafields_[key] in productObj
    productObj['metafield_' + key] = metafields[key];
  });
  return productObj;
};

exports.getDbCreateProductObj = getDbCreateProductObj;

const getDbVariantObject = (
  productId,
  modelNumber,
  variant,
  position,
  gender,
) => {
  const variantObject = {
    parent_product_id: productId,
    model_no: modelNumber,
    sku: variant.sku,
    position: position,
    option1: gender,
    option2: variant.size,
  };
  return variantObject;
};

exports.getDbVariantObject = getDbVariantObject;

const getDbUpdateProductObj = async (payload) => {
  const columns = ['title', 'status', 'body_html', 'product_type', 'vendor'];
  const productObj = {};
  columns.forEach((key) => {
    if (payload[key]) {
      productObj[key] = payload[key];
    }
  });
  if (productObj['title']) {
    // Update Tags
    productObj['tags'] = await db.getTagsFromMappingByTitle(
      productObj['title'],
    );
  }
  productObj['sku'] = payload.modelNumber;
  return productObj;
};

exports.getDbUpdateProductObj = getDbUpdateProductObj;

const getTagArray = (tagsObject) => {
  if (tagsObject.length <= 0) {
    return tagsObject;
  }
  // tagsObject will be a list contain one object
  tagsObject = Object.values(tagsObject[0]).reduce(
    (tagStr, current) => tagStr + ',' + current,
  );
  tagsObject = tagsObject.split(',').filter((tag) => tag);
  console.log('tagsObject', JSON.stringify(tagsObject));
  return tagsObject;
};

const getShopifyPayload = async (payload) => {
  // Metafields handling
  if (payload['metafields']) {
    const metafields = {};
    payload['metafields'].forEach((metafield) => {
      console.log('metafields', JSON.stringify(metafield));
      const [key, value] = Object.entries(metafield)[0];
      metafields[key] = {
        key,
        namespace: 'product',
        type: 'single_line_text_field',
        value: String(value),
      };
    });
    payload['metafields'] = Object.values(metafields);
  }

  // Always include model_no in metafields
  // String() is to make sure value always be a string value
  // Metafields name already hard code in initData()
  payload['metafields'].push({
    key: 'model_no',
    namespace: 'product',
    type: 'single_line_text_field',
    value: String(payload['modelNumber']),
  });

  const shopifyPayload = {};
  Object.keys(payload).forEach((key) => {
    switch (key) {
      case 'name':
      case 'series':
      case 'gender':
      // name and series in title
      // gender use in variant
      // take them out of the payload
      case 'notes':
        // `notes` just for logging
        break;
      case 'body_html':
        shopifyPayload['descriptionHtml'] = payload[key];
        break;
      case 'variants':
        const variants = [];
        payload[key].forEach((variant) => {
          const shopifyVariantObj = {};
          shopifyVariantObj['sku'] = variant['sku'];
          shopifyVariantObj['options'] = [payload['gender'], variant['size']];
          // Hard code
          shopifyVariantObj['inventoryItem'] = { tracked: true };
          variants.push(shopifyVariantObj);
        });
        shopifyPayload[key] = variants;
        break;
      case 'status':
        shopifyPayload[key] = payload[key].toUpperCase();
        break;
      case 'product_type':
        shopifyPayload['productType'] = payload[key];
        break;
      default: // modelNumber, title, metafields, vendor
        // initData() handle title
        shopifyPayload[key] = payload[key];
        break;
    }
  });
  // Hard code
  if (!shopifyPayload['status']) {
    shopifyPayload['status'] = 'ACTIVE';
  }
  shopifyPayload['options'] = ['Gender', 'Size'];
  console.info(111);
  console.info(payload.modelNumber);
  const tagsObject = await db.getTagsByModelNumber(payload.modelNumber);
  shopifyPayload['tagsDB'] = tagsObject;
  console.info(tagsObject);
  shopifyPayload['tags'] = getTagArray(tagsObject);

  return shopifyPayload;
};

exports.getShopifyPayload = getShopifyPayload;
