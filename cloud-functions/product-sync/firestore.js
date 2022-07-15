const Firestore = require('@google-cloud/firestore');

const db = new Firestore();

async function getProductDoc(modelNumber) {
  const collection = db.collection('product');
  const ref = collection.doc(cleanDocAddress(modelNumber));
  const doc = await ref.get();
  return doc.exists ? doc.data() : null;
}
exports.getProductDoc = getProductDoc;

async function mapIdWithExistingVariants(correctVariants) {
  const collection = db.collection('variant');
  const variantsObject = {};
  for (const variant of correctVariants) {
    const ref = collection.doc(cleanDocAddress(variant.sku));
    const doc = await ref.get();
    if (doc.exists) {
      variantsObject[variant.sku] = doc.data().id;
    }
  }
  return variantsObject;
}
exports.mapIdWithExistingVariants = mapIdWithExistingVariants;

function cleanDocAddress(docAddress) {
  return docAddress.replace(/\//g, '_FS_SLASH_');
}

async function setProductDoc(modelNo, data) {
  const collection = db.collection('product');
  const ref = collection.doc(cleanDocAddress(modelNo));
  return ref.set(data, { merge: true });
}
exports.setProductDoc = setProductDoc;

async function setVariantDoc(sku, data) {
  const collection = db.collection('variant');
  const ref = collection.doc(cleanDocAddress(sku));
  return ref.set(data, { merge: true });
}
exports.setVariantDoc = setVariantDoc;

async function deleteProductAndVariants(modelNumber) {
  console.log('[FireStore]Delete Variants');
  const variantsCollection = db.collection('variant');
  const variants = await (variantsCollection.where('modelNumber', '==', modelNumber)).get();

  if (variants.empty) {
    console.log('[FireStore]Variants Not Found');
  } else {
    variants.forEach(async (variant) => {
      console.log(JSON.stringify(variant));
      await variant.ref.delete();
    });
  }

  console.log('[FireStore]Delete Product');
  const productCollection = db.collection('product');
  const productRef = productCollection.doc(cleanDocAddress(modelNumber));
  await productRef.delete();

}
exports.deleteProductAndVariants = deleteProductAndVariants;
