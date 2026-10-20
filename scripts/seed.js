const { pool } = require("../src/db");

const products = [
  { name: "Flash Sale Headphones", description: "Wireless headphones. Limited stock.", price: 4999, stock: 5 },
  { name: "Smart Watch", description: "Fitness and notification smart watch.", price: 7999, stock: 12 },
  { name: "USB-C Charger", description: "Fast charging adapter.", price: 1999, stock: 0 },
];

(async () => {
  try {
    for (const product of products) {
      // Separate SELECT and INSERT queries to avoid PostgreSQL inferring
      // conflicting types for a parameter reused in INSERT ... SELECT.
      const existing = await pool.query(
        "SELECT id FROM products WHERE name = $1::varchar(160) LIMIT 1",
        [product.name]
      );
      if (existing.rowCount === 0) {
        await pool.query(
          "INSERT INTO products (name, description, price_cents, currency, stock) VALUES ($1::varchar(160), $2::text, $3::integer, 'USD', $4::integer)",
          [product.name, product.description, product.price, product.stock]
        );
      }
    }
    console.log("Seed completed.");
  } catch (error) {
    console.error("Seed failed:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
