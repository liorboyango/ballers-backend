# Ballers Backend API

RESTful API for the Ballers World Cup Soccer Kits e-commerce platform.

## Tech Stack

- **Runtime**: Node.js 20+
- **Framework**: Express 4
- **Database**: Firebase Firestore (firebase-admin 12)
- **Auth**: JWT (jsonwebtoken) + bcryptjs
- **Validation**: Joi
- **File Uploads**: Multer
- **Logging**: Winston
- **Security**: Helmet, CORS, express-rate-limit
- **Payments**: Rapyd (Collect API + webhooks)

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
# Edit .env with your Firebase service-account JSON, JWT secret, and Rapyd keys

# Start development server
npm run dev

# Start production server
npm start
```

## API Endpoints

### Public Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/teams` | List all World Cup teams |
| GET | `/api/teams/:id` | Get team by ID |
| GET | `/api/products` | List products (with filters) |
| GET | `/api/products/:id` | Get product by ID |
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login and get JWT |
| POST | `/api/rapyd/webhook` | Rapyd webhook receiver (HMAC-verified) |
| GET | `/health` | Health check |

### Protected Endpoints (require JWT)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/auth/me` | Get current user profile |
| GET | `/api/cart` | Get user's cart |
| POST | `/api/cart/add` | Add item to cart |
| PUT | `/api/cart/update` | Update cart item quantity |
| DELETE | `/api/cart/item` | Remove cart item |
| DELETE | `/api/cart` | Clear cart |
| POST | `/api/orders/create-payment-intent` | Create a Rapyd Payment for the cart, returns `clientToken` |
| POST | `/api/orders/create` | Create order from cart (verifies Rapyd payment) |
| GET | `/api/orders` | Get order history |
| GET | `/api/orders/:id` | Get specific order |

### Admin Endpoints (require JWT + admin role)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/products` | Create product |
| PUT | `/api/products/:id` | Update product |
| DELETE | `/api/products/:id` | Delete product |

## Authentication

Include the JWT token in the `Authorization` header:

```
Authorization: Bearer <your-jwt-token>
```

## Error Response Format

All errors return consistent JSON:

```json
{
  "status": "fail",
  "message": "Human-readable error message",
  "errors": [
    { "field": "email", "message": "Please provide a valid email address" }
  ]
}
```

## Query Parameters

### GET /api/products

| Parameter | Type | Description |
|-----------|------|-------------|
| `teamId` | string | Firestore team document id |
| `kitType` | string | home/away/third/goalkeeper |
| `minPrice` | number | Minimum price |
| `maxPrice` | number | Maximum price |
| `size` | string | XS/S/M/L/XL/XXL |
| `search` | string | Text search |
| `page` | number | Page number (default: 1) |
| `limit` | number | Items per page (default: 20, max: 100) |
| `sort` | string | price/-price/name/-name/createdAt/-createdAt |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FIREBASE_SERVICE_ACCOUNT` | ✅ | Firebase service-account JSON (raw or base64-encoded) |
| `FIREBASE_STORAGE_BUCKET` | ❌ | Storage bucket for product images (defaults to `<project_id>.appspot.com`) |
| `JWT_SECRET` | ✅ | JWT signing secret |
| `RAPYD_ACCESS_KEY` | ⚠️ checkout | Rapyd access key (Client Portal → Developers → Credentials) |
| `RAPYD_SECRET_KEY` | ⚠️ checkout | Rapyd secret key used for HMAC signing |
| `RAPYD_WEBHOOK_SECRET` | ⚠️ webhook | Rapyd webhook signing secret (verifies inbound events) |
| `RAPYD_WEBHOOK_URL` | ⚠️ webhook | Public webhook URL — must match the dashboard exactly (used in HMAC) |
| `RAPYD_API_URL` | ❌ | API base URL override (defaults to sandbox in dev, production in prod) |
| `PORT` | ❌ | Server port (default: 5000) |
| `NODE_ENV` | ❌ | Environment (development/production) |
| `JWT_EXPIRES_IN` | ❌ | Token expiry (default: 24h) |
| `FRONTEND_URL` | ❌ | Frontend URL for CORS |
| `LOG_LEVEL` | ❌ | Winston log level (default: info) |

> ⚠️ The `RAPYD_*` variables are not required at boot — the server will start
> without them and emit a clear warning — but `/api/orders/create-payment-intent`
> and `/api/rapyd/webhook` will return 5xx until they are configured.

## Payments

The checkout flow is integrated with **Rapyd**:

1. Frontend calls `POST /api/orders/create-payment-intent` → backend creates a
   Rapyd Payment and returns `{ paymentId, clientToken, amount, currency, orderSummary }`.
2. Frontend uses the Rapyd Client SDK with `clientToken` to render the secure
   card iframe and confirm the payment (3DS handled by Rapyd).
3. On success, frontend calls `POST /api/orders/create` with `rapydPaymentId`
   and shipping address. Backend verifies the Rapyd Payment (status / userId /
   amount), then creates the order.
4. Rapyd delivers a webhook (`PAYMENT_COMPLETED` / `PAYMENT_FAILED`) to
   `/api/rapyd/webhook`, which updates the order status and clears the cart.

**Migration note:** the previous Stripe integration has been removed. Old
orders may still carry `paymentIntentId` / `stripeEventId` fields — these
are ignored by all current read paths.

## Deployment (Render)

Set these environment variables in Render dashboard:
- `NODE_ENV=production`
- `FIREBASE_SERVICE_ACCOUNT=<service-account-json-or-base64>`
- `JWT_SECRET=<strong-random-secret>`
- `FRONTEND_URL=<your-frontend-url>`
- `RAPYD_ACCESS_KEY=<rapyd-production-access-key>`
- `RAPYD_SECRET_KEY=<rapyd-production-secret-key>`
- `RAPYD_WEBHOOK_SECRET=<rapyd-webhook-signing-secret>`
- `RAPYD_WEBHOOK_URL=https://<your-backend-domain>/api/rapyd/webhook`
