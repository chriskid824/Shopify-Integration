const env = process.env;
const mysql = require('mysql2');

const connection = mysql.createPool({
  host: env.DB_HOST ?? 'localhost',
  user: env.DB_USER ?? 'root',
  password: env.DB_PASSWORD ?? '',
  database: env.DB_DATABASE ?? 'test',
  waitForConnections: true,
  connectionLimit: 3,
  queueLimit: 0,
});

async function query(sql, values) {
  return new Promise((resolve, reject) => {
    connection.query(sql, values, (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
}

async function getProductVariantIdAndPrice(sku) {
  const result = await query(
    `SELECT v.id, v.price, p.discount, p.dcode_discount
    FROM shopify.product_variant_uploaded v
    LEFT JOIN shopify.product p ON v.product_id = p.id
    WHERE v.sku = ? LIMIT 1`,
    [sku],
  );
  return result.length ? result[0] : null;
}
exports.getProductVariantIdAndPrice = getProductVariantIdAndPrice;

async function updateProduct(table, sku, data) {
  const [setStr, values] = Object.entries(data).reduce(
    ([str, values], [k, v]) => {
      return [`${str}, ${k}=?`, values.concat(v)];
    },
    ['', []],
  );
  await query(
    `UPDATE shopify.${table}
    SET ${setStr.slice(1)}
    WHERE sku = ?`,
    values.concat([sku]),
  );
}
exports.updateProduct = updateProduct;

async function updateProductById(table, id, data) {
  const [setStr, values] = Object.entries(data).reduce(
    ([str, values], [k, v]) => {
      return [`${str}, ${k}=?`, values.concat(v)];
    },
    ['', []],
  );
  await query(
    `UPDATE shopify.${table}
    SET ${setStr.slice(1)}
    WHERE id = ?`,
    values.concat([id]),
  );
}
exports.updateProductById = updateProductById;
