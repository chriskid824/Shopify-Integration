const env = process.env;
const gql = require('gql-query-builder');

const uncapitalise = (str) => str[0].toLowerCase() + str.slice(1);

const types = {
  InventoryItem: 'InventoryItem',
  InventoryLevel: 'InventoryLevel',
  Location: 'Location',
};

const locationId = buildId(env.SHOPIFY_LOCATION_ID, types.Location);

function buildId(id, type) {
  return `gid://shopify/${type}/${id}`;
}

function isTooManyRequests(res) {
  const tooManyRequestsCode = {
    http: 429,
    shopify: 'THROTTLED',
  };
  if (res?.statusCode === tooManyRequestsCode.http) {
    return true;
  }

  if (res?.body.errors[0].extensions.code === tooManyRequestsCode.shopify) {
    return true;
  }

  return false;
}
async function query(client, query) {
  if (!client) {
    throw new Error('No client provided');
  }

  let retryTime = 0;
  while (retryTime < 5) {
    const res = await client.query({ data: query });
    if (res.body.errors) {
      if (isTooManyRequests(res)) {
        retryTime++;
        const sleepTime = Math.pow(2, retryTime);
        await sleep(sleepTime * 1000);
      } else {
        const errMsg = res.body.errors.reduce((msg, e) => {
          console.log(e.message, e.locations);
          return msg + e.message + ' ; ';
        }, '');
        if (res.body.extensions) {
          console.log(
            res.body.extensions.cost,
            res.body.extensions.cost.throttleStatus,
          );
        }
        throw new Error(errMsg);
      }
    } else {
      return res;
    }
  }
  throw new Error('Hit maximum retry time');
}

async function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function queryInventory(client, id) {
  const baseOpType = types.InventoryItem;
  const nestOpType = types.InventoryLevel;
  const baseOp = uncapitalise(baseOpType);
  const nestOp = uncapitalise(nestOpType);
  const queryCfg = {
    operation: baseOp,
    variables: {
      id: {
        type: 'ID',
        value: buildId(id, baseOpType),
        required: true,
      },
    },
    fields: [
      {
        operation: nestOp,
        variables: {
          locationId: {
            type: 'ID',
            value: locationId,
            required: true,
          },
        },
        fields: ['id', 'available'],
      },
    ],
  };
  const queryObj = gql.query(queryCfg);
  const res = await query(client, queryObj);
  return res.body.data[baseOp][nestOp];
}

async function mutateInventory(client, data) {
  const baseOp = 'inventoryAdjustQuantity';
  const retObj = uncapitalise(types.InventoryLevel);
  const mutationCfg = {
    operation: baseOp,
    variables: {
      input: {
        value: data,
        type: 'InventoryAdjustQuantityInput',
        required: true,
      },
    },
    fields: [
      {
        [retObj]: ['available'],
      },
    ],
  };
  const queryObj = gql.mutation(mutationCfg);
  const res = await query(client, queryObj);
  return res.body.data[baseOp][retObj];
}

exports.queryInventory = queryInventory;
exports.mutateInventory = mutateInventory;
