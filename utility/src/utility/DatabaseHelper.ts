import mysql from 'mysql2';

//Databae pool
const connection = mysql.createPool({
    host: process.env.DB_HOST ?? 'localhost',
    user: process.env.DB_USER ?? 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_DATABASE ?? 'test',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 1000,
});

//Datebase query Execution
const query = async (sql, values) => {
    return new Promise((resolve, reject) => {
        connection.query(sql, values,
            (err, results) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(results);
                }
            }
        );
    });
}

export { query }
