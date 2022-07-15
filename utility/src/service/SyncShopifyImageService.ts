import { GraphqlClient } from "@shopify/shopify-api/dist/clients/graphql";
import { sleep } from "sleep";
import { ShopifyProductsBody } from "../../index.d";
import { calculateDelayCost } from "../shopify/calculateDelayCost";
import { exceedsMaximumCost } from "../shopify/exceedsMaximumCost";
import { readFromCsv } from "../utility/CsvReader";
import { query } from "../utility/DatabaseHelper";
import { generatePortionQueue } from "../utility/Utility";
import { shopifyGraphqlClient } from "./ShopifyClient";

//description: 
//Sync shopify images url to 'shopify.product_image_uploaded'. 
//the model_no comes from csv file.

const insertSql = "INSERT INTO shopify.product_image_uploaded (sku, id, product_id, `position`, variant_ids, source_src, hash_source_src, src, alt, hash_src, width, height, updated_at) VALUES(?, ?, ?, 1, '[]', '', '', ?, '', '', ?, ?, CURRENT_TIMESTAMP)";

const updateSql = "UPDATE shopify.product_image_uploaded SET sku=?, src=?, width=?, height=?, updated_at=CURRENT_TIMESTAMP WHERE id=?"
const updateSkuSql = "UPDATE shopify.product_image_uploaded SET sku=?, width=?, height=?, updated_at=CURRENT_TIMESTAMP WHERE id=?"
const updateSrcSql = "UPDATE shopify.product_image_uploaded SET src=?, width=?, height=?, updated_at=CURRENT_TIMESTAMP WHERE id=?"

const processSku = async (sku, query, shopifyClient: GraphqlClient) => {
    if (!sku) {
        console.warn(`no sku: ${sku}`);
    }
    try {
        let results = await query('SELECT * FROM product_uploaded WHERE sku = ? LIMIT 1', [sku]);
        if (results) {
            const result = results[0];
            const id = result?.id;
            const product_id = id;
            if (product_id) {
                results = await query(`SELECT * FROM product_image_uploaded WHERE sku = ? LIMIT 1`, [sku]);
                if (results && results.length > 0) {
                    const { id, src } = results[0];
                    if (src) {
                        console.warn(`sku/id: ${sku}/${id} already have src`);
                        return;
                    }
                }
                console.log(`fetching sku: ${sku}`);
                const response = await shopifyClient.query({
                    data: `{
                    products(query: "sku:${sku}", first: 1) {
                      edges {
                        node {
                          images(first: 1) {
                            nodes {
                              id
                              height
                              width
                              url
                            }
                          }
                        }
                      }
                    }
                  }`,
                });
                const body = response?.body as ShopifyProductsBody;
                if (body) {
                    const { data } = body as ShopifyProductsBody;
                    const { extensions } = body as ShopifyProductsBody;
                    const { cost } = extensions;

                    const needDelay = exceedsMaximumCost(cost);
                    const delayTime = calculateDelayCost(cost);
                    if (needDelay) {
                        sleep(delayTime);
                        console.log(`need delay: ${delayTime}`);
                    }
                    const node = data?.products?.edges[0]?.node?.images?.nodes[0];
                    if (node) {
                        const { id: _id, height, width, url: src } = node;
                        const id = _id.split('/').pop();

                        results = await query(`SELECT * FROM product_image_uploaded WHERE id = ? LIMIT 1`, [id]);
                        if (!results || results.length === 0) {
                            console.log('Incoming Insertion: ', [sku, id, product_id, src, width, height]);
                            await query(insertSql, [sku, id, product_id, src, width, height]);
                            console.log(`sku: ${sku} inserted!`);
                        }
                        else {
                            const { sku: _sku, src: _src } = results[0];
                            if (!_sku && !_src) {
                                console.log('Incoming sku and src Updating: ', [sku, src, width, height, id]);
                                await query(updateSql, [sku, src, width, height, id]);
                                console.log(`sku: ${sku} and src updated!`);
                            }
                            else if (!_sku) {
                                console.log('Incoming sku Updating: ', [sku, src, width, height, id]);
                                await query(updateSkuSql, [sku, width, height, id]);
                                console.log(`sku: ${sku} updated!`);
                            }
                            else if (!_src) {
                                console.log('Incoming src Updating: ', [sku, src, width, height, id]);
                                await query(updateSrcSql, [src, width, height, id]);
                                console.log(`src updated!`);
                            }

                        }
                    }
                    else console.warn(`sku: ${sku} don't have image`);
                }
                else
                    console.warn(`no response body from shopify api`);
            }
            else console.warn(`skip sku: ${sku}`, result);
        }
        else console.warn(results);
    }
    catch (e) {
        console.warn(`get error for sku: ${sku}`);
        //throw e;
    }
}

const SyncShopifyImage = () => {
    readFromCsv('./sync-image.csv').then(skus => {
        //const startNextFromSku = '25987001';
        const startNextFromSku = null;

        skus = skus.flatMap(c => c.sku.trim());
        const restSkus = startNextFromSku ? skus.slice(skus.indexOf(startNextFromSku)) : skus;

        const generator = generatePortionQueue(restSkus);
        const skuQueue = generator.getPortionQueue(10);

        skuQueue.forEach(async (items) => {
            for (const item of items) {
                await processSku(item, query, shopifyGraphqlClient)
            }
        });
    });
}

export { SyncShopifyImage }