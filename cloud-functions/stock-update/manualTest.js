require('dotenv').config();
const shopify = require('./shopify');
const { updateStock } = require('./index');
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

async function main() {
  await updateStock({
    qty: 1,
    sku: 'CT8527-016-35',
  });
}

main();
