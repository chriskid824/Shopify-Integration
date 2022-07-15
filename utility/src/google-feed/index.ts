import { PriceQtyCronJobSourceType } from "../../index.d";
import { query } from "../utility/DatabaseHelper";
import Fastify from 'fastify';

const sourceSql = `SELECT a.kc_sku, a.price, a.qty FROM 
kickscrew_db2.mgt_price_stock a
inner join shopify.product_variant_uploaded b 
on a.kc_sku = b.sku 
where a.qty > 0 and (a.price <> b.price OR a.qty <> b.inventory_quantity)`;

const updateSql = 'UPDATE shopify.product_variant_uploaded SET price=?, inventory_quantity=?, last_update = CURRENT_TIMESTAMP WHERE sku=?';

const GoogleFeed = async () => {
    const fastify = Fastify({ logger: true });
    const port = Number.parseInt(process.env.GOOGLE_FEED_PORT);

    fastify.get('/syncQtyPrice', async (request, reply) => {
        const result = await query(sourceSql, []) as PriceQtyCronJobSourceType[];

        console.log(`Tracking total: ${result.length} difference.`);
        for (const d of result) {
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

        reply.type('application/json').code(200);
        return {
            status: 'ok'
        };
    });

    fastify.listen({ port }, (err, address) => {
        if (err) throw err
        console.log(`Server running on ${address}`);
    });
}

export { GoogleFeed };