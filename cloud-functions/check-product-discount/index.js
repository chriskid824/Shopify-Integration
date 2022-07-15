('use strict');
const env = process.env;
const Firestore = require('@google-cloud/firestore');
const mysql = require('mysql2/promise');
const { requestNexus } = require('./nexus');
const { publishMessage } = require('./pubsub');

const firestore = new Firestore();
const lastCheckRef = firestore.collection('checkDiscount').doc('lastCheck');

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

async function getUpdatedProductDiscounts(id, udt, limit) {
  return queryDatabase(
    `SELECT product_id pid, UNIX_TIMESTAMP(tag_promotion_dt) udt, sku modelNumber
    FROM product
    WHERE tag_promotion_dt IS NOT NULL AND status = 'active'
    AND (tag_promotion_dt > FROM_UNIXTIME(?) OR (
      tag_promotion_dt = FROM_UNIXTIME(?) AND product_id > ?
    ))
    ORDER BY tag_promotion_dt ASC, product_id ASC LIMIT ?`,
    [udt, udt, id, limit]
  );
}

const topicName = env.TOPIC_SYNC_PRICE_STOCK;

async function publishPriceStockUpdate(modelNumber) {
  // get calculated price/qty from Nexus
  const res = await requestNexus(`modelNo/${encodeURIComponent(modelNumber)}`);
  if (res === null) {
    throw new Error(`[${modelNumber}] failed to get calculated price from Nexus`)
  } else {
    // publish price/qty for updating to Shopify
    console.log(`publish update for ${modelNumber}`);
    const { data } = res;
    for (const variant of data) {
      const { sku, price = 0, qty = 0, source } = variant || {};
      if (price > 0 && qty > 0) {
        const messageData = { sku, price, source };
        publishMessage(messageData, topicName);
      }
    }
  }
}

const countPerIteration = env.COUNT_PER_ITERATION ? parseInt(env.COUNT_PER_ITERATION) : 1;

async function checkDiscountUpdate() {
  const doc = await lastCheckRef.get();
  const { id = 0, udt = 0 } = doc.exists ? doc.data() : {};
  console.log(`udt: ${udt}, id: ${id}`);
  //Get the data between the last check time and now
  const rows = await getUpdatedProductDiscounts(id, udt, countPerIteration);
  const rowCount = rows.length;
  if (rowCount > 0) {
    let newUdt = udt, newId = id, updated = 0;
    for (const row of rows) {
      const { modelNumber } = row;
      try {
        await publishPriceStockUpdate(modelNumber);
        ({ udt: newUdt, pid: newId} = row);
        updated++;
      } catch (e) {
        console.error(e.message);
        break;
      }
    }

    //Update the last check time
    lastCheckRef.set({ id: newId, udt: newUdt });
    console.log(`products updated: ${updated} / ${rowCount}`);
  } else {
    console.log('no new updates.');
  }
}

exports.run = async (req, res) => {
  await checkDiscountUpdate();
  res.status(200).send();
};
