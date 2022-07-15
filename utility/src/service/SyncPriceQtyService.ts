import { readFromCsv } from "../utility/CsvReader";
import { query } from "../utility/DatabaseHelper";
import { generatePortionQueue } from "../utility/Utility";

//description: 
//Sync price and stock from 'kickscrew_db2.mgt_price_stock' to 'shopify.product_variant_uploaded'. 
//the model_no comes from csv file.

const updateSql = 'UPDATE shopify.product_variant_uploaded SET price=?, inventory_quantity=?, last_update = CURRENT_TIMESTAMP WHERE sku=?';

const processSyncPriceQtySku = async (items) => {
    const data = await query("SELECT kc_sku, price, qty FROM kickscrew_db2.mgt_price_stock WHERE kc_sku in (?)", [items]) as [];

    for (const d of data) {
        const { price, qty, kc_sku } = d;
        try {
            console.log('Incoming sku Updating: ', [price, qty, kc_sku]);
            await query(updateSql, [price, qty, kc_sku]);
            console.log(`Sku: ${kc_sku} committed`);
        }
        catch (e) {
            console.warn(`get error for sku: ${kc_sku}`);
            //throw e;
        }
    }
}

const SyncPriceQty = () => {
    readFromCsv('./sync-price-qty.csv').then(async (skus) => {
        const restSkus = skus.flatMap(c => c.kc_sku.trim());

        const generator = generatePortionQueue(restSkus);
        const skuQueue = generator.getPortionQueue(5);

        skuQueue.forEach(async (items) => {
            await processSyncPriceQtySku(items);
        });
    });
}

export { SyncPriceQty, processSyncPriceQtySku }