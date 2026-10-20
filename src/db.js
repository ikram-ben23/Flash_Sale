const { Pool } = require("pg");
const c = require("./config");
if (!c.databaseUrl) {
  console.error("Missing DATABASE_URL. Copy .env.example to .env and configure PostgreSQL.");
  process.exit(1);
}
const pool = new Pool({
  connectionString: c.databaseUrl,
  ssl: c.databaseSsl ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});
pool.on("error", e => console.error("Unexpected PostgreSQL pool error:", e.message));
module.exports = { pool };
