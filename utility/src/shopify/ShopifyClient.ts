import Shopify from "@shopify/shopify-api";

const shopifyGraphqlClient = new Shopify.Clients.Graphql(
    process.env.SHOPIFY_API_SUBDOMAIN ?? '',
    process.env.SHOPIFY_API_PASSWORD,
);

const shopifyRestClient = new Shopify.Clients.Rest(
    process.env.SHOPIFY_API_SUBDOMAIN ?? '',
    process.env.SHOPIFY_API_PASSWORD);


export { shopifyGraphqlClient, shopifyRestClient }