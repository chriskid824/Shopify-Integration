const env = process.env;
const { GoogleAuth } = require('google-auth-library');

const domain = env.PRICE_ENGINE_DOMAIN;
const auth = new GoogleAuth();
let client;

async function requestNexus(path, method, postData) {
  client = client ?? await auth.getIdTokenClient(domain);
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

exports.requestNexus = requestNexus;
