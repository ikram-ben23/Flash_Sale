BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS users (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 name VARCHAR(80) NOT NULL,
 email VARCHAR(254) NOT NULL UNIQUE,
 password_hash TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS products (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 name VARCHAR(160) NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 price_cents INTEGER NOT NULL CHECK(price_cents>=0),
 currency CHAR(3) NOT NULL DEFAULT 'USD',
 stock INTEGER NOT NULL CHECK(stock>=0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS orders (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
 quantity INTEGER NOT NULL CHECK(quantity>0),
 unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents>=0),
 currency CHAR(3) NOT NULL,
 total_cents BIGINT GENERATED ALWAYS AS(unit_price_cents::bigint*quantity) STORED,
 status VARCHAR(20) NOT NULL DEFAULT 'PLACED' CHECK(status IN('PLACED','CANCELLED')),
 idempotency_key VARCHAR(128) NOT NULL UNIQUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
 key VARCHAR(128) PRIMARY KEY,
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 request_hash CHAR(64) NOT NULL,
 state VARCHAR(20) NOT NULL CHECK(state IN('processing','completed')),
 order_id UUID REFERENCES orders(id) ON DELETE RESTRICT,
 response_status INTEGER,
 response_body JSONB,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS products_created_at_idx ON products(created_at DESC);
CREATE INDEX IF NOT EXISTS orders_user_created_at_idx ON orders(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS orders_product_id_idx ON orders(product_id);
COMMIT;
