'use strict';

const { batchRef } = require('./firestore');
const { run, runBatchFromDb } = require('./sync');

const parseAndRun = async (messageData) => {
  const message = messageData
    ? Buffer.from(messageData, 'base64').toString()
    : '{}';
  console.log('RAW:', message);
  const payload = JSON.parse(message);
  let { data } = payload;
  if (!Array.isArray(data)) {
    data = [payload];
  }
  const tasks = data.map(async (item) => {
    console.log(JSON.stringify(item));
    const result = await run(item);
    if (result === null) {
      console.warn('invalid payload, either `productId` or `variantId` required |', JSON.stringify(item));
    }
    return result;
  });
  return Promise.all(tasks);
};

const triggerRunBatch = async () => {
  const doc = await batchRef.get();
  const { id = 0, udt = 0 } = doc.exists ? doc.data() : {};
  const updatePointers = await runBatchFromDb(id, udt);
  if (updatePointers !== null) {
    const [newId, newUdt] = updatePointers;
    batchRef.set({ id: newId, udt: newUdt });
  }
};


// entry point

/**
 * Triggered from a message on a Cloud Pub/Sub topic.
 *
 * @param {!Object} event Event payload.
 * @param {!Object} context Metadata for the event.
 */
exports.idSync = async (event, context) => {
  const messageData = event.data;
  try {
    await parseAndRun(messageData);
  } catch (e) {
    console.error(e.message);
    throw e;
  }
};

exports.idSyncHttp = async (req, res) => {
  const messageData = req.body.message.data;
  try {
    await parseAndRun(messageData);
  } catch (e) {
    console.error(e.message);
    res.status(500).send();
    return;
  }
  res.status(204).send();
};

/**
 * Triggered from a message on a Cloud Pub/Sub topic.
 *
 * @param {!Object} event Event payload.
 * @param {!Object} context Metadata for the event.
 */
exports.idBatchSync = async (event, context) => {
  try {
    await triggerRunBatch();
  } catch (e) {
    console.error(e.message);
    throw e;
  }
};

exports.idBatchSyncHttp = async (req, res) => {
  try {
    await triggerRunBatch();
  } catch (e) {
    console.error(e.message);
    res.status(500).send();
    return;
  }
  res.status(204).send();
};
