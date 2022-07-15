const env = process.env;
require('dotenv').config();
const { productUpdateTest } = require('./index');
const { getChannels } = require('./shopify');
async function main() {
  // let { id, metafields } = { id: null, metafields: null };
  // console.log('[API]Return ID:', id);
  // if (!id) {
  //   console.info(111);
  // }
  //console.info(env.API_SUBDOMAIN);
  //await publishImageUpdate('AV6697-101');
  // for(let i=0;i<1000;i++)
  // {
  // let clone = {};
  // clone['publications'] = (await getChannels())?.map((channel) => ({
  //   channelId: channel,
  // }));

  // //   console.info(i);

  // //   console.info(clone['publications'].length);
  // console.info(clone['publications']);
  // }
  const data = JSON.stringify({
    name: 'Adidas FutureCraft 4D Sample',
    series: 'Black/White',
    modelNumber: '00NA00',
    gender: 'Mens',
    variants: [
      { sku: '00NA00-75', size: 'UK7 / US7.5 / EU40.67 / CM25' },
      { sku: '00NA00-80', size: 'UK7.5 / US8 / EU41.33 / CM25.5' },
      { sku: '00NA00-85', size: 'UK8 / US8.5 / EU42 / CM26' },
      { sku: '00NA00-90', size: 'UK8.5 / US9 / EU42.67 / CM26.5' },
      { sku: '00NA00-95', size: 'UK9 / US9.5 / EU43.33 / CM26.5' },
      { sku: '00NA00-100', size: 'UK9.5 / US10 / EU44 / CM27' },
      { sku: '00NA00-105', size: 'UK10 / US10.5 / EU44.67 / CM27.5' },
      { sku: '00NA00-110', size: 'UK10.5 / US11 / EU45.33 / CM28' },
      { sku: '00NA00-115', size: 'UK11 / US11.5 / EU46 / CM28.5' },
      { sku: '00NA00-120', size: 'UK11.5 / US12 / EU46.67 / CM29' },
      { sku: '00NA00-125', size: 'UK12 / US12.5 / EU47.33 / CM29' },
      { sku: '00NA00-130', size: 'UK12.5 / US13 / EU48 / CM29.5' },
    ],
    body_html: '<p hidden>Adidas FutureCraft 4D Sample Black/White 00NA00</p>',
    product_type: 'Marathon Running Shoes/Sneakers',
    vendor: 'adidas',
    status: 'active',
    metafields: {
      style: 'Sports, Trendy',
      closure: 'Lacing',
      functionality: 'Slip-resistant, Lightweight',
      sole_material: 'Rubber Sole',
      upper: 'Low Cut',
      toe_type: 'Round Toe',
      heel_type: 'Flat heel',
      colorway: 'Black/White',
    },
  });
  //console.info(data);
  //console.info(data.name);
  productUpdateTest(btoa(data));
  return;
  const channels = await getChannels();
  console.info(channels);
}

main();
