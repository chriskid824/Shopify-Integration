require('dotenv').config();
const env = process.env;

const mysql = require('mysql2/promise');

const {
  productCollection,
  variantCollection,
  toTimestamp,
  cleanDocAddress,
} = require('./firestore');


// db

const dbConfig = {
  host: env.DB_HOST ?? 'localhost',
  user: env.DB_USER ?? 'root',
  password: env.DB_PASSWORD ?? '',
  database: env.DB_DATABASE ?? 'test',
};

async function queryDatabase(sql, values) {
  const connection = await mysql.createConnection(dbConfig);
  const [rows] = await connection.query(sql, values);
  connection.end();
  return rows;
}


const run = async (payload) => {
  const { sku, productId, variantId, inventoryItemId, isDelete = false } = payload;
  let { modelNumber } = payload;
  let collection, data, docAddress;
  if (productId) {
    collection = productCollection;
    data = { id: productId };
    docAddress = sku ?? modelNumber;
  } else if (variantId) {
    collection = variantCollection;
    modelNumber = modelNumber ?? sku.slice(0, sku.lastIndexOf('-'));
    data = { id: variantId, inventoryItemId, modelNumber };
    docAddress = sku;
  } else {
    return null;
  }
  const cleanAddress = cleanDocAddress(docAddress);
  const ref = collection.doc(cleanAddress);
  if (isDelete) {
    return ref.delete();
  } else {
    const { createdAt, updatedAt } = payload;
    if (createdAt) {
      data.createdAt = toTimestamp(createdAt);
    }
    if (updatedAt) {
      data.updatedAt = toTimestamp(updatedAt);
    }
    return ref.set(data, { merge: true });
  }
};

const countPerIteration = env.COUNT_PER_ITERATION ? parseInt(env.COUNT_PER_ITERATION) : 1;

async function runBatchFromDb(id, udt) {
  id = id ?? 0;
  udt = udt ?? 0;

  const products = await queryDatabase(
    `SELECT sku, id productId,
    UNIX_TIMESTAMP(created_at) createdAt, UNIX_TIMESTAMP(updated_at) updatedAt,
    UNIX_TIMESTAMP(last_update) udt
    FROM shopify.product_uploaded 
    WHERE last_update > FROM_UNIXTIME(?) OR (last_update = ? AND id > ?)
    ORDER BY last_update ASC, id ASC LIMIT ?`,
    [udt, udt, id, countPerIteration]
  );

  if (products.length === 0) {
    console.log('no further records to sync |', id, udt);
    return null;
  }

  const productMap = {};
  for (const product of products) {
    const { productId } = product;
    productMap[productId] = product;
    productMap[productId].variants = [];
  }
  // assumes latest record is accurate
  // assumes MAX(variant id) is latest
  const allVariants = await queryDatabase(
    `SELECT sku, v.id variantId,
    inventory_item_id inventoryItemId, product_id productId,
    UNIX_TIMESTAMP(created_at) createdAt, UNIX_TIMESTAMP(updated_at) updatedAt
    FROM (SELECT MAX(id) id FROM shopify.product_variant_uploaded
      WHERE product_id in (?)
      GROUP BY sku
    ) x
    LEFT JOIN shopify.product_variant_uploaded v ON v.id = x.id
    ORDER BY product_id ASC`,
    [Object.keys(productMap)]
  );
  for (const variant of allVariants) {
    const { productId } = variant;
    productMap[productId].variants.push(variant);
  }

  let tasks = [];
  for (const product of Object.values(productMap)) {
    const { sku, productId, variants, createdAt, updatedAt } = product;
    const modelNumber = sku;
    // createdAt / updatedAt to milliseconds
    tasks = [
      ...tasks,
      run({
        sku,
        productId,
        createdAt: createdAt * 1000,
        updatedAt: updatedAt * 1000,
      }),
      ...variants.map(({ sku, variantId, inventoryItemId, createdAt, updatedAt }) => 
        run({
          sku,
          variantId,
          inventoryItemId,
          createdAt: createdAt * 1000,
          updatedAt: updatedAt * 1000,
          modelNumber,
        })
      ),
    ];
    console.log(sku, productId, '| variant count:', variants.length);
  }
  try {
    await Promise.all(tasks);
  } catch (e) {
    console.log(e);
    return null;
  }

  const newId = Object.keys(productMap).pop();
  const newUdt = productMap[newId].udt;
  return [newId, newUdt];
};

module.exports = { run, runBatchFromDb };
