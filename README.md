# Flash Sale API — Secure Edition

A REST API for a limited-time online sale, built with Node.js, Express and PostgreSQL.

## Implemented

- Browse products, search, pagination, and live stock.
- Customer registration/login with bcrypt password hashing and signed JWTs.
- Authenticated order placement and per-customer order history. A customer cannot fetch another customer's order.
- Prevents overselling with a PostgreSQL transaction and `SELECT ... FOR UPDATE` on the product row.
- Idempotency using a database primary key: same user + key + payload replays the original response; a key reused with a different payload returns `409`.
- Clear sold-out/insufficient-stock response (`409 INSUFFICIENT_STOCK`).
- PostgreSQL constraints for nonnegative stock, positive quantities, foreign keys, unique emails and unique idempotency keys.
- Helmet security headers, configurable CORS, request IDs, body-size limit, general rate limiting, stricter authentication rate limiting, Zod validation, parameterized SQL.
- Swagger/OpenAPI documentation.
- Integration test suite and concurrency stress-test script.

## Requirements

Node.js 20+ and PostgreSQL 14+.

## Local setup (Windows PowerShell)

1. Create a PostgreSQL database named `flash_sale`.
2. In this folder run:
   ```powershell
   Copy-Item .env.example .env
   ```
3. Edit `.env` and set `DATABASE_URL` and a random `JWT_SECRET` with at least 32 characters. Do not use the example secret in production.
4. Install, migrate, seed and start:
   ```powershell
   npm install
   npm run db:migrate
   npm run db:seed
   npm run dev
   ```
5. Open Swagger at `http://localhost:3000/api-docs`.

## Environment variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | Required PostgreSQL URL |
| `DATABASE_SSL` | `true` if the provider requires TLS |
| `JWT_SECRET` | Required secret, minimum 32 characters |
| `JWT_EXPIRES_IN` | Token lifetime; default `2h` |
| `PORT` | Server port; default `3000` |
| `CORS_ORIGIN` | `*` or comma-separated allowed origins |
| `RATE_LIMIT_WINDOW_MS` | Rate-limit window; default 900000 |
| `RATE_LIMIT_MAX` | General request limit per IP/window; default 100 |
| `AUTH_RATE_LIMIT_MAX` | Authentication attempts per IP/window; default 10 |
| `DB_POOL_MAX` | PostgreSQL pool size; default 10 |

Keep `.env` private. Commit only `.env.example`. In production, set variables in the hosting provider dashboard. If deploying on Render, use the database's internal connection URL when the API and database are in the same region, and set `DATABASE_SSL` according to the provider's connection instructions.

## API endpoints

Base path: `/api/v1`

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | No | Health check |
| POST | `/auth/register` | No | Register and receive JWT |
| POST | `/auth/login` | No | Login and receive JWT |
| GET | `/auth/me` | Bearer token | Current user |
| GET | `/products` | No | Browse products, `search`, `limit`, `offset` |
| GET | `/products/:id` | No | Product and stock details |
| POST | `/orders` | Bearer token + `Idempotency-Key` | Place an order |
| GET | `/orders` | Bearer token | Only this user's orders |
| GET | `/orders/:id` | Bearer token | Only this user's order |

## Test it in Swagger

1. `POST /auth/register` with:
   ```json
   {"name":"Test Customer","email":"customer@example.test","password":"StrongPass-2026"}
   ```
2. Copy `data.token` from the response.
3. Click **Authorize** and enter the token as `Bearer <token>` if Swagger requests the prefix; with HTTP bearer auth, normally enter only the token.
4. Call `GET /products` and copy a real product `id`.
5. Call `POST /orders` with header `Idempotency-Key: checkout-demo-0001` and body:
   ```json
   {"productId":"PASTE-REAL-PRODUCT-UUID","quantity":1}
   ```
6. Repeat the same request with the same key. It should replay the first result, not create a second order.
7. Call `GET /orders`. It should show only the authenticated user's orders.
8. Register a second user and verify the second user cannot see the first user's orders.

## Automated tests — you must run these before submission

The integration suite writes test data to the configured database. **Prefer a separate disposable test database**, never a production database.

1. Create a test database, for example `flash_sale_test`, and point `DATABASE_URL` in `.env` to it.
2. Set `NODE_ENV=test` and `JWT_SECRET` to a random secret of 32+ characters.
3. Run:
   ```powershell
   npm install
   npm run db:migrate
   npm test
   ```
4. `npm test` runs the integration suite against the configured database. It covers missing authentication, idempotent retries, per-user order isolation, parallel purchases, and sold-out behavior. If the integration suite is skipped, check that both `DATABASE_URL` and a sufficiently long `JWT_SECRET` are set.
5. To run only integration tests:
   ```powershell
   npm run test:integration
   ```

### Stress test

Start the API, register/login and copy the JWT, then get a product UUID from `GET /api/v1/products`. Set these PowerShell variables:
```powershell
$env:BASE_URL="http://localhost:3000"
$env:PRODUCT_ID="PASTE-PRODUCT-UUID"
$env:TOKEN="PASTE-JWT"
$env:CONCURRENCY="50"
npm run test:stress
```
The number of successful orders must not exceed the available stock at the start. Use a low-stock product and reset its stock between runs.

## Deployment (Render example)

- Build command: `npm install`
- Pre-deploy command: `npm run db:migrate`
- Start command: `npm start`
- Set `DATABASE_URL`, `JWT_SECRET` (32+ random characters), and any needed SSL/CORS/rate-limit variables in the service's environment settings.
- Swagger: `https://YOUR-SERVICE.onrender.com/api-docs`

## Important design choices

- The product row lock serializes purchases for the same product. Stock decrement and order insertion are part of the same transaction.
- The idempotency key is globally unique and tied to the user. Use a fresh key for a new checkout and reuse a key only to retry that same checkout.
- Price is stored in integer cents, avoiding floating-point currency calculations.
- Authentication uses bearer JWTs. This is a challenge-ready baseline; production systems should additionally consider email verification, password reset, distributed rate limiting, observability, backups, and payment-provider integration.
- Test results are not pre-certified: run the tests in your own environment and fix any environment-specific failures before submission.
