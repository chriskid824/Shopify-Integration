const env = process.env;
const Firestore = require('@google-cloud/firestore');

const db = new Firestore();
const collection = db.collection(env.FS_COLLECTION);

function cleanDocAddress(docAddress) {
  return docAddress.replace(/\//g, '_FS_SLASH_');
}

async function getFirestoreDoc(docAddress) {
  const cleanAddress = cleanDocAddress(docAddress);
  const ref = collection.doc(cleanAddress);
  const doc = await ref.get();
  return doc.exists ? doc.data() : {};
}

async function setFirestoreDoc(docAddress, data) {
  const cleanAddress = cleanDocAddress(docAddress);
  const ref = collection.doc(cleanAddress);
  return ref.set(data, { merge: true });
}

async function deleteFirestoreDoc(docAddress) {
  const cleanAddress = cleanDocAddress(docAddress);
  const ref = collection.doc(cleanAddress);
  return ref.delete();
}

module.exports = {
  getFirestoreDoc,
  setFirestoreDoc,
  deleteFirestoreDoc,
  db
};
