const env = process.env;
const { GoogleAuth } = require('google-auth-library');

const domain = env.NEXUS_ENGINE_DOMAIN;
const priceEngineDomain = env.PRICE_ENGINE_DOMAIN;
const auth = new GoogleAuth();
let client;
let priceEngineClient;

async function requestNexus(path, method, postData) {
  client = client ?? (await auth.getIdTokenClient(domain));
  let data;
  const url = `${domain}/${path}`;
  try {
    const options = { url, method };
    if (postData) {
      options.data = postData;
    }
    const res = await client.request(options);
    ({ data = null } = res);
  } catch (e) {
    console.error(`[${path}]`, e);
    return null;
  }
  return data;
}

async function requestPriceEngine(path, method, postData) {
  priceEngineClient =
    priceEngineClient ?? (await auth.getIdTokenClient(priceEngineDomain));
  let data;
  const url = `${priceEngineDomain}/${path}`;
  try {
    const options = { url, method };
    if (postData) {
      options.data = postData;
    }
    const res = await priceEngineClient.request(options);
    ({ data = null } = res);
  } catch (e) {
    console.error(`[${path}]`, e);
    return null;
  }
  return data;
}

exports.requestNexus = requestNexus;
exports.requestPriceEngine = requestPriceEngine;
