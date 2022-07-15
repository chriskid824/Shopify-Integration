import { processRequest } from './main.js';
import express from 'express';

const app = express();

app.use(express.json());

app.post('/', async (req, res) => {
  if (!req.body) {
    const msg = 'no Pub/Sub message received';
    console.error(`error: ${msg}`);
    res.status(400).send(`Bad Request: ${msg}`);
    return;
  }
  if (!req.body.message) {
    const msg = 'invalid Pub/Sub message format';
    console.error(`error: ${msg}`);
    res.status(400).send(`Bad Request: ${msg}`);
    return;
  }

  const pubSubMessage = req.body.message;
  const data = pubSubMessage.data
    ? Buffer.from(pubSubMessage.data, 'base64').toString().trim()
    : '{}';

  let payload;
  try {
    payload = JSON.parse(data);
  } catch (e) {
    console.error(e);
    console.error(`Invalid JSON:`, data);
    res.status(400).send(`Bad Request`);
    return;
  }
  if (payload) {
    await processRequest(payload);
    res.status(204).send();
  } else {
    // We shouldn't expect this to happen because we have checked above
    throw new Error('No payload found');
  }
});

app.listen(process.env.PORT || 8080, () => {
  console.log(`Listening on port ${process.env.PORT || 8080}`);
});
