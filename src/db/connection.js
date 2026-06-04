const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'gonca_user',
  password: process.env.DB_PASSWORD || 'gonca_pass_2024',
  database: process.env.DB_NAME || 'gonca_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

module.exports = pool;
