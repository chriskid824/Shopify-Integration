require('dotenv').config();
const shopifyClient = require('./shopify-client');
const { updatePrice } = require('./index');

async function manualTest(i) {
  await shopify.query(`{
            products (first: 250) {
              edges {
                node {
                  id
                  title
                  descriptionHtml
                }
              }
            }
          }`);
  console.log(i);
}

async function test() {
  const client = await shopifyClient.getClient();
  await updatePrice({
    sku: 'CT8527-016-35',
    price: 123,
    source: 'kc',
  });
}

test();
