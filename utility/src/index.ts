import { bargs } from 'bargs';
import fs from 'fs';
import dotenv from 'dotenv';

// Load .env if exists.
const envFile = '.env';
if (fs.existsSync(envFile)) {
    console.log(`Loading Environment File: ${envFile}`);
    dotenv.config();
} else {
    console.error("Couldn't load the .env file");
}

/**
 * Parse execution args. If no param, no execution.
*/
const parseArgs = () => {
    const definitions = [
        { name: "execute", type: String, aliases: ['e'] }
    ];
    const functionName = bargs(definitions)['execute'];
    if (functionName) {
        const text = `[INFO] '${functionName}' will be executed due to the startup args.`;
        console.warn(text);
        if (functionName === 'SyncImages') require('./service/SyncImagesService').SyncImages();
        else if (functionName === 'SyncPriceQty') require('./service/SyncPriceQtyService').SyncPriceQty();
        else if (functionName === 'SyncShopifyImage') require('./service/SyncShopifyImageService').SyncShopifyImage();
        else if (functionName === 'GoogleFeed') require('./google-feed/index').GoogleFeed();
    }
}

parseArgs();