const gql = require('gql-query-builder');

const capitalise = (str) => str[0].toUpperCase() + str.slice(1);
const uncapitalise = (str) => str[0].toLowerCase() + str.slice(1);

const metafieldNS = 'price_stock';
const metafields = {
  source: {
    type: 'single_line_text_field',
  },
};

function buildId(id, type) {
  return `gid://shopify/${type}/${id}`;
}

function stripId(id) {
  return id.split('/').pop();
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

async function mutate(client, data, objectType, mutationType) {
  const objectTypeStr = uncapitalise(objectType);
  const mutationOp = objectTypeStr + capitalise(mutationType);
  const inputData = {};
  const fields = Object.keys(data).map((key) => {
    const val = data[key];
    switch (key) {
      case 'id':
        inputData[key] = buildId(val, objectType);
        break;
      case 'metafields':
        inputData[key] = Object.keys(val)
          .filter((field) => metafields.hasOwnProperty(field))
          .map((field) => {
            let valObject = val[field];
            if (typeof valObject !== 'object') valObject = { value: valObject };
            const { id = null, value } = valObject;
            const metafieldInput = {
              value,
              namespace: metafieldNS,
              key: field,
              type: metafields[field].type,
            };
            if (id === null) return metafieldInput;
            return Object.assign(
              {
                id: buildId(id, 'Metafield'),
              },
              metafieldInput,
            );
          });
        return {
          operation: 'metafields',
          fields: [{ edges: [{ node: ['id', 'value', 'key'] }] }],
          variables: {
            first: 3,
          },
        };
      default:
        inputData[key] = val;
        break;
    }
    return key;
  });

  const mutationCfg = {
    operation: mutationOp,
    variables: {
      input: {
        value: inputData,
        type: objectType + 'Input',
        required: true,
      },
    },
    fields: [
      {
        [objectTypeStr]: fields,
      },
    ],
  };
  const queryObj = gql.mutation(mutationCfg);

  const res = await query(client, queryObj);
  const retObj = res.body.data[mutationOp][objectTypeStr];
  if (!retObj) {
    console.log(res.body.data);
    throw new Error('no return from Shopify?');
  }
  const retFields = retObj.metafields.edges;
  console.log(JSON.stringify(retFields));

  return Object.assign({}, retObj, {
    id: stripId(retObj.id),
    metafields: retFields.map(({ node }) => ({
      id: stripId(node.id),
      key: node.key,
    })),
  });
}

exports.mutate = mutate;
