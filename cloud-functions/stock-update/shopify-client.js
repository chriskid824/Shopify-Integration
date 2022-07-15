const Shopify = require('@shopify/shopify-api').Shopify;

const { db } = require('./firestore');

const env = process.env;

async function fetchApps() {
  const collection = db.collection('shopifyApps');
  const apps = await collection.where('enabled', '==', true).get();
  const ret = [];
  apps.forEach(doc => {
    ret.push(doc.data());
  });
  return ret;
}

let shopifyApps = null;
let updatedTime = null;
let index = 0;

// Get the next app to use in round-robin fashion
async function getClient() {
  const oneHour = 1000 * 60 * 60;
  if (!shopifyApps || Date.now() - updatedTime > oneHour) {
    shopifyApps = await fetchApps();
    updatedTime = Date.now();
    if (shopifyApps.length === 0) {
      throw new Error('No Shopify Apps');
    }
    index = Math.floor(Math.random() * shopifyApps.length);
  }

  const app = shopifyApps[index];
  const password = app.password;
  console.log(`Using app ${app.name}`);
  const client = new Shopify.Clients.Graphql(env.API_SUBDOMAIN, password);
  index = (index + 1) % shopifyApps.length;
  return client;
}

module.exports = {
  getClient
};
