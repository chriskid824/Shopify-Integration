require('dotenv').config();
const env = process.env;
const Firestore = require('@google-cloud/firestore');

const projectId = env.PROJECT_ID;
const keyFilename = env.GOOGLE_APPLICATION_CREDENTIALS;
const firestoreConfig = {};

if (projectId) {
  firestoreConfig.projectId = projectId;
}
if (keyFilename) {
  firestoreConfig.keyFilename = keyFilename;
}

const firestore = new Firestore(firestoreConfig);
const productCollection = firestore.collection(env.FS_PRODUCT_COLLECTION);
const variantCollection = firestore.collection(env.FS_VARIANT_COLLECTION);
const batchRef = firestore.collection('batchSync').doc('lastCheck');

function toTimestamp(date) {
  return Firestore.Timestamp.fromDate(new Date(date));
}

function cleanDocAddress(docAddress) {
  return docAddress.replace(/\//g, '_FS_SLASH_');
}

module.exports = {
  productCollection,
  variantCollection,
  batchRef,
  toTimestamp,
  cleanDocAddress,
};
