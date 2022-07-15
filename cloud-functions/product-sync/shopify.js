const Shopify = require('@shopify/shopify-api').Shopify;
const gql = require('gql-query-builder');
const firestore = require('./firestore');
const env = process.env;
const db = require('./database');

let channels;

const graphqlClient = new Shopify.Clients.Graphql(
  env.API_SUBDOMAIN,
  env.API_PASSWORD,
);
const restClient = new Shopify.Clients.Rest(
  env.API_SUBDOMAIN,
  env.API_PASSWORD,
);

function insertIdIntoVariants(correctVariants, variantsObject) {
  // Append ID to existing variants
  // Shopify will update variant which contains ID
  // Otherwise, create variant
  const graphQLVariants = correctVariants.map((variant) => {
    if (variantsObject[variant.sku]) {
      return {
        ...variant,
        id: 'gid://shopify/ProductVariant/' + variantsObject[variant.sku],
      };
    } else {
      return variant;
    }
  });
  return graphQLVariants;
}

// Query
async function getProductAndProductVariant(id) {
  const data = await restClient.get({
    path: `products/${id}`,
  });
  return data.body['product'];
}
exports.getProductAndProductVariant = getProductAndProductVariant;

//  Mutation -> Edit
async function updateProduct(id, payload) {
  // For now, we Will not handle metafields updating
  // tagsDB is for DB updating
  // No need to update options
  const query = await getCreateOrUpdateQuery(payload, id);
  console.log('[GraphQL]Query:', JSON.stringify(query));

  const response = await graphqlClient.query({ data: query });
  if (response.body.errors) {
    console.log(
      '[ERROR][API]Cannot update product:',
      JSON.stringify(response.body.errors),
    );
  } else {
    console.log('[APIResponse]', JSON.stringify(response));
    // Insert||Update Variants in firestore
    const variants = response.body.data.productUpdate.product?.variants?.edges;
    if (variants) {
      for (const object of variants) {
        const variant = object.node;
        await firestore.setVariantDoc(variant.sku, {
          id: variant.id.replace('gid://shopify/ProductVariant/', ''),
          inventoryItemId: variant.inventoryItem.id.replace(
            'gid://shopify/InventoryItem/',
            '',
          ),
          modelNumber: payload.modelNumber,
        });
      }
    }
  }
  return response;
}

exports.updateProduct = updateProduct;

//  Mutation -> Create
async function createProduct(payload) {
  console.log('[APICreate]CreateProductAndVariants');
  // Let the program not using modelNumber to create product.
  // Shopify Accept these columns in product creation
  // status must upperCase since it is a enum in ShopifyAPI
  const query = await getCreateOrUpdateQuery(payload);
  console.log('[GraphQL]Query:', JSON.stringify(query));
  const response = await graphqlClient.query({
    data: query,
  });
  if (response.body.errors) {
    console.log(
      '[ERROR][API]Cannot create product:',
      JSON.stringify(response.body.errors),
    );
  } else {
    console.log('[APICreate]Success');
    console.log('[APIResponse]', JSON.stringify(response));
    console.log(
      '[Variants]',
      JSON.stringify(response.body.data.productCreate.product.variants),
    );
    const id = response.body.data.productCreate.product.id.replace(
      'gid://shopify/Product/',
      '',
    );
    await firestore.setProductDoc(payload.modelNumber, { id: id });
    const variants = response.body.data.productCreate.product.variants.edges;
    for (const object of variants) {
      const variant = object.node;
      await firestore.setVariantDoc(variant.sku, {
        id: variant.id.replace('gid://shopify/ProductVariant/', ''),
        inventoryItemId: variant.inventoryItem.id.replace(
          'gid://shopify/InventoryItem/',
          '',
        ),
        modelNumber: payload.modelNumber,
      });
    }
    const metafields =
      response.body.data.productCreate.product.metafields.edges;
    if (metafields) {
      const firestoreMetafields = {};
      for (const object of metafields) {
        const metafield = object.node;
        firestoreMetafields[metafield.key] = metafield.id.replace(
          'gid://shopify/Metafield/',
          '',
        );
      }
      await firestore.setProductDoc(payload.modelNumber, {
        metafields: firestoreMetafields,
      });
    }
    // metafields
    return { id, metafields };
  }
  return null;
}
exports.createProduct = createProduct;

async function getCreateOrUpdateQuery(payload, id = null) {
  const columns = [
    'title',
    'descriptionHtml',
    'options',
    'variants',
    'productType',
    'metafields',
    'vendor',
    'status',
    'tags',
  ];

  let clone = {};
  if (id) {
    console.log('[APIUpdate]UpdateProduct');
    id = `gid://shopify/Product/${id}`;
    clone = { id: id };
  }
  for (const column of columns) {
    // Payload should mapped before sending pub/sub message
    if (payload[column]) {
      switch (column) {
        case 'metafields':
          for (let metafield of payload[column]) {
            switch (metafield['key']) {
              case 'designer':
                metafield['value'] = 'DESIGNER_' + metafield['value']; // For SEO
                break;
            }
          }
          clone[column] = payload[column];
          break;
        case 'status': // `status` = enum [ACTIVE,ARCHIVED]
          clone[column] = payload[column].toUpperCase();
          break;
        case 'variants':
          // This is for re-sync
          console.log('[Resync]Looking Variants ID in FireStore');
          if (id) {
            clone[column] = await firestore.mapIdWithExistingVariants(
              payload[column],
            );
            clone[column] = insertIdIntoVariants(
              payload[column],
              clone[column],
            );
            console.log('[Resync]Looking Variants ID in DB');
            clone[column] = await db.mapIdWithExistingVariants(clone[column]);
            clone[column] = insertIdIntoVariants(
              payload[column],
              clone[column],
            );
            console.log('graphQLVariants', clone[column]);
          } else {
            clone[column] = payload[column];
          }
          break;
        default:
          clone[column] = payload[column];
          break;
      }
    }
  }
  // Sales Channel
  if (env.NODE_ENV == 'production') {
    clone['publications'] = (await getChannels())?.map((channel) => ({
      channelId: channel,
    }));
  }
  console.info('[clone]:', clone);
  return gql.mutation({
    operation: id ? 'productUpdate' : 'productCreate',
    variables: {
      input: {
        value: clone,
        type: 'ProductInput',
        required: true,
      },
    },
    fields: [
      {
        product: Object.keys(clone).map((key) => {
          switch (key) {
            case 'variants':
              return {
                operation: 'variants',
                variables: { first: 50 },
                fields: [
                  {
                    edges: [
                      {
                        node: [
                          'sku',
                          'id',
                          {
                            inventoryItem: ['id'],
                          },
                        ],
                      },
                    ],
                  },
                ],
              };
            case 'options':
              return {
                operation: 'options',
                variables: { first: 50 },
                fields: ['id', 'name', 'values'],
              };
            case 'metafields':
              return {
                operation: 'metafields',
                variables: { first: 50 },
                fields: [
                  {
                    edges: [
                      {
                        node: ['key', 'id', 'value'],
                      },
                    ],
                  },
                ],
              };
            default:
              return key;
          }
        }),
      },
    ],
  });
}

async function getChannels() {
  if (channels) {
    return channels;
  }
  try {
    const query = gql.query({
      operation: 'channels',
      variables: { first: 50 },
      fields: [
        {
          edges: [
            {
              node: ['id'],
            },
          ],
        },
      ],
    });
    const response = await graphqlClient.query({ data: query });
    if (response.body.errors) {
      console.log(
        '[ERROR][API]Cannot get channels:',
        JSON.stringify(response.body.errors),
      );
      throw 'Cannot get channels.';
    } else {
      console.log('GET New Channels');
      channels = response.body['data'].channels.edges;
      channels = channels.map((channel) => {
        return channel.node.id;
      });
      console.log('[Channels]:', channels);
      return channels;
    }
  } catch (error) {
    console.error(error);
  }
  return null;
}

exports.getChannels = getChannels;

async function deleteProduct(id) {
  id = `gid://shopify/Product/${id}`;
  console.log('[APIDelete]Delete Product');
  try {
    const query = gql.mutation({
      operation: 'productDelete',
      variables: {
        input: {
          value: { id: id },
          type: 'ProductDeleteInput',
          required: true,
        },
      },
      fields: ['deletedProductId'],
    });
    console.log('[GraphQL]Query:', JSON.stringify(query));
    const response = await graphqlClient.query({ data: query });
    if (response.body.errors) {
      console.log(
        '[ERROR][API]Cannot delete product:',
        JSON.stringify(response.body.errors),
      );
    } else {
      return true;
    }
  } catch (error) {
    console.error(eroor);
  }
  return false;
}

exports.deleteProduct = deleteProduct;
