const env = process.env;
const crypto = require('crypto');

const tableProduct = 'product';
const tableProductUploaded = 'product_uploaded';
const tableVariant = 'product_variant';
const tableVariantUploaded = 'product_variant_uploaded';

const genTagshashed = (tagsDB) => {
  const hashTagsArray = [
    tagsDB['tags'],
    tagsDB['tag_promotion'],
    tagsDB['color_option'],
    tagsDB['tags_custom1'],
    tagsDB['metafield_designer'],
    tagsDB['gtins'],
  ];
  return crypto
    .createHash('md5')
    .update(Buffer.from(hashTagsArray.join(','), 'utf-8').toString())
    .digest('hex');
}

const mapVariants = (variants) => {
  for (let variant of variants) {
    for (const column of Object.keys(variant)) {
      switch (column) {
        case 'created_at':
        case 'updated_at':
          variant[column] = new Date(variant[column]);
          break;
        default:
          break;
      }
    }
    // Remove fields in variant but useless in DB
    delete variant['admin_graphql_api_id'];
    delete variant['old_inventory_quantity'];
  }
}

// db
const connection = require('knex')({
  client: 'mysql2',
  connection: {
    host: env.DB_HOST ?? 'localhost',
    port: 3306,
    user: env.DB_USER ?? 'root',
    password: env.DB_PASSWORD ?? '',
    database: env.DB_DATABASE ?? 'test',
  },
  pool: { min: 0, max: 10 },
});

async function insertIntoShopifyDB(table, data) {
  return await (connection(table).insert(data));
}

// ========================= Function =================================

// Using when Create/Update Product's tags
async function getTagsFromMappingByTitle(title) {
  const tags = await connection
    .select(['tag'])
    .from('product_tag_mapping')
    .whereRaw(`? like CONCAT('%',keyword,'%')`, [title])
    .andWhereRaw(`? like CONCAT('%',keyword2,'%')`, [title]);

  return tags.map((obj) => obj.tag).join(',');
}

exports.getTagsFromMappingByTitle = getTagsFromMappingByTitle;

// ========================= Uploaded ===============================

// Update product_uploaded after ShopifyAPI update product
async function updateProduct_uploaded(id, payload) {
  console.log('[DBUpdate]Product_uploaded:', id);
  let clone = {};
  const columns = ['title', 'status', 'descriptionHtml', 'productType', 'vendor', 'tags'];
  for (const column of columns) {
    if (payload[column]) {
      switch (column) {
        case 'descriptionHtml':
          clone['body_html'] = payload[column];
          break;
        case 'productType':
          clone['product_type'] = payload[column];
          break;
        case 'tags':
          clone[column] = payload.tags.join(',');
          clone['tags_hashed'] = genTagshashed(payload['tagsDB'])
          break;
        default:
          clone[column] = payload[column];
          break;
      }
    }
  }
  console.log('[DBUpdate]Product_uploaded:', JSON.stringify(clone));
  await connection(tableProductUploaded)
    .insert(clone)
    .onConflict('id')
    .merge();
}

exports.updateProduct_uploaded = updateProduct_uploaded;

async function updateProduct_variant_uploaded(variants) {
  console.log('[DB-Resync]Product_variant_uploaded');
  mapVariants(variants);
  // Insert On 
  await connection(tableVariantUploaded).insert(variants).onConflict('id').merge();
}

exports.updateProduct_variant_uploaded = updateProduct_variant_uploaded;

// Insert into product_uploaded after ShopifyAPI create product
async function createProduct_uploaded(payload, product, metafields) {
  console.log('[DBInsert]Product_uploaded');
  const columns = [
    'id',
    'title',
    'body_html',
    'vendor',
    'product_type',
    'created_at',
    'handle',
    'updated_at',
    'published_at',
    'template_suffix',
    'status',
    'published_scope',
    'tags',
  ];
  const gender = product.options[0].values[0];
  const newProduct = { sku: payload.modelNumber, option1_values: gender };
  for (const column of columns) {
    if (product[column]) {
      switch (column) {
        case 'tags':
          newProduct[column] = product.tags;
          newProduct['tags_hashed'] = genTagshashed(payload['tagsDB']);
          break;
        case 'created_at':
        case 'updated_at':
        case 'published_at':
          newProduct[column] = new Date(product[column]);
          break;
        default:
          newProduct[column] = product[column];
          break;
      }
    }
  }
  // Add metafields from GraphQL response
  // Rest producet query not include metafields
  for (let object of metafields) {
    const metafield = object.node;
    if (metafield.value) {
      const columnName = 'metafield_' + metafield.key;
      newProduct[columnName] = metafield.value;
    }
  }
  await insertIntoShopifyDB(tableProductUploaded, newProduct);
}

exports.createProduct_uploaded = createProduct_uploaded;

// Insert into product_variant_uploaded after ShopifyAPI create product
async function createProduct_variant_uploaded(variants) {
  console.log('[DBInsert]Product_variant_uploaded');
  mapVariants(variants);
  await insertIntoShopifyDB(tableVariantUploaded, variants);
}

exports.createProduct_variant_uploaded = createProduct_variant_uploaded;

async function mapIdWithExistingVariants(correctVariants) {
  const skuList = [];
  correctVariants.forEach((variant) => {
    skuList.push(variant.sku);
  });
  const variantsInUploaded = await connection.select(['sku', 'id']).from(tableVariantUploaded).whereIn('sku', skuList);
  const variantsObject = variantsInUploaded.reduce((obj, variant) => Object.assign(obj, { [variant.sku]: variant.id }), {});

  return variantsObject;
}

exports.mapIdWithExistingVariants = mapIdWithExistingVariants;

async function getExistingProduct(modelNumber) {
  const result = await connection.select('id').from(tableProductUploaded).where('sku', modelNumber).limit(1);
  return result[0];
}

exports.getExistingProduct = getExistingProduct;

async function deleteUploadedProductAndVariants(id) {
  console.log('[DBDelete]product_variant_uploaded');
  await connection(tableVariantUploaded).where('product_id', id).del();

  console.log('[DBDelete]Product_uploaded');
  await connection(tableProductUploaded).where('id', id).del();

}
exports.deleteUploadedProductAndVariants = deleteUploadedProductAndVariants;

// ================= Normal =====================

async function createOrUpdateProduct(productObj) {
  const product = connection(tableProduct)
    .insert(productObj)
    .onConflict('sku')
    .merge();
  //.returning('product_id');
  return product;
}

exports.createOrUpdateProduct = createOrUpdateProduct;

// Create Product Variants
// Re-sync Product Variants
async function createOrUpdateProductVariants(productVariantData) {
  const variants = connection(tableVariant)
    .insert(productVariantData)
    .onConflict('sku')
    .merge();
  return variants;
}

exports.createOrUpdateProductVariants = createOrUpdateProductVariants;

// Tag -> Product Creator
async function getTagsByModelNumber(modelNumber) {
  const columns = [
    'pl.tags',
    'pl.tag_promotion',
    'pl.color_option',
    'pl.tags_custom1',
    'pl.metafield_designer',
    'pta.product_att_tag',
    'pl.gtins',
  ];
  const tagsObject = connection
    .select(columns)
    .from({ pl: 'product_linked' })
    .leftJoin({ pta: 'product_tags_att' }, 'pl.sku', 'pta.model_no')
    .where('pl.sku', modelNumber);

  return tagsObject;
}

exports.getTagsByModelNumber = getTagsByModelNumber;
// Metafields -> Resync Product

async function getMetafieldsByModelNumber(modelNumber) {
  const columns = [
    'metafield_strap_material',
    'metafield_case_material',
    'metafield_watch_caliber',
    'metafield_display_mode',
    'metafield_closure',
    'metafield_upper_material',
    'metafield_version',
    'metafield_thickness',
    'metafield_release_date',
    'metafield_style',
    'metafield_colorway',
    'metafield_heel_type',
    'metafield_toe_type',
    'metafield_upper',
    'metafield_sole_material',
    'metafield_functionality',
    'metafield_season',
    'metafield_series',
    'metafield_name',
    'metafield_designer',
    'metafield_size_report',
    'metafield_surface_crystal',
  ];
  const metafields = connection
    .select(columns)
    .from(tableProduct)
    .where('sku ', modelNumber);

  return metafields;
}

exports.getMetafieldsByModelNumber = getMetafieldsByModelNumber;

const deleteProduct = async (modelNumber) => {
  return connection(tableProduct).where('sku', modelNumber).del();
};

exports.deleteProduct = deleteProduct;

const deleteProductVariant = async (modelNumber) => {
  return connection(tableVariant).where('model_no', modelNumber).del();
};

exports.deleteProductVariant = deleteProductVariant;
