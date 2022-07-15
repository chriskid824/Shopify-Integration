import { GraphqlClient } from "@shopify/shopify-api/dist/clients/graphql";
import { sleep } from "sleep";
import { ProductType, ShopifyProductBody } from "../../index.d";
import { getClient } from "../google/AuthClient";
import { fireStore } from "../google/Firestore";
import { calculateDelayCost } from "../shopify/calculateDelayCost";
import { exceedsMaximumCost } from "../shopify/exceedsMaximumCost";
import { getCache, switchOffCache } from "../utility/SimpleCache";
import { generatePortionQueue } from "../utility/Utility";
import { shopifyGraphqlClient } from "./ShopifyClient";
import * as gql from 'gql-query-builder';
import { appendFileSync, unlinkSync } from "fs";

/* Input specific productId and imageUrls. Update image url to shopify */
const updateImageForShopify = async (productId: string, imageUrls: string[]) => {
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
    const data = await shopifyGraphqlClient.query({
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

/* Get Image url from nexus api. */
const getImageUrlsFromNexusApi = async (modelNumber: string) => {
    const host = process.env.NEXUS_API_HOST;
    const url = `${host}/v1/product/${modelNumber}/imageUrls`;
    try {
        const client = await getClient();
        const res = await client.request({ url, method: 'GET' });
        const data = res.data as any;
        const imageUrls = data.data;
        return imageUrls;
    } catch (e) {
        console.log(`Error ${e} occur when fetching image urls from nexus. for model number: ${modelNumber}`);
        appendFileSync('error-get-image-urls-from-nexus-api', `${modelNumber}\n`);
    }
    return [];
}

/* Input products array. and get no image products from it. */
const getNoImageProducts = async (portion: ProductType[]) => {
    const products = [] as ProductType[];
    for (const item of portion) {
        //console.log(`starting get image count for product: ${item.product_id}`)
        try {
            const hasImage = await getProductImageByGraphql(shopifyGraphqlClient, item.product_id);
            if (!hasImage) {
                appendFileSync('no-image-products', `${item.model_number},${item.product_id}\n`);
                products.push(item);
            }
        }
        catch (e) {
            console.warn(`get error for product_id: ${item.product_id}. just ignore for now.`);
            appendFileSync('error-get-no-image-products', `${item.model_number},${item.product_id}\n`);
        }
    }
    return products;
}

/* Input products array. Update these products image url to shopify */
const updateImage = async (portion: ProductType[]) => {
    for (const item of portion) {
        try {
            const { model_number: modelNumber, product_id: productId } = item;
            const imageUrls = await getImageUrlsFromNexusApi(modelNumber);
            if (imageUrls && imageUrls.length > 0)
                await updateImageForShopify(productId, imageUrls);
            else
                appendFileSync('no-image-firestore-products', `${item.model_number},${item.product_id}\n`);
        }
        catch (e) {
            console.warn(`get error for product_id: ${item.product_id}. just ignore for now.`);
            appendFileSync('error-get-update-image', `${item.model_number},${item.product_id}\n`);
        }
    }
}

/* Get product image url from shopify. this is for checking image existing */
const getProductImageByGraphql = async (client: GraphqlClient, productId: string): Promise<boolean> => {
    const response = await client.query({
        data: `{
            product(id: "gid://shopify/Product/${productId}") {
              featuredImage {
                id
              }
            }
          }`
    });

    const body = response?.body as ShopifyProductBody;
    if (body) {
        const { data } = body as ShopifyProductBody;
        const { extensions } = body as ShopifyProductBody;
        const { cost } = extensions;

        const needDelay = exceedsMaximumCost(cost);
        const delayTime = calculateDelayCost(cost);
        if (needDelay) {
            sleep(delayTime);
            console.log(`need delay: ${delayTime}`);
        }
        if (data) {
            const node = data.product?.featuredImage?.id
            return !!node;
        }
        return false;
    }
    return false;
}

/* Get all products from shopify integration firestore */
const getAllProducts = async () => {
    try {
        const products: ProductType[] = [];
        const portionCount = 10000;
        let index = 1;
        console.log(`Starting batch ${index++} query from firestore with ${portionCount} rows for 1 batch.`);
        const first = fireStore
            .collection('product')
            .orderBy('id')
            .limit(portionCount);
        let snapshot = await first.get();
        snapshot.forEach(doc => {
            products.push({ model_number: doc.id, product_id: doc.data().id });
        });
        let last = snapshot.docs[snapshot.docs.length - 1];

        while (snapshot && snapshot.size > 0) {
            console.log(`Starting batch ${index++} query from firestore with ${portionCount} rows for 1 batch`);
            const next = fireStore
                .collection('product')
                .orderBy('id')
                .startAfter(last.data().id)
                .limit(portionCount);
            snapshot = await next.get();
            snapshot.forEach(doc => {
                products.push({ model_number: doc.id, product_id: doc.data().id });
            });
            last = snapshot.docs[snapshot.docs.length - 1];
        }
        return products;
    }
    catch (e) {
        console.warn(`get product error ${e}`);
    }
}

/* Init All these log file header */
const initLogFile = () => {
    //this is error request log for getting image urls by invoke from nexus api.
    unlinkSync('error-get-image-urls-from-nexus-api');
    appendFileSync('error-get-image-urls-from-nexus-api', `modelNumber\n`);

    //this is error request log for getting no image products by invoke shopify api. usually failed reason is socket hang up. error rate is low.
    unlinkSync('error-get-no-image-products');
    appendFileSync('error-get-no-image-products', `modelNumber,productId\n`);

    //this is error request log for updating product by invoke shopify api. usually failed reason is socket hang up. error rate is low.
    unlinkSync('error-get-update-image');
    appendFileSync('error-get-update-image', `modelNumber,productId\n`);

    //this is log for collecting which products is no image in shopify and nexus api.
    unlinkSync('no-image-firestore-products');
    appendFileSync('no-image-firestore-products', `modelNumber,productId\n`);

    //this is log for collecting which products is no image in shopify. not including nexus api.
    unlinkSync('no-image-products');
    appendFileSync('no-image-products', `modelNumber,productId\n`);
}

/* Entry function for Sync Image Service */
const SyncImages = async () => {
    initLogFile();
    //switchOffCache();
    const products = await getCache<ProductType>(async () => await getAllProducts(), 'cache-products.json');
    const noImageProducts = await getCache<ProductType>(async () => {
        const slotCount = 20;
        const portions = generatePortionQueue<ProductType>(products).getPortionQueue(slotCount);
        console.log(`Starting checking product image with ${slotCount}`);
        const tasks = portions.map(async (portion) => await getNoImageProducts(portion));
        return Promise.all(tasks).then((noImageProductsArray) => noImageProductsArray.reduce((noImageProducts, current) => noImageProducts.concat(current), []));
    }, 'cache-no-image-products.json');

    const portions = generatePortionQueue<ProductType>(noImageProducts).getPortionQueue(100);
    const tasks = portions.map(async (portion) => await updateImage(portion));
    Promise.all(tasks).then(() => console.log('finish!'));
}

export { SyncImages }