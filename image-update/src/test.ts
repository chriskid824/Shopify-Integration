import { updateImage, getShopifyProductId } from './main.js';
async function test() {
  const url = 'https://storage.googleapis.com/kscw-product-image-a7tp/CD7399-500/du/main-square.jpg';
  await updateImage('TEST-JAN30', [url, url, url]);
}

async function test2() {
  const modelNumber = 'HAHA';
  const shopifyProductId = await getShopifyProductId(modelNumber);
  console.log(modelNumber, shopifyProductId);
}

test2();
