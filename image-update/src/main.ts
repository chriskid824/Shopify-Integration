import * as gql from 'gql-query-builder';
import { Shopify } from '@shopify/shopify-api';
import mysql, { RowDataPacket } from 'mysql2/promise';
import { Firestore } from '@google-cloud/firestore';

import 'dotenv/config';

const env = process.env;
let dbConnection: mysql.Pool | null = null;
try {
  dbConnection = mysql.createPool({
    host: env.DATABASE_HOST ?? 'localhost',
    user: env.DATABASE_USER ?? 'root',
    password: env.DATABASE_PASSWORD ?? '',
    database: env.DATABASE_NAME ?? 'test',
  });
} catch (e) {
  console.error("Couldn't connect to database:", e);
}

const firestore = new Firestore();

function escapedModelNumber(modelNumber: string) {
  return modelNumber.replace(/\//g, '_FS_SLASH_');
}

// By default use firestore as the primary data layer. Fallback to old data
// layer if firestore doesn't have the product.
export async function getShopifyProductId(
  modelNumber: string,
): Promise<string | null> {
  const escaped = escapedModelNumber(modelNumber);
  const product = await firestore.collection('product').doc(escaped).get();
  if (product.exists) {
    const data = product.data();
    if (data?.id) {
      console.log(`Found productId ${data.id} in firestore for ${modelNumber}`);
      return data.id;
    }
  }

  try {
    return await getShopifyProductIdFromOldDataLayer(modelNumber);
  } catch (e) {
    console.error(e);
    return null;
  }
}

async function getShopifyProductIdFromOldDataLayer(
  modelNumber: string,
): Promise<string | null> {
  if (!dbConnection) {
    return null;
  }
  const [rows] = await dbConnection.query(
    `SELECT id FROM product WHERE sku = ? LIMIT 1;`,
    [modelNumber],
  );
  if ((rows as RowDataPacket[]).length === 0) {
    return null;
  } else {
    return rows[0].id;
  }
}

const shopifyClient = new Shopify.Clients.Graphql(
  process.env.API_SUBDOMAIN ?? '',
  process.env.API_PASSWORD,
);

async function updateOldDataLayer(modelNumber: string, images: string[]) {
  if (!dbConnection) {
    return;
  }
  if (!modelNumber) {
    console.error('No model number provided when updating old data layer');
    return;
  }
  console.log('Updating old data layer', images);

  // XXX: Doesn't remove old images
  // Add new images to old data layer
  const values = images.map((url, index) => [modelNumber, index + 1, url]);
  const query = `
    INSERT INTO new_product_image_uploaded (modelNumber, position, url)
    VALUES ?
    ON DUPLICATE KEY UPDATE url = VALUES(url);
  `;
  await dbConnection.query(query, [values]);
}

export async function updateImage(modelNumber: string, imageUrls: string[]) {
  console.log(`Updating ${imageUrls.length} images for model ${modelNumber}`);
  const productId = await getShopifyProductId(modelNumber);

  if (!productId) {
    console.error(`No product ID found for model ${modelNumber}`);
    return;
  }
  //await getImagesByProductId(productId);
  const updatedImageUrls = await updateImageByProductId(productId, imageUrls);
  try {
    if (updatedImageUrls) {
      await updateOldDataLayer(modelNumber, updatedImageUrls);
    }
  } catch (e) {
    console.error(e);
  }
}

/**
 * @param {string} productId
 * @param {string[]} imageUrls
 * @returns Updated image URLs
 */
async function updateImageByProductId(
  productId: string,
  imageUrls: string[],
): Promise<string[] | null> {
  console.log(`Updating image for product ${productId}`);
  const images = imageUrls.map((url) => ({
    src: url,
  }));
  const mutationConfig = {
    operation: 'productUpdate',
    variables: {
      input: {
        value: {
          id: `gid://shopify/Product/${productId}`,
          images,
        },
        type: 'ProductInput',
        required: true,
      },
    },
    fields: [
      {
        product: [
          'id',
          {
            operation: 'images',
            variables: {
              first: 10,
            },
            fields: [
              {
                edges: [
                  {
                    node: ['url'],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const query = gql.mutation(mutationConfig);
  const data = await shopifyClient.query({
    data: query,
  });

  const body = data.body as any;
  if (!body?.data?.productUpdate?.product) {
    const error = `No product found for product ${productId}`;
    console.error(error);
    return null;
  }
  if (body.errors?.length) {
    console.error(body.errors);
    throw body.errors;
  }

  console.log(`Successfully updated image for product ${productId}`);
  const updatedImages = body.data.productUpdate.product.images.edges;
  const updatedImageUrls = updatedImages.map((edge) => edge.node.url);
  return updatedImageUrls;
}

async function getImagesByProductId(productId: string) {
  const data = await shopifyClient.query({
    data: `{
        product(id: "gid://shopify/Product/${productId}") {
          title
          description
          onlineStoreUrl
          images(first: 10) {
            edges {
              node {
                id
                url
              }
            }
          }
      }
    }`,
  });
  console.log(JSON.stringify((data.body as any).data, null, 2));
}

export async function processRequest(data: any) {
  let modelNumber = data.modelNumber;
  const imageUrls = data.imageUrls;
  modelNumber = modelNumber?.trim()?.toUpperCase();
  if (!modelNumber) {
    console.error('No model number provided');
    return; // Drop silently
  }
  // Allow empty imageUrls to remove all images
  if (!imageUrls) {
    throw new Error(`${modelNumber}: No image urls provided`);
  }
  await updateImage(modelNumber, imageUrls);
}
