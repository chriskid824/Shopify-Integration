# Product Sync
Shopify Integration > Cloud Functions > Product Sync
## Sample payload
```
{
  "modelNumber": "MODELNUMBER",
  "name": "test",
  "series": "RED",
  "body_html": "<p hidden>${modelNumber}</p>",
  "gender": "MENS",
  "variants": [
        {
          "sku": "HAHATESTMODELNUMBER-35",
          "size": "MENS/ US 9 ...",
        },
        {
          "sku": "HAHATESTMODELNUMBER-40",
          "size": "MENS/ US 9.5 ...",
        }
  ],
  "metafields": {
    "designer": "chris",
    "release_date": "2022-02-07"
  },
 "status": "active",
 "product_type": "shoes",
 "vendor": "Nike",
}

```
